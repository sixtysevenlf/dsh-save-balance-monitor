/**
 * 余额悬浮窗（合并版）—— host 半
 * 提供四个同源路由：
 *   GET /api/opencode-go/balance — OpenCode Go 官方额度（https://opencode.ai/zen/go/v1/usage），60s 缓存
 *   GET /api/opencode-go/usage   — 今日用量快照（DeepSeek 官网平台，gate/压缩数据源）
 *   GET /api/opencode-go/rate    — USD→CNY 汇率
 *   GET /api/deepseek/balance    — DeepSeek 官方余额（https://api.deepseek.com/user/balance），5s 缓存
 *   GET /api/deepseek/usage      — DeepSeek 官网平台用量（当月 token/金额/请求数，需 DEEPSEEK_PLATFORM_TOKEN）
 *
 * key 来源（均不读取 opencode 本地配置文件）：
 *   OpenCode Go：DSH 凭据 OPENCODE_GO_API_KEY → 环境变量 OGM_API_KEY
 *   DeepSeek   ：DSH 凭据 DEEPSEEK_API_KEY
 *   Platform   ：DSH 凭据 DEEPSEEK_PLATFORM_TOKEN（官网平台私有端点）
 */
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
export const name = 'dsh-save-balance-monitor'

export const inject = ['credentials', 'webServer']

// ---------- OpenCode Go ----------
const BALANCE_URL = process.env.OGM_BASE || 'https://opencode.ai/zen/go/v1/usage'
const BALANCE_CACHE_MS = 60000

async function resolveOpenCodeKey(ctx) {
  try {
    const cred = await ctx.credentials.resolve('OPENCODE_GO_API_KEY')
    if (cred && cred.value) return cred.value
  } catch { /* fallthrough */ }
  if (process.env.OGM_API_KEY) return process.env.OGM_API_KEY
  throw new Error('未配置 OPENCODE_GO_API_KEY 凭据（DSH 设置 → 凭据，或环境变量 OGM_API_KEY）')
}

async function queryOpenCodeBalance(ctx) {
  const key = await resolveOpenCodeKey(ctx)
  const resp = await fetch(BALANCE_URL, {
    headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'dsh-save-balance-monitor/1.0' },
    signal: AbortSignal.timeout(12000),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`余额接口 HTTP ${resp.status}: ${String(text).slice(0, 120)}`)
  }
  const data = await resp.json()
  const u = (data && data.usage) || {}
  const norm = (w) => {
    const x = u[w] || {}
    return {
      status: x.status ?? null,
      percent: typeof x.percent === 'number' ? x.percent : null,
      resetsAt: x.resetsAt || null,
    }
  }
  return { ok: true, fetchedAt: Date.now(), rolling: norm('rolling'), weekly: norm('weekly'), monthly: norm('monthly') }
}

// ---------- DeepSeek ----------
const DS_BALANCE_URL = 'https://api.deepseek.com/user/balance'
const DS_PRICE_PER_MILLION = 4
const DS_CACHE_MS = 5000

async function queryDeepseekBalance(ctx) {
  const cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
  if (!cred || !cred.value) throw new Error('未配置 DEEPSEEK_API_KEY 凭据')
  const resp = await fetch(DS_BALANCE_URL, {
    headers: { Authorization: `Bearer ${cred.value}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`余额接口 HTTP ${resp.status}: ${String(text).slice(0, 120)}`)
  }
  const data = await resp.json()
  const info = (data.balance_infos || [])[0] || {}
  const balance = Number.parseFloat(info.total_balance)
  if (!Number.isFinite(balance)) throw new Error('余额响应格式异常')
  const estTokens = Math.floor(balance / (DS_PRICE_PER_MILLION / 1e6))
  let model = null
  try {
    const sel = ctx.get('agentDefaultModel')?.currentSelection()
    model = (sel && sel.model) || null
  } catch { /* 模型展示为可选项 */ }
  return {
    ok: true,
    balance,
    currency: info.currency || 'CNY',
    isAvailable: data.is_available !== false,
    estTokens,
    model,
    pricePerMillion: DS_PRICE_PER_MILLION,
    fetchedAt: Date.now(),
  }
}

// ---------- 汇率（USD→CNY，金额单位切换用；自动抓取失败时用默认值） ----------
const RATE_DEFAULT = 7.2
const RATE_URL = 'https://open.er-api.com/v6/latest/USD'
const RATE_CACHE_MS = 6 * 3600000
let rateCache = null
let rateCacheAt = 0

async function usdToCnyRate() {
  const now = Date.now()
  if (rateCache && now - rateCacheAt < RATE_CACHE_MS) return rateCache
  try {
    const resp = await fetch(RATE_URL, { signal: AbortSignal.timeout(8000) })
    if (resp.ok) {
      const data = await resp.json()
      const r = Number.parseFloat(data && data.rates && data.rates.CNY)
      if (Number.isFinite(r) && r > 1) {
        rateCache = Math.round(r * 1000) / 1000
        rateCacheAt = now
        return rateCache
      }
    }
  } catch { /* 走默认值 */ }
  rateCache = RATE_DEFAULT
  rateCacheAt = now - (RATE_CACHE_MS - 3600000) // 默认值 1 小时后重试
  return rateCache
}

// ---------- DeepSeek 官网平台用量（私有 dashboard 端点，需 Platform userToken） ----------
// 来源：platform.deepseek.com 控制台（CodexBar 同款端点）：
//   GET /api/v0/usage/amount?month=&year=  → { code, data: { biz_data: { total: [{model, usage:[{type,amount}]}], days: [{date, data:[...]}] } } }
//   GET /api/v0/usage/cost?month=&year=    → { code, data: { biz_data: [{ total: [...], days: [...], currency }] } }
// type: PROMPT_CACHE_HIT_TOKEN / PROMPT_CACHE_MISS_TOKEN / RESPONSE_TOKEN / REQUEST
const PLATFORM_AMOUNT_URL = 'https://platform.deepseek.com/api/v0/usage/amount'
const PLATFORM_COST_URL = 'https://platform.deepseek.com/api/v0/usage/cost'
const PLATFORM_USAGE_CACHE_MS = 60000
let platformUsageCache = null
let platformUsageAt = 0

// ---------- 自动读取浏览器里的 userToken（尽力而为；.log 全解析 + .ldb 未压缩块） ----------
// 命中后用官网实体验证，有效才采用；读不到时由 DSH 凭据 / 环境变量兜底。
const autoTokenCache = { token: null, at: 0, tried: false }
const AUTO_TOKEN_CACHE_MS = 60 * 60 * 1000

function browserLeveldbDirs() {
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const loc = process.env.LOCALAPPDATA
  const roam = process.env.APPDATA
  const roots = []
  if (process.platform === 'win32') {
    if (loc) roots.push(joinWin(loc, 'Google', 'Chrome', 'User Data'), joinWin(loc, 'Microsoft', 'Edge', 'User Data'), joinWin(loc, 'Chromium', 'User Data'))
    if (roam) roots.push(joinWin(roam, '360se6', 'User Data'), joinWin(roam, '360ChromeX', 'User Data'), joinWin(roam, '360Chrome', 'User Data'), joinWin(roam, '360se9', 'User Data'), joinWin(roam, 'BraveSoftware', 'Brave-Browser', 'User Data'))
  } else if (process.platform === 'darwin') {
    if (home) roots.push(joinP(home, 'Library', 'Application Support', 'Google', 'Chrome'), joinP(home, 'Library', 'Application Support', 'Microsoft Edge'), joinP(home, 'Library', 'Application Support', 'Chromium'), joinP(home, 'Library', 'Application Support', '360Chrome'), joinP(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'))
  } else {
    if (home) roots.push(joinP(home, '.config', 'google-chrome'), joinP(home, '.config', 'microsoft-edge'), joinP(home, '.config', 'chromium'), joinP(home, '.config', '360chrome'), joinP(home, '.config', 'BraveSoftware', 'Brave-Browser'))
  }
  const dirs = []
  for (const root of roots) {
    try {
      for (const ent of readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        const ls = joinP(root, ent.name, 'Local Storage', 'leveldb')
        if (existsSync(ls)) dirs.push(ls)
      }
      const ls0 = joinP(root, 'Local Storage', 'leveldb')
      if (existsSync(ls0)) dirs.push(ls0)
    } catch { /* 目录不可读则跳过 */ }
  }
  return dirs
}
function joinWin(...parts) { return parts.join('\\') }
function joinP(...parts) { return parts.join('/') }

const rv32 = (buf, pos) => { let r = 0, s = 0, b; do { b = buf[pos++]; r |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return { v: r >>> 0, n: pos } }
// .log 写前日志：FULL 记录 → put 条目（key 为 userKey，去掉 8 字节 seq）
function parseLogEntries(buf) {
  const out = []; let pos = 0
  while (pos + 7 <= buf.length) {
    const len = buf.readUInt16LE(pos + 4), type = buf[pos + 6]; pos += 7
    if (len === 0 || pos + len > buf.length) break
    if (type === 1) {
      const d = buf.slice(pos, pos + len); let p = 8
      if (p + 4 > d.length) { pos += len; continue }
      const count = d.readUInt32LE(p); p += 4
      for (let e = 0; e < count && p < d.length; e++) {
        const kt = d[p++]
        const kl = rv32(d, p); p = kl.n
        const vl = rv32(d, p); p = vl.n
        if (p + kl.v + vl.v > d.length) break
        const key = d.slice(p, p + kl.v); p += kl.v
        const val = d.slice(p, p + vl.v); p += vl.v
        if (kt === 1) out.push({ key: key.slice(0, Math.max(0, key.length - 8)).toString('latin1'), val: val.toString('latin1') })
      }
    }
    pos += len
  }
  return out
}
// .ldb sstable：footer→index→data blocks（仅解析未压缩块 type 0；snappy 块跳过）
function parseLdbEntries(buf) {
  if (buf.length < 48) return []
  const foot = buf.slice(buf.length - 48)
  if (foot.readBigUInt64LE(40) !== 0xdb4775248b80fb57n) return []
  const h1 = rv32(foot, 0), h2 = rv32(foot, h1.n)
  const ib = readBlockRaw(buf, h1.v, h2.v)
  if (!ib) return []
  const idx = parseBlockEntries(ib)
  const out = []
  for (const ie of idx) {
    const h = rv32(ie.val, 0)
    const db = readBlockRaw(buf, h.v, rv32(ie.val, h.n).v)
    if (!db) continue
    for (const en of parseBlockEntries(db)) if (en.key.includes('platform.deepseek.com')) out.push(en)
  }
  return out
}
function readBlockRaw(buf, offset, size) {
  if (offset + size + 5 > buf.length) return null
  if (buf[offset + size] !== 0x00) return null // type 1 = snappy，跳过
  return buf.slice(offset, offset + size)
}
function parseBlockEntries(data) {
  if (!data || data.length < 8) return []
  const end = data.length - 4
  const out = []; let pos = 0; let prev = Buffer.alloc(0)
  while (pos < end) {
    const sc = rv32(data, pos); pos = sc.n
    if (pos >= end) break
    const nsc = rv32(data, pos); pos = nsc.n
    if (pos >= end) break
    const vl = rv32(data, pos); pos = vl.n
    if (pos + sc.v + nsc.v + vl.v > data.length) break
    const key = Buffer.concat([prev.slice(0, sc.v), data.slice(pos, pos + nsc.v)])
    pos += nsc.v
    const val = data.slice(pos, pos + vl.v); pos += vl.v
    prev = key
    out.push({ key: key.toString('latin1'), val })
  }
  return out
}
// 从 localStorage 值中提取候选 token（JWT 或长串）
function extractTokenCandidates(entries) {
  const cands = []
  for (const en of entries) {
    if (!/token|passport|session|jwt|auth/i.test(en.key)) continue
    const s = en.val.toString('latin1')
    const m = s.match(/eyJ[A-Za-z0-9_.-]{30,}|[A-Za-z0-9_-]{40,}/g)
    if (m) for (const t of m) if (t.length >= 40 && !cands.includes(t)) cands.push(t)
  }
  return cands
}
async function validatePlatformToken(token) {
  try {
    const now = new Date()
    const res = await fetch(`${PLATFORM_COST_URL}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 401 || res.status === 403) return false
    if (!res.ok) return false
    const data = await res.json().catch(() => null)
    return !!(data && data.code === 0)
  } catch { return false }
}
async function autoPlatformToken() {
  if (autoTokenCache.tried && Date.now() - autoTokenCache.at < AUTO_TOKEN_CACHE_MS) return autoTokenCache.token
  autoTokenCache.tried = true
  autoTokenCache.at = Date.now()
  autoTokenCache.token = null
  try {
    for (const dir of browserLeveldbDirs()) {
      let files
      try { files = readdirSync(dir) } catch { continue }
      for (const f of files) {
        if (!/\.(log|ldb)$/.test(f)) continue
        let buf
        try {
          const st = statSync(dir + '/' + f)
          if (st.size > 64 * 1024 * 1024) continue
          buf = readFileSync(dir + '/' + f)
        } catch { continue }
        const entries = f.endsWith('.ldb') ? parseLdbEntries(buf) : parseLogEntries(buf)
        const cands = extractTokenCandidates(entries)
        for (const c of cands) {
          if (await validatePlatformToken(c)) { autoTokenCache.token = c; return c }
        }
      }
    }
  } catch { /* 自动读取失败静默 */ }
  return null
}

async function resolvePlatformToken(ctx) {
  try {
    const cred = await ctx.credentials.resolve('DEEPSEEK_PLATFORM_TOKEN')
    if (cred && cred.value) return cred.value
  } catch { /* fallthrough */ }
  if (process.env.OGM_PLATFORM_TOKEN) return process.env.OGM_PLATFORM_TOKEN
  // 尽力而为：自动从浏览器 Local Storage 读取（已验证有效）
  return autoPlatformToken()
}

async function queryDeepseekPlatformUsage(ctx) {
  const token = await resolvePlatformToken(ctx)
  if (!token) return { ok: false, error: '未找到官网 token：已自动尝试从浏览器读取但未命中；请在 DSH 凭据配置 DEEPSEEK_PLATFORM_TOKEN（platform.deepseek.com 登录后 localStorage 的 userToken），或确认已在 Chrome/Edge/360 登录过官网' }
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  const [amountRes, costRes] = await Promise.all([
    fetch(`${PLATFORM_AMOUNT_URL}?month=${month}&year=${year}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    }),
    fetch(`${PLATFORM_COST_URL}?month=${month}&year=${year}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    }),
  ])
  if (amountRes.status === 401 || amountRes.status === 403 || costRes.status === 401 || costRes.status === 403) {
    return { ok: false, error: 'Platform token 无效或已过期（40002/40003）' }
  }
  if (!amountRes.ok || !costRes.ok) return { ok: false, error: `官网用量接口 HTTP ${amountRes.status}/${costRes.status}` }
  const a = await amountRes.json()
  const c = await costRes.json()
  const ab = a && a.data && a.data.biz_data
  const cb = c && c.data && (c.data.biz_data || [])[0]
  if (!ab || !cb) return { ok: false, error: '官网用量响应格式异常' }

  const sumUsage = (items) => {
    let tokens = 0, requests = 0
    for (const it of items || []) {
      const amt = Number(it.amount) || 0
      if (it.type === 'REQUEST') requests += amt
      else tokens += amt
    }
    return { tokens, requests }
  }
  const sumModels = (models) => {
    let tokens = 0, requests = 0
    for (const m of models || []) {
      const r = sumUsage(m && m.usage)
      tokens += r.tokens
      requests += r.requests
    }
    return { tokens, requests }
  }
  const sumCostUsage = (items) => {
    let cost = 0
    for (const it of items || []) {
      if (it.type === 'REQUEST') continue
      cost += Number(it.amount) || 0
    }
    return cost
  }
  let totalTokens = 0, totalRequests = 0
  let topModel = null, topModelTokens = 0
  for (const m of ab.total || []) {
    const { tokens, requests } = sumUsage(m.usage)
    totalTokens += tokens
    totalRequests += requests
    if (tokens > topModelTokens) { topModelTokens = tokens; topModel = m.model }
  }
  let totalCost = 0
  for (const m of cb.total || []) totalCost += sumCostUsage(m.usage)
  const currency = cb.currency || 'CNY'

  // 每日明细合并（amount days × cost days，均按 model→usage 嵌套展开）
  const dayMap = new Map()
  for (const d of ab.days || []) {
    const { tokens, requests } = sumModels(d.data)
    let e = dayMap.get(d.date)
    if (!e) { e = { date: d.date, tokens: 0, cost: 0, requests: 0 }; dayMap.set(d.date, e) }
    e.tokens += tokens
    e.requests += requests
  }
  for (const d of cb.days || []) {
    let cost = 0
    for (const m of (d.data || [])) cost += sumCostUsage(m.usage)
    let e = dayMap.get(d.date)
    if (!e) { e = { date: d.date, tokens: 0, cost: 0, requests: 0 }; dayMap.set(d.date, e) }
    e.cost += cost
  }
  const days = [...dayMap.values()].sort((x, y) => (x.date < y.date ? -1 : 1))
  const activeDays = days.filter((d) => d.tokens > 0 || d.requests > 0).length
  // 分类明细（官网口径：缓存命中/未命中/输出 token）
  const cat = { cacheHit: 0, cacheMiss: 0, response: 0 }
  for (const m of ab.total || []) {
    for (const it of (m.usage || [])) {
      const amt = Number(it.amount) || 0
      if (it.type === 'PROMPT_CACHE_HIT_TOKEN') cat.cacheHit += amt
      else if (it.type === 'PROMPT_CACHE_MISS_TOKEN') cat.cacheMiss += amt
      else if (it.type === 'RESPONSE_TOKEN') cat.response += amt
    }
  }
  return {
    ok: true,
    month, year,
    totalTokens, totalCost: Math.round(totalCost * 10000) / 10000,
    currency, requestCount: totalRequests,
    topModel,
    activeDays,
    category: cat,
    dailyAvgTokens: activeDays ? Math.round(totalTokens / activeDays) : 0,
    dailyAvgCost: activeDays ? Math.round(totalCost / activeDays * 10000) / 10000 : 0,
    days,
    fetchedAt: Date.now(),
  }
}

async function statusPlatformUsage(ctx) {
  const now = Date.now()
  if (platformUsageCache && now - platformUsageAt < PLATFORM_USAGE_CACHE_MS) return platformUsageCache
  try {
    const payload = await queryDeepseekPlatformUsage(ctx)
    platformUsageCache = payload
    platformUsageAt = now
    return payload
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 200)
    if (platformUsageCache) return { ...platformUsageCache, stale: true, error: msg }
    return { ok: false, error: msg }
  }
}

// ---------- 本地小时用量（小时颗粒度 = 官网日数据校准总量 + 本地 session 事件推算实时增量） ----------
// 官网只给日粒度；当前小时 token 通过监听 session/event 里 assistant/message 的 provider usage 实时累计。
// 小时键：北京时间 yyyymmddH
const hourUsage = new Map()
function recordLocalUsage(event) {
  const u = event && event.data && event.data.usage
  if (!u) return
  const tokens = (u.inputTokens || 0) + (u.outputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0)
  if (!tokens) return
  const now = Date.now()
  const bj = new Date(now + 8 * 3600000)
  const hk = bj.getUTCFullYear() * 1e6 + (bj.getUTCMonth() + 1) * 1e4 + bj.getUTCDate() * 100 + bj.getUTCHours()
  const e = hourUsage.get(hk) || { tokens: 0, ts: now }
  e.tokens += tokens
  e.ts = now
  hourUsage.set(hk, e)
  const cutoff = now - 24 * 3600000
  for (const [k, v] of hourUsage) if (v.ts < cutoff) hourUsage.delete(k)
}
// 本地推算：今日 token + 当前小时 token（官网不可用/未结算时作为小时粒度的实时来源）
function localUsageNow() {
  const bj = new Date(Date.now() + 8 * 3600000)
  const todayKey = bj.getUTCFullYear() + '-' + String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' + String(bj.getUTCDate()).padStart(2, '0')
  const cur = bj.getUTCHours()
  let todayTokens = 0, curHourTokens = 0
  for (const [hk, e] of hourUsage) {
    const y = Math.floor(hk / 1e6)
    const mo = Math.floor(hk / 1e4) % 100
    const d = Math.floor(hk / 100) % 100
    const h = hk % 100
    const key = y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    if (key === todayKey) {
      todayTokens += e.tokens
      if (h === cur) curHourTokens += e.tokens
    }
  }
  return { todayTokens, curHourTokens }
}

// ---------- 用量快照（DeepSeek 官网平台 + 本地小时推算，gate/压缩数据源） ----------
// 今日 = 官网 days 明细中 date === 今天（北京时间）的记录；官网不可用或当日未结算时今日为 0。
// 当前小时 token = 本地 session 事件实时累计（小时颗粒度还原）。
async function usageSnapshot(ctx) {
  const pu = await statusPlatformUsage(ctx)
  if (!pu || !pu.ok) return { ok: false, error: (pu && pu.error) || '官网数据不可用' }
  const bj = new Date(Date.now() + 8 * 3600000)
  const todayKey = bj.getUTCFullYear() + '-' + String(bj.getUTCMonth() + 1).padStart(2, '0') + '-' + String(bj.getUTCDate()).padStart(2, '0')
  const rec = (pu.days || []).find((d) => d.date === todayKey) || { tokens: 0, cost: 0, requests: 0 }
  const local = localUsageNow()
  return {
    ok: true,
    ts: Date.now(),
    costCurrency: 'CNY',
    today: {
      tokens: rec.tokens || 0,
      cost: Math.round((rec.cost || 0) * 10000) / 10000,
      requests: rec.requests || 0,
    },
    // 本地实时（小时颗粒度）：当前小时 token、本地推算的今日 token
    hourNow: { tokens: local.curHourTokens },
    localTodayTokens: local.todayTokens,
    month: pu.month,
    year: pu.year,
  }
}


// ---------- 超限断点截断（真·控制：工具请求是天然断点——模型回复完整生成（含工具调用）并执行完毕后，
// 在下一个请求发出前拦截；不截断思考链、不回传异常 reasoning context，下一轮可原样续传） ----------
let gateEnabled = false
let gateCostLimit = 0
let gateTokenLimit = 0
let gatePeakOnly = false
let gateHourLimit = 0 // 高价区每小时 tok 上限（基准每小时；高峰时段自动减半生效）
let usageCache = null
let usageCacheAt = 0

async function budgetSnapshot(ctx) {
  const now = Date.now()
  if (usageCache && now - usageCacheAt < 5000) return usageCache
  try {
    usageCache = await usageSnapshot(ctx)
    usageCacheAt = now
  } catch { /* 保持旧缓存 */ }
  return usageCache
}

function overBudget(u) {
  if (!u || !u.ok || !u.today) return false
  return (gateCostLimit > 0 && u.today.cost > gateCostLimit)
      || (gateTokenLimit > 0 && u.today.tokens > gateTokenLimit)
}
// 高价区每小时限额判断：基准每小时（gateHourLimit）高峰自动减半后即高价区生效限额；
// 当前小时 token（本地推算）超过它即"小时超限"（用于面板状态与语音提醒，不拦截）
function hourOverBudget(u) {
  if (!u || !u.ok || gateHourLimit <= 0) return false
  const eff = inPeakNow() ? Math.max(1, Math.round(gateHourLimit / 2)) : gateHourLimit
  const hourTok = (u.hourNow && u.hourNow.tokens) || 0
  return hourTok > eff
}
function hourLimitEffective() {
  if (gateHourLimit <= 0) return 0
  return inPeakNow() ? Math.max(1, Math.round(gateHourLimit / 2)) : gateHourLimit
}

// ---------- 低耗压缩：工具执行结果只留变化部分（行级 diff，无依赖；默认高峰时段激活） ----------
let compressEnabled = false
let compressAtPercent = 80
let compressPeakOnly = true
let compressCount = 0

function inPeakNow() {
  const h = Math.floor(((Date.now() + 8 * 3600000) % 86400000) / 3600000)
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

const MIN_COMPRESS_CHARS = 1500
const DIFF_LINE_CAP = 1200
const COMPRESS_MARK = '[低耗压缩：与上次执行结果仅保留变化]'

function myersDiff(a, b) {
  const n = a.length, m = b.length, max = n + m, offset = max
  const v = new Array(2 * max + 1).fill(0)
  const trace = []
  let found = false
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1]
      else x = v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[offset + k] = x
      if (x >= n && y >= m) { found = true; break }
    }
  }
  const ops = []
  let x = n, y = m
  for (let d = trace.length - 1; d >= 1; d--) {
    const vv = trace[d]
    const k = x - y
    let prevK
    if (k === -d || (k !== d && vv[offset + k - 1] < vv[offset + k + 1])) prevK = k + 1
    else prevK = k - 1
    const prevX = vv[offset + prevK]
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { ops.push({ t: ' ', s: a[x - 1] }); x--; y-- }
    if (x === prevX) { while (y > prevY) { ops.push({ t: '+', s: b[y - 1] }); y-- } }
    else { while (x > prevX) { ops.push({ t: '-', s: a[x - 1] }); x-- } }
  }
  return ops.reverse()
}

function diffCompress(prevText, curText) {
  if (curText === prevText) return '[低耗压缩] 本次输出与上次执行结果完全相同，无变化'
  const a = prevText.split('\n'), b = curText.split('\n')
  if (a.length > DIFF_LINE_CAP || b.length > DIFF_LINE_CAP) return null
  let ops
  try { ops = myersDiff(a, b) } catch { return null }
  const changed = ops.filter((o) => o.t !== ' ').length
  if (changed === 0) return '[低耗压缩] 本次输出与上次执行结果完全相同，无变化'
  const body = ops.filter((o) => o.t !== ' ').map((o) => (o.t === '-' ? '- ' : '+ ') + o.s).join('\n')
  const out = COMPRESS_MARK + '\n（变化 ' + changed + ' 行，原 ' + curText.length + ' 字符）\n' + body
  if (out.length >= curText.length * 0.4) return null // 压缩收益不足，保留原文
  return out
}

// 从 tool-result 内容块中提取纯文本（兼容两种形状：旧版 block.content 为字符串；当前 DSH
// ToolResultBlock.content 为 ContentBlock[]，文本在 content[0].text）
function toolResultText(block) {
  if (!block) return null
  if (typeof block.content === 'string') return block.content
  if (Array.isArray(block.content)) {
    for (const c of block.content) {
      if (c && typeof c.text === 'string') return c.text
      if (c && typeof c.content === 'string') return c.content
    }
  }
  return null
}
// 把压缩文本写回 tool-result 内容块（保持 ContentBlock[] 形状，文本块 type='text'）
function toolResultContentWith(block, text) {
  if (Array.isArray(block.content)) return [{ ...block, content: [{ type: 'text', text }] }]
  return [{ ...block, content: text }]
}

async function compressPass(session) {
  if (!session || !session.surface || !session.events || !session.append) return 0
  const sid = session.sessionId || 'x'
  let prev = compressPrev.get(sid) ?? null
  let saved = 0
  for (const seq of [...session.surface.nodes]) {
    const ev = session.events[seq]
    if (!ev || ev.type !== 'tool/result') continue
    const msg = ev.data && ev.data.message
    const block = msg && msg.content && msg.content[0]
    const cur = block ? toolResultText(block) : null
    if (cur === null) { prev = null; continue }
    if (restoredSeqSet.has(seq)) { prev = cur; continue } // 已恢复原文的节点豁免压缩
    if (cur.length >= MIN_COMPRESS_CHARS) {
      let replacement = null
      if (prev !== null) replacement = diffCompress(prev, cur)
      if (replacement !== null) {
        try {
          session.append('tool/result', {
            ...ev.data,
            message: { ...msg, content: toolResultContentWith(block, replacement) },
          }, { surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq] })
          compressCount += 1
          saved += cur.length - replacement.length
        } catch { /* 替换失败跳过 */ }
      }
    }
    prev = cur // 记录原始文本供下次 diff
  }
  compressPrev.set(sid, prev)
  return saved
}

const compressPrev = new Map()
let lastSession = null
// 已解压恢复的节点 seq：这些节点保持完整原文，不再参与压缩（用户主动恢复即豁免）
const restoredSeqSet = new Set()

// ---------- 解压恢复原文：把低耗压缩替换掉的工具结果还原为完整原文 ----------
// 压缩只是"表面遮蔽"：原始事件始终留在会话日志里。本函数按 COMPRESS_MARK 识别压缩替换节点，
// 用其 sourceEventSeqs 找回原始事件，以 replace 写回完整原文，并重置 diff 基线防止下个请求再次压缩。
let uncompressedCount = 0

function uncompressPass(session) {
  if (!session || !session.surface || !session.events || !session.append) return 0
  let restored = 0
  for (const seq of [...session.surface.nodes]) {
    const ev = session.events[seq]
    if (!ev || ev.type !== 'tool/result') continue
    if (!ev.surfaceOp || ev.surfaceOp === 'append') continue // 只处理替换节点
    const cur = toolResultText(ev.data && ev.data.message && ev.data.message.content[0])
    if (cur === null || !cur.startsWith(COMPRESS_MARK)) continue // 只还原低耗压缩产生的替换
    const origSeq = Array.isArray(ev.sourceEventSeqs) ? ev.sourceEventSeqs[0] : undefined
    const origEv = origSeq !== undefined ? session.events[origSeq] : undefined
    if (!origEv || origEv.type !== 'tool/result') continue
    try {
      const rep = session.append('tool/result', { ...origEv.data }, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      restoredSeqSet.add(rep.seq)
      restored++
    } catch { /* 还原失败跳过 */ }
  }
  if (restored > 0) {
    uncompressedCount += restored
    compressPrev.delete(session.sessionId || 'x') // 重置 diff 基线，防止下个请求把恢复的原文再次压缩
  }
  return restored
}

function usedPercent(u) {
  if (!u || !u.ok || !u.today) return 0
  return Math.max(
    gateCostLimit > 0 ? (u.today.cost / gateCostLimit) * 100 : 0,
    gateTokenLimit > 0 ? (u.today.tokens / gateTokenLimit) * 100 : 0,
  )
}

// ---------- 应用 ----------
export function apply(ctx) {
  let goCache = null
  let goAt = 0
  let dsCache = null
  let dsAt = 0

  // 跟踪会话（低耗压缩需要重写会话表面）+ 记录本地小时 token 用量（assistant/message 的 usage）
  ctx.on('session/event', (session, event) => {
    lastSession = session
    if (event && event.type === 'assistant/message') recordLocalUsage(event)
  })

  // 拦截 agent 请求：先压缩（接近限额且（默认）高峰时段），超出限额时停在工具断点
  ctx.on('agent/request', async (payload, next) => {
    if (compressEnabled && lastSession) {
      const u = await budgetSnapshot(ctx)
      const peak = !compressPeakOnly || inPeakNow()
      if (peak && usedPercent(u) >= compressAtPercent) {
        try { await compressPass(lastSession) } catch { /* 压缩失败不影响请求 */ }
      }
    }
    if (!gateEnabled) return next()
    const u = await budgetSnapshot(ctx)
    if ((!gatePeakOnly || inPeakNow()) && overBudget(u)) {
      throw new Error('预算已达上限（断点截断）：今日金额或 token 已超出限额，已停止于工具断点，不再发起新请求（会话历史保留，调整限额后可继续）。')
    }
    return next()
  })

  async function statusOpenCode() {
    const now = Date.now()
    if (goCache && now - goAt < BALANCE_CACHE_MS) return goCache
    try {
      const payload = await queryOpenCodeBalance(ctx)
      goCache = payload
      goAt = now
      return payload
    } catch (e1) {
      try {
        const payload = await queryOpenCodeBalance(ctx)
        goCache = payload
        goAt = Date.now()
        return payload
      } catch (e2) {
        const msg = String((e2 && e2.message) || e2).slice(0, 200)
        if (goCache) return { ...goCache, stale: true, error: msg }
        return { ok: false, error: msg }
      }
    }
  }

  async function statusDeepseek() {
    const now = Date.now()
    if (dsCache && now - dsAt < DS_CACHE_MS) return dsCache
    try {
      const payload = await queryDeepseekBalance(ctx)
      dsCache = payload
      dsAt = now
      return payload
    } catch (e1) {
      try {
        const payload = await queryDeepseekBalance(ctx)
        dsCache = payload
        dsAt = Date.now()
        return payload
      } catch (e2) {
        const msg = String((e2 && e2.message) || e2).slice(0, 200)
        if (dsCache) return { ...dsCache, stale: true, error: msg }
        return { ok: false, error: msg }
      }
    }
  }

  function json(res, payload, code = 200) {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(payload))
  }

  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/opencode-go/balance',
      handler: async (_req, res) => {
        try { json(res, await statusOpenCode()) } catch (e) { json(res, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500) }
      },
    })
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/opencode-go/usage',
      handler: async (_req, res) => {
        try {
          const payload = await usageSnapshot(ctx)
          json(res, {
            ...payload,
            enforcement: {
              gateEnabled,
              overBudget: overBudget(payload),
              active: gateEnabled && (!gatePeakOnly || inPeakNow()) && overBudget(payload),
              gatePeakOnly,
              costLimit: gateCostLimit,
              tokenLimit: gateTokenLimit,
              hourLimit: hourLimitEffective(),
              hourOver: hourOverBudget(payload),
              compressEnabled,
              compressActive: compressEnabled && (!compressPeakOnly || inPeakNow()) && usedPercent(payload) >= compressAtPercent,
              compressAtPercent,
              compressPeakOnly,
              compressCount,
            },
          })
        } catch (e) { json(res, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500) }
      },
    })
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/opencode-go/rate',
      handler: async (_req, res) => {
        try {
          const rate = await usdToCnyRate()
          json(res, { ok: true, usdToCny: rate, ts: Date.now() })
        } catch (e) { json(res, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500) }
      },
    })
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/opencode-go/config',
      handler: async (req, res) => {
        try {
          if (req.method === 'POST') {
            let raw = ''
            for await (const chunk of req) raw += chunk
            let body = {}
            try { body = JSON.parse(raw || '{}') } catch { /* 忽略非法体 */ }
            if (typeof body.gateEnabled === 'boolean') gateEnabled = body.gateEnabled
            if (typeof body.gatePeakOnly === 'boolean') gatePeakOnly = body.gatePeakOnly
            if (Number.isFinite(body.costLimit)) gateCostLimit = Math.max(0, body.costLimit)
            if (Number.isFinite(body.tokenLimit)) gateTokenLimit = Math.max(0, Math.floor(body.tokenLimit))
            if (Number.isFinite(body.hourlyTokenLimit)) gateHourLimit = Math.max(0, Math.floor(body.hourlyTokenLimit))
            if (typeof body.compressEnabled === 'boolean') compressEnabled = body.compressEnabled
            if (Number.isFinite(body.compressAtPercent)) compressAtPercent = Math.max(0, Math.min(100, body.compressAtPercent))
            if (typeof body.compressPeakOnly === 'boolean') compressPeakOnly = body.compressPeakOnly
            if (body.uncompress === true && lastSession) {
              try { await uncompressPass(lastSession) } catch { /* 恢复失败不影响请求 */ }
            }
          }
          const u = await budgetSnapshot(ctx)
          const over = overBudget(u)
          json(res, {
            ok: true,
            gateEnabled,
            gatePeakOnly,
            costLimit: gateCostLimit,
            tokenLimit: gateTokenLimit,
            overBudget: over,
            active: gateEnabled && (!gatePeakOnly || inPeakNow()) && over,
            compressEnabled,
            compressActive: compressEnabled && (!compressPeakOnly || inPeakNow()) && usedPercent(u) >= compressAtPercent,
            compressAtPercent,
            compressPeakOnly,
            inPeak: inPeakNow(),
            compressCount,
            uncompressedCount,
          })
        } catch (e) { json(res, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500) }
      },
    })
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/deepseek/balance',
      handler: async (_req, res) => {
        try { json(res, await statusDeepseek()) } catch (e) { json(res, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500) }
      },
    })
    ctx.webServer.register({
      kind: 'exact',
      path: '/api/deepseek/usage',
      handler: async (_req, res) => {
        try { json(res, await statusPlatformUsage(ctx)) } catch (e) { json(res, { ok: false, error: String((e && e.message) || e).slice(0, 200) }, 500) }
      },
    })
  }, 'balance-tabs: /api routes')
}

/**
 * 余额悬浮窗（合并版）—— client 半
 * 双标签页：DeepSeek 余额 / OpenCode Go 余额，标签切换带滑动+淡入动画。
 * 同源接口：
 *   /api/deepseek/balance     — DeepSeek 余额（30s 轮询）
 *   /api/opencode-go/balance  — OpenCode Go 额度（60s 轮询）
 *   /api/opencode-go/usage    — 本地用量（5s 轮询，可选）
 */
window.__ModuleLoader__.load({
  id: 'dsh-save-balance-monitor',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    let React = require('react');

    //#region styles
    const CSS = `
.opencg {
  position: fixed;
  pointer-events: auto;
  z-index: 40;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.28));
  background: var(--dsw-alias-bg-overlay, #fff);
  border-radius: 10px;
  box-shadow: 0 4px 18px rgba(0,0,0,.18);
  padding: 8px 10px;
  font: inherit;
  color: var(--dsw-alias-label-primary, #222);
  user-select: none;
  cursor: grab;
  min-width: 220px;
  min-height: 118px;
  overflow: hidden;
}
.opencg.dragging { cursor: grabbing; }
.opencg.resizing { cursor: nwse-resize; }
.opencg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
  flex: none;
}
.opencg-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #2f9e44);
  animation: opencg-pulse 2s ease infinite;
  flex: none;
}
.opencg-dot.err { background: var(--dsw-alias-state-error-primary, #e03131); animation: none; }
.opencg-dot.idle { background: var(--dsw-alias-label-secondary, #888); animation: none; }
@keyframes opencg-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}
.opencg-tabs { display: flex; gap: 2px; margin-left: 2px; flex: none; }
.opencg-tab {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #888);
  font: inherit;
  font-size: 11px;
  line-height: 1.4;
  padding: 2px 9px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.opencg-tab:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.10)); }
.opencg-tab.active {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16));
  color: var(--dsw-alias-label-primary, #222);
  font-weight: 600;
}
.opencg-refresh {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #888);
  cursor: pointer;
  border-radius: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  flex: none;
}
.opencg-refresh:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14));
  color: var(--dsw-alias-label-primary, #222);
}
.opencg-mini {
  border: 1px solid var(--dsw-alias-border-l2, #ccc);
  background: var(--dsw-specific-tip, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 10px;
  line-height: 1.4;
  padding: 1px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.opencg-mini:hover { background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.14)); }
.opencg-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  margin-top: 6px;
  min-height: 0;
}
/* 标签切换动画：淡入 + 方向滑动 */
.opencg-pane { animation: opencg-tab-in .22s ease both; }
.opencg-pane.left { animation-name: opencg-tab-in-left; }
.opencg-pane.right { animation-name: opencg-tab-in-right; }
@keyframes opencg-tab-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@keyframes opencg-tab-in-left {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: none; }
}
@keyframes opencg-tab-in-right {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: none; }
}
.opencg-row {
  display: grid;
  grid-template-columns: 34px 48px 1fr 44px 74px;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  line-height: 1.7;
  white-space: nowrap;
}
.opencg-row.simple {
  grid-template-columns: 60px 1fr;
  line-height: 1.8;
}
.opencg-name { color: var(--dsw-alias-label-secondary, #888); }
.opencg-rem { font-weight: 700; font-variant-numeric: tabular-nums; font-size: 14px; }
.opencg-used { font-size: 10px; color: var(--dsw-alias-label-secondary, #888); }
.opencg-reset { font-size: 10px; color: var(--dsw-alias-label-secondary, #888); text-align: right; }
.opencg-bar {
  height: 6px;
  border-radius: 3px;
  background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18));
  overflow: hidden;
}
.opencg-bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width .4s ease;
}
.opencg-value { font-weight: 700; font-variant-numeric: tabular-nums; font-size: 15px; }
.opencg-sep {
  height: 1px;
  background: var(--dsw-alias-border-l1, rgba(128,128,128,.22));
  margin: 6px 0;
  flex: none;
}
.opencg-usage {
  font-size: 11px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary, #222);
  white-space: nowrap;
}
.opencg-usage.dim { color: var(--dsw-alias-label-secondary, #888); font-size: 10px; }
.opencg-status {
  font-size: 10px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #888);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.opencg-status.err { color: var(--dsw-alias-state-warn-primary, #f08c00); }
.opencg-hint { font-size: 10px; color: var(--dsw-alias-label-secondary, #888); margin-top: 3px; }
.opencg-resize {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 12px;
  height: 12px;
  cursor: nwse-resize;
  z-index: 1;
}
.opencg-resize::after {
  content: '';
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--dsw-alias-label-secondary, #888);
  border-bottom: 2px solid var(--dsw-alias-label-secondary, #888);
}
`;
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-save-balance-monitor"]') === null) {
      const tag = document.createElement('style');
      tag.setAttribute('data-plugin-css', 'dsh-save-balance-monitor');
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    const inject = ['slots', 'timer'];

    const KEY_POS = 'dsh-save-balance-monitor-pos';
    const KEY_SIZE = 'dsh-save-balance-monitor-size';
    const SETTINGS_KEY = 'dsh-save-balance-monitor:settings';
    const DEFAULT_SETTINGS = { visible: true, saveMode: false, costLimit: 0, tokenLimit: 0, hourlyTokenLimit: 0, analyzeMode: 'off', recCostLimit: 0, recOffpeakHourly: 0, recPeakHourly: 0, recPeakPerProject: 0, recParallel: 1, recDaily: 0, currency: 'CNY', gateOn: false, gatePeakOnly: false, compressOn: false, compressAtPercent: 80, compressPeakOnly: true, soundAlert: true, nearVolume: 0.3, overVolume: 1 };
    const settingsListeners = new Set();

    function loadSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          const s = { ...DEFAULT_SETTINGS, ...parsed };
          // 旧版迁移：autoMode/auto* → analyzeMode（分析模式，只建议不参与设置）
          if (s.analyzeMode === 'off' && parsed.autoMode !== undefined && parsed.autoMode !== 'off') {
            s.analyzeMode = parsed.autoMode;
          }
          // 旧版迁移：7d/hourly → lowcost（低价区分析）
          if (s.analyzeMode === '7d' || s.analyzeMode === 'hourly') {
            s.analyzeMode = 'lowcost';
          }
          return s;
        }
      } catch (e) { /* 可选项 */ }
      return { ...DEFAULT_SETTINGS };
    }
    function saveSettings(next) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* 可选项 */ }
      for (const fn of [...settingsListeners]) { try { fn(next); } catch (e2) { /* ignore */ } }
    }
    function subscribeSettings(fn) {
      settingsListeners.add(fn);
      return () => settingsListeners.delete(fn);
    }

    function loadPos() {
      try {
        const raw = localStorage.getItem(KEY_POS);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') return parsed;
        }
      } catch (e) { /* 可选项 */ }
      return null;
    }
    function loadSize() {
      try {
        const raw = localStorage.getItem(KEY_SIZE);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.w === 'number' && typeof parsed.h === 'number') {
            return { w: Math.max(220, Math.min(560, parsed.w)), h: Math.max(118, Math.min(620, parsed.h)) };
          }
        }
      } catch (e) { /* 可选项 */ }
      return { w: 270, h: 160 };
    }
    const fmtTokens = (n) => {
      if (n == null || !Number.isFinite(n)) return '--';
      if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
      if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
      return String(Math.round(n));
    };
    // 金额换算：host 用量金额均为 DeepSeek 官网价（CNY），按所选单位显示
    const fmtMoney = (cny, cur, rate) => {
      if (!Number.isFinite(cny)) return '--';
      const isCny = cur === 'CNY';
      const v = isCny ? cny : cny / rate;
      const digits = v >= 100 ? 0 : v >= 1 ? 2 : isCny ? 3 : 4;
      return (isCny ? '¥' : '$') + v.toFixed(digits);
    };
    // 余额（DeepSeek API 返回 CNY）→ 所选单位
    const fmtBalance = (cny, cur, rate) => cur === 'CNY' ? '¥' + cny.toFixed(2) : '$' + (cny / rate).toFixed(2);
    // 当前是否 DeepSeek 官方高峰时段（北京时间 09-12 / 14-18）
    const inPeakFromTime = () => {
      const bh = Math.floor(((Date.now() + 8 * 3600000) % 86400000) / 3600000);
      return (bh >= 9 && bh < 12) || (bh >= 14 && bh < 18);
    };
    const fmtReset = (iso) => {
      try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      } catch (e) { return ''; }
    };
    const fmtTime = (ms) => {
      try {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      } catch (e) { return '--:--:--'; }
    };
    // 距额度重置的倒计时文本
    const fmtLeft = (iso) => {
      if (!iso) return '';
      const diff = new Date(iso).getTime() - Date.now();
      if (!Number.isFinite(diff)) return '';
      if (diff <= 0) return '已重置';
      const s = Math.floor(diff / 1000);
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
      if (d > 0) return d + '天' + h + 'h';
      if (h > 0) return h + 'h' + (m > 0 ? m + 'm' : '');
      if (m > 0) return m + 'm' + (s % 60 > 0 ? s % 60 + 's' : '');
      return s + 's';
    };
    // 生效限额：手动设置输入按当前单位（CNY 直接 / USD ×汇率），统一为 CNY 与官网价金额比较
    const effCaps = (s, rate) => ({
      cost: Math.round(((Number(s.costLimit) || 0) * (s.currency === 'CNY' ? 1 : (Number(rate) > 0 ? rate : 7.2))) * 100) / 100,
      tok: Number(s.tokenLimit) || 0,
      hour: Number(s.hourlyTokenLimit) || 0,
    });
    const hasEffectiveCaps = (s, rate) => {
      const e = effCaps(s, rate);
      return e.cost > 0 || e.tok > 0 || e.hour > 0;
    };
    const speak = (text, volume) => {
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        u.volume = volume;
        u.rate = 1;
        synth.cancel();
        synth.speak(u);
      } catch (e) { /* 忽略 */ }
    };
    // 试听：小音量 → 大音量 连播（音量跟随设置）
    const previewAlerts = () => {
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const s = loadSettings();
        const nv = Number.isFinite(Number(s.nearVolume)) ? Math.max(0, Math.min(1, Number(s.nearVolume))) : 0.3;
        const ov = Number.isFinite(Number(s.overVolume)) ? Math.max(0, Math.min(10, Number(s.overVolume))) : 1;
        const u1 = new SpeechSynthesisUtterance('语音提醒测试：接近限额，小音量');
        u1.lang = 'zh-CN'; u1.volume = nv; u1.rate = 1;
        const u2 = new SpeechSynthesisUtterance('语音提醒测试：已达到限额，大音量');
        u2.lang = 'zh-CN'; u2.volume = ov; u2.rate = 1;
        u1.onend = () => { try { synth.speak(u2); } catch (e) { /* 忽略 */ } };
        synth.cancel();
        synth.speak(u1);
      } catch (e) { /* 忽略 */ }
    };

    // 设置行：显示开关 + 省钱模式 + 每日限额（设置 → 常规）
    function BalanceSettingsRow() {
      const [settings, setSettings] = React.useState(loadSettings);
      const [rate, setRate] = React.useState(7.2);
      React.useEffect(() => {
        let alive = true;
        fetch('/api/opencode-go/rate')
          .then((r) => r.json())
          .then((d) => { if (alive && d && Number.isFinite(d.usdToCny) && d.usdToCny > 1) setRate(d.usdToCny); })
          .catch(() => { /* 保持默认 */ });
        return () => { alive = false; };
      }, []);
      const update = (patch) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        saveSettings(next);
      };
      const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
      };
      const inputStyle = { width: 84, font: 'inherit', fontSize: 12 };
      return React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' } },
        React.createElement('div', { key: 'r1', style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('span', { key: 'l', style: { flex: 1, fontSize: 13 } },
            '余额悬浮窗（DeepSeek / OpenCode Go）'),
          React.createElement('input', {
            key: 'vis',
            type: 'checkbox',
            checked: settings.visible !== false,
            onChange: (e) => update({ visible: e.target.checked }),
          }),
        ),
        React.createElement('div', { key: 'r2', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', { key: 'sm', style: { flex: 1, color: 'var(--dsw-alias-label-secondary,#888)' } },
            '省钱模式（限额 + 时段分析）'),
          React.createElement('input', {
            key: 'smcb',
            type: 'checkbox',
            checked: settings.saveMode === true,
            onChange: (e) => update({ saveMode: e.target.checked }),
          }),
        ),
        React.createElement('div', { key: 'r2b', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', { key: 'cu', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '金额单位'),
          React.createElement('select', {
            key: 'cus',
            style: { font: 'inherit', fontSize: 12, width: 96 },
            value: settings.currency,
            onChange: (e) => update({ currency: e.target.value }),
          },
            React.createElement('option', { value: 'CNY' }, '人民币 ¥'),
            React.createElement('option', { value: 'USD' }, '美元 $'),
          ),
          React.createElement('span', { key: 'rt', style: { color: 'var(--dsw-alias-label-secondary,#888)', fontSize: 11 } },
            '汇率 1$≈' + (Number.isFinite(rate) ? rate.toFixed(2) : '7.20') + '¥'),
        ),
        React.createElement('div', { key: 'r3', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', { key: 'cl', style: { color: 'var(--dsw-alias-label-secondary,#888)' } },
            '每日金额上限(手动 ' + (settings.currency === 'CNY' ? '¥)' : '$)')),
          React.createElement('input', {
            key: 'cost',
            type: 'number',
            min: 0,
            step: 0.01,
            style: inputStyle,
            value: settings.costLimit || '',
            placeholder: '不限',
            onChange: (e) => update({ costLimit: num(e.target.value) }),
          }),
          React.createElement('span', { key: 'tl', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '每日 tok 上限(手动)'),
          React.createElement('input', {
            key: 'tok',
            type: 'number',
            min: 0,
            step: 1000,
            style: inputStyle,
            value: settings.tokenLimit || '',
            placeholder: '不限',
            onChange: (e) => update({ tokenLimit: num(e.target.value) }),
          }),
        ),
        React.createElement('div', { key: 'r4', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', { key: 'hl', style: { flex: 1, color: 'var(--dsw-alias-label-secondary,#888)', cursor: 'help' },
            title: '高价区（高峰 09-12 / 14-18）每个小时的 tok 上限：本值为「基准每小时」，高峰时段自动减半后即高价区上限（例如填基准 1500 万，高峰实际限额 750 万）' },
            '高价区每小时 tok 上限(手动，高峰自动减半)'),
          React.createElement('input', {
            key: 'htok',
            type: 'number',
            min: 0,
            step: 1000,
            style: inputStyle,
            value: settings.hourlyTokenLimit || '',
            placeholder: '不限',
            onChange: (e) => update({ hourlyTokenLimit: num(e.target.value) }),
          }),
        ),
        React.createElement('div', { key: 'r5', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', {
            key: 'al',
            style: { flex: 1, color: 'var(--dsw-alias-label-secondary,#888)', cursor: 'help' },
            title: '分析模式：基于官网平台用量（当月日均 token/金额）+ 官方峰谷价（高峰 2 倍、空闲半价）给出建议限额参考值，不参与任何具体设置；建议值可在悬浮窗里一键「采纳」为手动限额（也可直接手动填写上方上限）',
          }, '分析模式（建议参考，不参与设置）'),
          React.createElement('select', {
            key: 'alm',
            style: { font: 'inherit', fontSize: 12, width: 120 },
            value: settings.analyzeMode,
            onChange: (e) => {
              const next = e.target.value;
              if (next !== 'off' && settings.analyzeMode === 'off') {
                const ok = window.confirm(
                  '分析模式说明\n\n此模式「分析」官网平台的真实用量并给出建议限额：\n\n· 每日建议 = 官网当月日均 token / 金额（活跃日平均）\n· 每小时建议 = 日均 ÷ 24；高价时段 2 倍价 → 建议减半\n· 不会自动修改任何限额；点「采纳」一键套用到手动限额\n· 关闭后建议值保留，随时可采纳\n\n确定开启？',
                );
                if (!ok) return;
              }
              update({ analyzeMode: next });
            },
          },
            React.createElement('option', { value: 'off' }, '关闭'),
            React.createElement('option', { value: 'lowcost' }, '官网用量分析'),
          ),
        ),
        React.createElement('div', { key: 'r6', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', {
            key: 'mtl',
            style: { color: 'var(--dsw-alias-label-secondary,#888)', cursor: 'help' },
            title: '额外功能：今日金额或 token 超限后，模型回复允许完整生成（含工具调用）并执行，随后拦截后续请求——停在工具断点，不截断思考链、不回传异常上下文',
          }, '超限断点截断（额外功能）'),
          React.createElement('input', {
            key: 'mton',
            type: 'checkbox',
            checked: settings.gateOn === true,
            onChange: (e) => {
              if (e.target.checked) {
                const capsWarn = !hasEffectiveCaps(settings, rate)
                  ? '\n\n⚠ 当前未设置任何限额（手动上限为空且未开自动限额），开启后不会生效。\n请先设置「每日金额上限」或「每日 tok 上限」（或开启「自动限额」）。'
                  : '';
                const ok = window.confirm(
                  '⚠ 额外功能确认\n\n开启后，当今日金额或 token 超过限额时：\n\n· 当前回复允许完整生成并执行工具调用（天然断点）\n· 之后的请求会被拦截，不再消耗额度\n\n优点：不截断思考链、不回传异常的 reasoning context\n代价：超限后 agent 不再响应新请求，直到调整限额' + capsWarn + '\n\n💡 建议与「低耗压缩」搭配使用：压缩在接近限额/高峰时先把结果省下来，断点截断在超限时兜底硬停——组合拳最省钱\n\n确定开启？',
                );
                if (!ok) return;
              }
              update({ gateOn: e.target.checked });
            },
          }),
          React.createElement('span', { key: 'gpo', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '仅高峰'),
          React.createElement('input', {
            key: 'gpoc',
            type: 'checkbox',
            title: '仅高峰时段（09-12 / 14-18）拦截；取消则任何时段超限即拦截',
            checked: settings.gatePeakOnly === true,
            onChange: (e) => update({ gatePeakOnly: e.target.checked }),
          }),
        ),
        React.createElement('div', { key: 'r8', style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 } },
          React.createElement('span', {
            key: 'cpl',
            style: { color: 'var(--dsw-alias-label-secondary,#888)', cursor: 'help', flex: 1 },
            title: '额外功能：高峰时段（09-12/14-18）用量达到阈值后，大工具结果自动与上次执行结果做行级 diff，只保留变化部分（完全相同则只剩一句"无变化"）——大幅降低上下文与花费',
          }, '低耗压缩（工具结果只留变化）'),
          React.createElement('input', {
            key: 'cpon',
            type: 'checkbox',
            checked: settings.compressOn === true,
            onChange: (e) => {
              if (e.target.checked) {
                const capsWarn = !hasEffectiveCaps(settings, rate)
                  ? '\n\n⚠ 当前未设置任何限额（手动上限为空且未开自动限额），开启后不会生效。\n请先设置「每日金额上限」或「每日 tok 上限」（或开启「自动限额」）。'
                  : '';
                const ok = window.confirm(
                  '⚠ 额外功能确认\n\n开启后，高峰时段（09:00-12:00 / 14:00-18:00，高价期）且用量达到阈值（默认 80%）时，较长的工具执行结果会被压缩：\n\n· 与上次执行结果做行级对比，只保留变化行\n· 完全相同 → 只剩一句"无变化"\n\n注意：压缩是有损的——模型将看不到被省略的未变化部分，可能影响精细任务。' + capsWarn + '\n\n💡 建议与「超限断点截断」搭配使用：压缩先省输入花费，超限再硬停兜底\n\n确定开启？',
                );
                if (!ok) return;
              }
              update({ compressOn: e.target.checked });
            },
          }),
          React.createElement('span', { key: 'cpt', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '阈值%'),
          React.createElement('input', {
            key: 'cpv',
            type: 'number',
            min: 1,
            max: 100,
            step: 5,
            style: { width: 56, font: 'inherit', fontSize: 12 },
            value: settings.compressAtPercent ?? 80,
            onChange: (e) => update({ compressAtPercent: num(e.target.value) }),
          }),
          React.createElement('span', { key: 'cpo', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '仅高峰'),
          React.createElement('input', {
            key: 'cpoc',
            type: 'checkbox',
            title: '仅高峰时段（09-12 / 14-18）激活压缩；取消则任何时段达到阈值即压缩',
            checked: settings.compressPeakOnly !== false,
            onChange: (e) => update({ compressPeakOnly: e.target.checked }),
          }),
          React.createElement('button', {
            key: 'unc',
            style: { font: 'inherit', fontSize: 12, padding: '2px 8px', cursor: 'pointer', border: '1px solid var(--dsw-alias-line-border,#555)', background: 'transparent', color: 'inherit', borderRadius: 4 },
            title: '把低耗压缩替换掉的工具结果恢复为完整原文（原文一直在会话日志中，从未删除；恢复后模型后续请求将读到完整内容）',
            onClick: async () => {
              try {
                const r = await fetch('/api/opencode-go/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uncompress: true }) })
                const j = await r.json()
                const n = j && j.uncompressedCount
                window.alert(n > 0 ? `已恢复 ${n} 条压缩结果为完整原文（模型后续请求将读到原文）` : '当前会话没有可恢复的压缩结果')
              } catch (e2) { window.alert('恢复原文失败：' + e2.message) }
            },
          }, '恢复原文'),
        ),
        React.createElement('div', { key: 'r7', style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' } },
          React.createElement('span', { key: 'sl', style: { flex: 1, minWidth: 150, color: 'var(--dsw-alias-label-secondary,#888)' } },
            '语音提醒（接近/超限）'),
          React.createElement('input', {
            key: 'slt',
            type: 'checkbox',
            checked: settings.soundAlert !== false,
            onChange: (e) => update({ soundAlert: e.target.checked }),
          }),
          React.createElement('span', { key: 'nvl', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '接近音量'),
          React.createElement('input', {
            key: 'nvv',
            type: 'number',
            min: 0,
            max: 1,
            step: 0.05,
            style: { width: 56, font: 'inherit', fontSize: 12 },
            value: settings.nearVolume ?? 0.3,
            onChange: (e) => update({ nearVolume: num(e.target.value) }),
          }),
          React.createElement('span', { key: 'ovl', style: { color: 'var(--dsw-alias-label-secondary,#888)' } }, '超限音量(0-10)'),
          React.createElement('input', {
            key: 'ovv',
            type: 'number',
            min: 0,
            max: 10,
            step: 0.1,
            style: { width: 56, font: 'inherit', fontSize: 12 },
            value: settings.overVolume ?? 1,
            onChange: (e) => update({ overVolume: num(e.target.value) }),
          }),
          React.createElement('button', {
            key: 'prev',
            type: 'button',
            title: '试听：先接近音量，后超限音量',
            style: {
              font: 'inherit', fontSize: 12, padding: '1px 10px', borderRadius: 6,
              border: '1px solid var(--dsw-alias-border-l2,#ccc)',
              background: 'transparent', color: 'var(--dsw-alias-label-primary,inherit)', cursor: 'pointer',
            },
            onClick: previewAlerts,
          }, '试听'),
        ),
      );
    }

    function apply(ctx) {
      // 注册设置行
      const slotsSvc = ctx.get('slots');
      if (slotsSvc !== void 0) {
        ctx.effect(() => slotsSvc.inject('settings.general.item', () => slotsSvc.register(
          { name: 'settings.general.item', id: 'opencode-go-monitor', order: 80 },
          BalanceSettingsRow,
        )), 'opencode-go-monitor: settings row');
      }
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'opencode-go-monitor', order: 0, label: '余额悬浮窗' },
        (props) => {
          const [go, setGo] = React.useState(null);
          const [goErr, setGoErr] = React.useState(null);
          const [use, setUse] = React.useState(null);
          const [useErr, setUseErr] = React.useState(null);
          const [ds, setDs] = React.useState(null);
          const [dsErr, setDsErr] = React.useState(null);
          const [tab, setTab] = React.useState('go');
          const [dir, setDir] = React.useState('right');
          const [pos, setPos] = React.useState(loadPos);
          const [size, setSize] = React.useState(loadSize);
          const [dragging, setDragging] = React.useState(false);
          const [resizing, setResizing] = React.useState(false);
          const dragRef = React.useRef(null);
          const resizeRef = React.useRef(null);
          const sizeRef = React.useRef(size);

          const applySize = (next) => { sizeRef.current = next; setSize(next); };

          const refreshGo = React.useCallback(async () => {
            try {
              const res = await fetch('/api/opencode-go/balance');
              const data = await res.json();
              if (data && (data.ok || data.stale)) { setGo(data); setGoErr(null); }
              else { setGo(null); setGoErr(data && data.error ? data.error : '获取失败'); }
            } catch (e) { setGo(null); setGoErr(String((e && e.message) || e)); }
          }, []);

          const refreshUse = React.useCallback(async () => {
            try {
              const res = await fetch('/api/opencode-go/usage');
              const data = await res.json();
              if (data && data.ok) { setUse(data); setUseErr(null); }
              else { setUseErr(data && data.error ? data.error : '获取失败'); }
            } catch (e) { setUseErr(String((e && e.message) || e)); }
          }, []);

          const refreshDs = React.useCallback(async () => {
            try {
              const res = await fetch('/api/deepseek/balance');
              const data = await res.json();
              if (data && (data.ok || data.stale)) { setDs(data); setDsErr(null); }
              else { setDs(null); setDsErr(data && data.error ? data.error : '获取失败'); }
            } catch (e) { setDs(null); setDsErr(String((e && e.message) || e)); }
          }, []);

          // 官网平台用量（当月 token/金额/请求数，需 DEEPSEEK_PLATFORM_TOKEN）
          const [pu, setPu] = React.useState(null);
          const refreshPu = React.useCallback(async () => {
            try {
              const res = await fetch('/api/deepseek/usage');
              const data = await res.json();
              setPu(data && (data.ok || data.stale) ? data : (data || null));
            } catch (e) { setPu({ ok: false, error: String((e && e.message) || e) }); }
          }, []);

          const refresh = React.useCallback(() => { refreshGo(); refreshUse(); refreshDs(); refreshPu(); }, [refreshGo, refreshUse, refreshDs, refreshPu]);

          React.useEffect(() => {
            refresh();
            const stop1 = ctx.interval(refreshGo, 60000);
            const stop2 = ctx.interval(refreshUse, 5000);
            const stop3 = ctx.interval(refreshDs, 30000);
            const stop4 = ctx.interval(refreshPu, 30000);
            return () => { stop1(); stop2(); stop3(); stop4(); };
          }, [refresh, refreshGo, refreshUse, refreshDs, refreshPu]);

          // 设置 → 常规：显示/隐藏 + 省钱模式 + 限额（订阅全部设置项）
          const [settings, setSettings] = React.useState(loadSettings);
          React.useEffect(() => subscribeSettings((s) => setSettings(s)), []);

          // 汇率（USD→CNY）：来自 host /api/opencode-go/rate，失败用默认 7.2
          const [rate, setRate] = React.useState(7.2);
          React.useEffect(() => {
            let alive = true;
            fetch('/api/opencode-go/rate')
              .then((r) => r.json())
              .then((d) => { if (alive && d && Number.isFinite(d.usdToCny) && d.usdToCny > 1) setRate(d.usdToCny); })
              .catch(() => { /* 保持默认 */ });
            return () => { alive = false; };
          }, []);

          // 分析模式（官网用量分析）：官网当月日均 → 每日/每小时建议限额（只出建议，不参与设置）
          React.useEffect(() => {
            if (settings.analyzeMode !== 'lowcost') return;
            const puOk = pu && pu.ok && pu.dailyAvgTokens > 0;   // 官网平台数据可用（当月日均）
            if (!puOk) return;
            const recOff = Math.round(pu.dailyAvgTokens / 24);   // 基准每小时 = 日均 ÷ 24
            const recPeak = Math.round(recOff / 2);              // 高价区 2 倍价 → 建议每小时减半
            const recDaily = pu.dailyAvgTokens;                  // 每日建议 = 官网日均
            const rCost = Math.round(pu.dailyAvgCost * 100) / 100;
            if (settings.recOffpeakHourly !== recOff || settings.recPeakHourly !== recPeak
              || settings.recDaily !== recDaily || settings.recCostLimit !== rCost) {
              saveSettings({ ...settings, recOffpeakHourly: recOff, recPeakHourly: recPeak, recDaily, recCostLimit: rCost });
            }
          }, [pu, settings]);

          // 每秒滴答：驱动额度重置倒计时
          const [, setTick] = React.useState(0);
          React.useEffect(() => ctx.interval(() => setTick((t) => t + 1), 1000), []);

          // 超限断点截断 + 低耗压缩 + 高价区每小时限额：同步开关与生效限额到 host
          React.useEffect(() => {
            const caps = effCaps(settings, rate);
            fetch('/api/opencode-go/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                gateEnabled: settings.gateOn === true,
                gatePeakOnly: settings.gatePeakOnly === true,
                costLimit: caps.cost,
                tokenLimit: caps.tok,
                hourlyTokenLimit: caps.hour, // 高价区每小时限额（基准每小时）
                compressEnabled: settings.compressOn === true,
                compressAtPercent: Number(settings.compressAtPercent) || 80,
                compressPeakOnly: settings.compressPeakOnly !== false,
              }),
            }).catch(() => { /* 下次重试 */ });
          }, [settings.gateOn, settings.gatePeakOnly, settings.costLimit, settings.tokenLimit,
              settings.hourlyTokenLimit, settings.currency, rate,
              settings.compressOn, settings.compressAtPercent, settings.compressPeakOnly]);

          const switchTab = (next) => {
            setTab((prev) => {
              if (prev === next) return prev;
              setDir(next === 'go' ? 'right' : 'left');
              return next;
            });
          };

          // 语音限额提醒：接近（剩余≤2%）小音量 / 达到（超限）大音量，各自触发一次（今日用量=官网平台）
          const alertRef = React.useRef({ near: {}, over: {} });
          React.useEffect(() => {
            if (settings.saveMode !== true || settings.soundAlert === false) {
              alertRef.current = { near: {}, over: {} };
              return;
            }
            const t = use && use.today;
            if (!t) return;
            const st = alertRef.current;
            const caps = effCaps(settings, rate);
            const check = (key, used, cap, nearText, overText) => {
              if (cap <= 0) return;
              const ratio = used / cap;
              const nearVol = Number.isFinite(Number(settings.nearVolume)) ? Math.max(0, Math.min(1, Number(settings.nearVolume))) : 0.3;
              const overVol = Number.isFinite(Number(settings.overVolume)) ? Math.max(0, Math.min(10, Number(settings.overVolume))) : 1;
              if (ratio >= 1) {
                if (!st.over[key]) { st.over[key] = true; speak(overText, overVol); }
              } else if (ratio >= 0.98) {
                if (!st.near[key]) { st.near[key] = true; speak(nearText, nearVol); }
              } else {
                st.near[key] = false;
                st.over[key] = false;
              }
            };
            check('cost', t.cost, caps.cost,
              '今日金额已用百分之九十八，即将达到上限', '今日金额已达上限，建议停止使用');
            check('tok', t.tokens, caps.tok,
              '今日token已用百分之九十八，即将达到上限', '今日token已达上限，建议停止使用');
            // 高价区每小时限额（当前小时 token = 本地实时推算；生效值 host 已按高峰减半算好）
            if (caps.hour > 0) {
              const hourTok = (use.hourNow && use.hourNow.tokens) || 0;
              const enf = use && use.enforcement;
              const effHour = (enf && enf.hourLimit) || caps.hour;
              check('hour', hourTok, effHour,
                '本小时token已接近高价区限额',
                inPeakFromTime() ? '本小时已达高价区限额，建议暂停或等空闲时段' : '本小时已达限额上限');
            }
          }, [use, settings]);

          if (settings.visible === false) return null;

          // ---- 拖动 ----
          const onPointerDown = (e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { sx: e.clientX, sy: e.clientY, bx: pos ? pos.x : 16, by: pos ? pos.y : 168 };
            setDragging(true);
          };
          const onPointerMove = (e) => {
            const d = dragRef.current;
            if (!d) return;
            setPos({ x: d.bx + (e.clientX - d.sx), y: d.by - (e.clientY - d.sy) });
          };
          const onPointerUp = (e) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDragging(false);
            if (d) {
              if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 4) {
                refresh();
              } else {
                const next = { x: d.bx + (e.clientX - d.sx), y: d.by - (e.clientY - d.sy) };
                try { localStorage.setItem(KEY_POS, JSON.stringify(next)); } catch (e2) { /* 可选项 */ }
              }
            }
          };

          // ---- 调整大小 ----
          const onResizeDown = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: sizeRef.current.w, sh: sizeRef.current.h };
            setResizing(true);
          };
          const onResizeMove = (e) => {
            const d = resizeRef.current;
            if (!d) return;
            applySize({
              w: Math.max(220, Math.min(560, d.sw + (e.clientX - d.sx))),
              h: Math.max(118, Math.min(620, d.sh - (e.clientY - d.sy))),
            });
          };
          const onResizeUp = () => {
            const d = resizeRef.current;
            resizeRef.current = null;
            setResizing(false);
            if (d) { try { localStorage.setItem(KEY_SIZE, JSON.stringify(sizeRef.current)); } catch (e2) { /* 可选项 */ } }
          };

          // ---- 渲染 ----
          const goErrActive = tab === 'go' && (goErr || useErr);
          const dsErrActive = tab === 'ds' && dsErr;
          const curErr = tab === 'go' ? (goErr || useErr) : dsErr;
          const curData = tab === 'go' ? go : ds;
          const dotClass = curErr ? 'opencg-dot err' : (curData ? 'opencg-dot' : 'opencg-dot idle');

          const quotaRow = (k, name, w) => {
            let rem = null, used = null, color = '#9AA0A6';
            if (w && typeof w.percent === 'number') {
              used = w.percent;
              rem = Math.max(0, Math.min(100, Math.round(100 - used)));
              color = rem >= 50 ? '#16A34A' : (rem >= 25 ? '#D97706' : '#DC2626');
            }
            const bar = React.createElement('div', { className: 'opencg-bar', key: k + '-bar' },
              rem != null ? React.createElement('i', { style: { width: rem + '%', background: color } }) : null);
            return React.createElement('div', { className: 'opencg-row', key: k },
              React.createElement('span', { className: 'opencg-name' }, name),
              React.createElement('span', { className: 'opencg-rem', style: rem != null ? { color } : undefined }, rem != null ? rem + '%' : '--'),
              bar,
              React.createElement('span', { className: 'opencg-used' }, used != null ? '已用' + Math.round(used) + '%' : (w && w.status ? w.status : '')),
              React.createElement('span', {
                className: 'opencg-reset',
                title: w && w.resetsAt ? '重置: ' + fmtReset(w.resetsAt) : '',
              }, w && w.resetsAt ? fmtLeft(w.resetsAt) : ''),
            );
          };

          // OpenCode Go 面板
          const goChildren = [];
          goChildren.push(quotaRow('m', '月度', go && go.monthly));
          goChildren.push(quotaRow('r', '滚动', go && go.rolling));
          goChildren.push(quotaRow('w', '每周', go && go.weekly));

          const goStatus = (goErr ? '余额失败' : (go ? '余额 ' + fmtTime(go.fetchedAt) : '余额 --'))
            + (go && go.stale ? ' · 数据过期' : '');
          goChildren.push(React.createElement('div', {
            className: goErr ? 'opencg-status err' : 'opencg-status',
            key: 'st',
            title: goErr ? '余额: ' + goErr : '',
          }, goStatus));

          // DeepSeek 面板
          const dsChildren = [];
          const dsBalanceText = ds ? fmtBalance(ds.balance, settings.currency, rate) : '--';
          const dsTokenText = ds ? '≈' + fmtTokens(ds.estTokens) + ' tok' : '--';
          dsChildren.push(React.createElement('div', { className: 'opencg-row simple', key: 'd1' },
            React.createElement('span', { className: 'opencg-name' }, '余额'),
            React.createElement('span', { className: 'opencg-value' }, dsBalanceText)));
          dsChildren.push(React.createElement('div', { className: 'opencg-row simple', key: 'd2' },
            React.createElement('span', { className: 'opencg-name' }, '预计剩余'),
            React.createElement('span', { className: 'opencg-value', style: { fontSize: 13 } }, dsTokenText)));
          // 官网平台用量（当月，需 DEEPSEEK_PLATFORM_TOKEN）
          if (pu) {
            if (pu.ok) {
              dsChildren.push(React.createElement('div', { className: 'opencg-row simple', key: 'pu1' },
                React.createElement('span', { className: 'opencg-name' }, '官网当月'),
                React.createElement('span', { className: 'opencg-value', style: { fontSize: 11 } },
                  fmtTokens(pu.totalTokens) + ' tok · ' + fmtMoney(pu.totalCost, settings.currency, rate) + ' · ' + pu.requestCount + ' 次')));
              dsChildren.push(React.createElement('div', { key: 'pu2', style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary,#888)' } },
                pu.month + '月 · ' + (pu.activeDays || 0) + ' 天有请求 · 日均 ' + fmtTokens(pu.dailyAvgTokens) + ' tok · ' + fmtMoney(pu.dailyAvgCost, settings.currency, rate) + '/日（官网平台）'));
            } else {
              dsChildren.push(React.createElement('div', { key: 'pu2', style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary,#888)' } },
                '官网用量: ' + (pu.error || '获取失败')));
            }
          }
          // DeepSeek 官方高低价时段（北京时间高峰 09-12 / 14-18，空闲半价）——纯时间计算，不依赖历史数据
          {
            const bh = Math.floor(((Date.now() + 8 * 3600000) % 86400000) / 3600000);
            const isPeakNow = (bh >= 9 && bh < 12) || (bh >= 14 && bh < 18);
            const nextChange = isPeakNow
              ? (bh < 12 ? 12 * 60 - (bh * 60 + new Date().getUTCMinutes()) : 18 * 60 - (bh * 60 + new Date().getUTCMinutes()))
              : (bh < 9 ? 9 * 60 - (bh * 60 + new Date().getUTCMinutes()) : 14 * 60 - (bh * 60 + new Date().getUTCMinutes()));
            const mins = Math.max(0, Math.round(nextChange));
            const fmtMin = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60 ? m % 60 + 'm' : '') : m + 'm');
            dsChildren.push(React.createElement('div', { className: 'opencg-row simple', key: 'w1' },
              React.createElement('span', { className: 'opencg-name' }, '官方时段'),
              React.createElement('span', { style: { fontSize: 11 } }, '高峰 09-12 / 14-18 (UTC+8) · 空闲半价')));
            dsChildren.push(React.createElement('div', { className: 'opencg-row simple', key: 'w2' },
              React.createElement('span', { className: 'opencg-name' }, '当前时段'),
              React.createElement('span', { style: { fontSize: 11, fontWeight: 600, color: isPeakNow ? '#D97706' : '#16A34A' } },
                isPeakNow ? '高峰 · 距空闲 ' + fmtMin(mins) : '空闲(半价) · 距高峰 ' + fmtMin(mins))));
          }
          // 当前时段建议（纯价格逻辑）
          {
            const bh = Math.floor(((Date.now() + 8 * 3600000) % 86400000) / 3600000);
            const isPeakNow = (bh >= 9 && bh < 12) || (bh >= 14 && bh < 18);
            dsChildren.push(React.createElement('div', { key: 'an2', style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary,#888)' } },
              isPeakNow ? '建议: 当前高峰时段(2倍价)，重任务等空闲再跑' : '建议: 当前空闲时段(半价)，适合跑重任务'));
          }
          // 分析建议（官网口径）+ 一键采纳为手动限额
          if (settings.analyzeMode === 'lowcost' && Number(settings.recDaily) > 0) {
              const recText = '建议: 每日 ≤' + fmtTokens(settings.recDaily) + ' tok · ' + fmtMoney(Number(settings.recCostLimit), settings.currency, rate)
                + '/日 · 每小时 ≤' + fmtTokens(settings.recOffpeakHourly) + '（高峰自动减半=' + fmtTokens(settings.recPeakHourly) + '）';
              dsChildren.push(React.createElement('div', {
                key: 'an6',
                style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#6B7280', marginTop: 2 },
              },
                React.createElement('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, recText),
                React.createElement('button', {
                  type: 'button',
                  className: 'opencg-mini',
                  title: '把分析建议套用到手动限额：每日 tok=' + fmtTokens(settings.recDaily) + '、每小时=' + fmtTokens(settings.recOffpeakHourly) + '（高峰自动减半=建议高价区值）、每日金额=' + fmtMoney(Number(settings.recCostLimit), settings.currency, rate),
                  onPointerDown: (e) => e.stopPropagation(),
                  onClick: (e) => {
                    e.stopPropagation();
                    const s = loadSettings();
                    saveSettings({
                      ...s,
                      // 金额按当前单位存储：CNY 直接存官网价；USD 换算后存（effCaps 会再统一回 CNY）
                      costLimit: s.currency === 'CNY' ? (Number(settings.recCostLimit) || 0)
                        : Math.round(((Number(settings.recCostLimit) || 0) / (Number(rate) > 0 ? rate : 7.2)) * 100) / 100,
                      tokenLimit: Number(settings.recDaily) || 0,
                      // 高价区每小时上限 = 基准每小时（日均÷24）：高峰自动减半后恰为建议的高价区值
                      hourlyTokenLimit: Number(settings.recOffpeakHourly) || 0,
                    });
                  },
                }, '采纳'),
              ));
            }
            if (settings.gateOn === true) {
              const enf = use && use.enforcement;
              const on = enf && enf.active === true;
              const noCaps = !hasEffectiveCaps(settings);
              const gPeak = settings.gatePeakOnly === true;
              let gtxt;
              if (noCaps) gtxt = '未设限额（先去设置每日金额/tok 上限）';
              else if (on) gtxt = '已超限，将拦截新请求';
              else if (enf && enf.overBudget) gtxt = '已超限（拦截待触发）' + (gPeak ? '· 仅高峰' : '');
              else gtxt = '开（限额内）' + (gPeak ? '· 仅高峰' : '');
              dsChildren.push(React.createElement('div', {
                key: 'an4',
                style: { fontSize: 10, color: on ? '#DC2626' : (noCaps ? '#F08C00' : 'var(--dsw-alias-label-secondary,#888)') },
              }, '断点截断: ' + gtxt));
            }
            if (settings.compressOn === true) {
              const enf = use && use.enforcement;
              const act = enf && enf.compressActive === true;
              const noCaps = !hasEffectiveCaps(settings);
              const peakOnly = settings.compressPeakOnly !== false;
              let ctxt;
              if (noCaps) ctxt = '未设限额（先去设置每日金额/tok 上限）';
              else if (act) ctxt = '已激活（阈值 ' + enf.compressAtPercent + '%' + (peakOnly ? '· 高峰' : '') + '）· 压缩 ' + enf.compressCount + ' 次';
              else ctxt = '开（未达激活条件）' + (peakOnly ? '· 仅高峰' : '');
              dsChildren.push(React.createElement('div', {
                key: 'an5',
                style: { fontSize: 10, color: act ? '#D97706' : (noCaps ? '#F08C00' : 'var(--dsw-alias-label-secondary,#888)') },
              }, '低耗压缩: ' + ctxt));
            }
          // ---- 省钱：限额监控（金额 + tok，省钱模式开启时显示进度条；今日用量=官网平台） ----
          const saveOn = settings.saveMode === true;
          const bhNow = Math.floor(((Date.now() + 8 * 3600000) % 86400000) / 3600000);
          const isPeakNowAny = (bhNow >= 9 && bhNow < 12) || (bhNow >= 14 && bhNow < 18);
          if (saveOn && use && use.today) {
            const cost = use.today.cost;
            const caps = effCaps(settings, rate);
            const costCap = caps.cost;
            const tokens = use.today.tokens;
            const tokenCap = caps.tok;
            // 高价区每小时限额：当前小时 token（本地实时）vs 生效限额（高峰自动减半，host 已算）
            const hourTok = (use.hourNow && use.hourNow.tokens) || 0;
            const enfHour = use && use.enforcement && use.enforcement.hourLimit;
            const effHourCap = (enfHour > 0 ? enfHour : caps.hour);
            const costOver = costCap > 0 && cost > costCap;
            const tokenOver = tokenCap > 0 && tokens > tokenCap;
            const hourOver = caps.hour > 0 && hourTok > effHourCap;
            const over = costOver || tokenOver || hourOver;
            const budgetRow = (label, text, used, cap) => React.createElement('div', {
              key: label,
              style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: 1.7, whiteSpace: 'nowrap' },
            },
              React.createElement('span', { style: { width: 34, color: 'var(--dsw-alias-label-secondary,#888)' } }, label),
              React.createElement('span', { style: { width: 104, fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }, text),
              cap > 0
                ? React.createElement('div', {
                    style: { flex: 1, height: 5, borderRadius: 3, background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.18))', overflow: 'hidden' },
                  }, React.createElement('div', {
                    style: {
                      height: '100%', borderRadius: 3,
                      background: used > cap ? '#DC2626' : '#16A34A',
                      width: Math.min(100, (used / cap) * 100) + '%',
                    },
                  }))
                : React.createElement('span', { style: { flex: 1 } }),
            );
            dsChildren.push(budgetRow('金额', fmtMoney(cost, settings.currency, rate) + (costCap > 0 ? '/' + fmtMoney(costCap, settings.currency, rate) : ''), cost, costCap));
            dsChildren.push(budgetRow('tok', fmtTokens(tokens) + (tokenCap > 0 ? '/' + fmtTokens(tokenCap) : ''), tokens, tokenCap));
            if (caps.hour > 0) {
              dsChildren.push(budgetRow('小时', fmtTokens(hourTok) + (effHourCap > 0 ? '/' + fmtTokens(effHourCap) : ''), hourTok, effHourCap));
            }
            if (over) {
              let msg = '⚠ 已达上限，建议暂停使用';
              if (hourOver) msg = isPeakNowAny ? '⚠ 本小时已达高价区限额（高峰半减），建议暂停或等空闲' : '⚠ 本小时已达限额';
              else if (tokenOver) msg = '⚠ 今日 tok 已达上限';
              else if (costOver) msg = '⚠ 今日金额已达上限';
              dsChildren.push(React.createElement('div', {
                key: 'over',
                style: { fontSize: 11, fontWeight: 600, color: '#DC2626' },
              }, msg));
            }
          }
          dsChildren.push(React.createElement('div', { key: 'save-btns', style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
            React.createElement('button', {
              type: 'button',
              className: 'opencg-mini',
              title: '开关省钱模式（限额进度条）',
              onPointerDown: (e) => e.stopPropagation(),
              onClick: (e) => {
                e.stopPropagation();
                const s = loadSettings();
                saveSettings({ ...s, saveMode: !s.saveMode });
              },
            }, saveOn ? '省钱:开' : '省钱:关'),
            React.createElement('button', {
              type: 'button',
              className: 'opencg-mini',
              title: '分析模式：官网用量分析（官网当月日均 → 建议限额；只出建议，不参与设置）',
              onPointerDown: (e) => e.stopPropagation(),
              onClick: (e) => {
                e.stopPropagation();
                const s = loadSettings();
                const next = s.analyzeMode === 'off' ? 'lowcost' : 'off';
                saveSettings({ ...s, analyzeMode: next });
              },
            }, settings.analyzeMode === 'lowcost' ? '分析:官网' : '分析:关'),
          ));
          if (ds && ds.model) {
            dsChildren.push(React.createElement('div', { className: 'opencg-row simple', key: 'd3' },
              React.createElement('span', { className: 'opencg-name' }, '模型'),
              React.createElement('span', { className: 'opencg-value', style: { fontSize: 12, fontWeight: 600 } }, ds.model)));
          }
          const dsStatus = dsErr ? '余额获取失败' : (ds ? '余额 ' + fmtTime(ds.fetchedAt) + ' · 每 30s 刷新' : '余额 --');
          dsChildren.push(React.createElement('div', {
            className: dsErr ? 'opencg-status err' : 'opencg-status',
            key: 'st',
            title: dsErr ? '余额: ' + dsErr : (ds ? '预计剩余按 ¥' + ds.pricePerMillion + '/百万 token 估算' : ''),
          }, dsStatus));

          const paneChildren = tab === 'go' ? goChildren : dsChildren;
          const pane = React.createElement('div', {
            key: tab,
            className: 'opencg-pane ' + dir,
          }, paneChildren);

          const body = React.createElement('div', { className: 'opencg-body', key: 'body' }, pane);

          const header = React.createElement('div', { className: 'opencg-header', key: 'h' },
            React.createElement('span', { className: dotClass }),
            React.createElement('div', { className: 'opencg-tabs' },
              React.createElement('button', {
                type: 'button',
                className: tab === 'ds' ? 'opencg-tab active' : 'opencg-tab',
                onClick: () => switchTab('ds'),
                onPointerDown: (e) => e.stopPropagation(),
              }, 'DeepSeek'),
              React.createElement('button', {
                type: 'button',
                className: tab === 'go' ? 'opencg-tab active' : 'opencg-tab',
                onClick: () => switchTab('go'),
                onPointerDown: (e) => e.stopPropagation(),
              }, 'OpenCode Go'),
            ),
            React.createElement('button', {
              type: 'button',
              className: 'opencg-refresh',
              title: '立即刷新',
              'aria-label': '立即刷新',
              onPointerDown: (e) => e.stopPropagation(),
              onClick: (e) => { e.stopPropagation(); refresh(); },
            }, '↻'),
          );

          const hint = React.createElement('div', { className: 'opencg-hint', key: 'tip' },
            '点击面板刷新 · 拖动 · 右下角调整大小');

          let tip = '余额悬浮窗';
          if (tab === 'go') {
            const parts = [];
            if (go) {
              for (const pair of [['月度', go.monthly], ['滚动', go.rolling], ['每周', go.weekly]]) {
                const w = pair[1];
                if (w && typeof w.percent === 'number') parts.push(pair[0] + '剩余' + Math.round(100 - w.percent) + '%');
              }
              if (parts.length) tip = 'OpenCode Go: ' + parts.join(' · ');
              if (go.stale) tip += ' · 数据过期';
            }
          } else {
            if (ds) {
              tip = 'DeepSeek 余额 ' + dsBalanceText + (ds.model ? ' · ' + ds.model : '')
                + ' · 预计剩余 ' + fmtTokens(ds.estTokens) + ' tokens（按 ¥' + ds.pricePerMillion + '/百万估算）';
              if (ds.stale) tip += ' · 数据过期';
            } else if (dsErr) tip = 'DeepSeek 余额获取失败：' + dsErr + '（点击重试）';
          }

          const resizeHandle = React.createElement('div', {
            key: 'rz',
            className: 'opencg-resize',
            title: '调整大小',
            'aria-label': '调整大小',
            onPointerDown: onResizeDown,
            onPointerMove: onResizeMove,
            onPointerUp: onResizeUp,
          });

          return React.createElement('div', {
            className: (dragging ? 'opencg dragging ' : 'opencg ') + (resizing ? 'resizing' : ''),
            style: {
              left: (pos ? pos.x : 16) + 'px',
              bottom: (pos ? pos.y : 168) + 'px',
              width: size.w + 'px',
              height: size.h + 'px',
            },
            title: tip,
            'aria-label': tip,
            onPointerDown,
            onPointerMove,
            onPointerUp,
          }, header, body, hint, resizeHandle);
        },
      )), 'opencode-go-monitor: overlay slot');
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});

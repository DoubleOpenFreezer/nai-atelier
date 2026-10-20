/* =====================================================================
 * 一键 Roll · 工作区视图（v2，v170-72 优化轮）
 * ---------------------------------------------------------------------
 * 定位不变：从六个词库各抽 1 条组成组合，**不直接出图**、不改写词库条目。
 * v2 做的事（对应优化需求）：
 *   · 目标角色不在这一页伪造：这一页只带「组合」进 pending-import，由实验室按最新状态选目标（§二）
 *   · 每栏「换一个」（排除当前项，候选不足如实说明）（§6.1）
 *   · 参与 / 固定 语义分开：取消参与保留记忆但置灰；空栏不显示已固定；固定项被删标失效（§6.3）
 *   · 上一组 / 下一组（会话内 20 组）；「还原这组组合」与「按随机设置重新抽取」分开（§七）
 *   · 组合随机码 + 算法版本 + 候选池指纹进「技术详情」（§七证据）
 *   · 风格「保持当前」与「选择一个风格串」分开，未选择不等于清空（§八）
 *   · 存为搭配四态 + 服务端回执 id + 稳定操作 id（§五）
 *   · 未消费导入不静默覆盖；本地存储失败不影响页面可用（§二 / R17）
 *
 * 注入位置：index 主 bundle 模块作用域（可用 N = React、g = jsx、xk = pending-import 键、we = 既有 HTTP 客户端、uc = id 生成器）。
 * 随机与池子逻辑全在 __naiRollCore（纯函数，可单测）。
 * jsx 约定：key 一律写在 props 对象里，不使用 jsx/jsxs 的第三、四个参数。
 * ===================================================================== */
/* __NAI_ROLL_VIEW_BEGIN__ */
const __NAI_ROLL_STORE = 'nai_roll_last';
const __NAI_ROLL_PENDING = 'nai_roll_preset_pending';
const __NAI_ROLL_CONTENT_PENDING = 'nai_roll_content_pending';
const __NAI_ROLL_HISTORY_MAX = 20;
const __NAI_ROLL_HUB_KIND = 'nai-prompt-library-kind';

const __naiRollToast = (notify, text, tone) => { try { notify(text, tone); } catch (_e) { /* 提示失败不影响功能 */ } };
const __naiRollNewSeed = () => {
  let body = '';
  try {
    const bytes = new Uint8Array(6);
    window.crypto.getRandomValues(bytes);
    for (const byte of bytes) body += byte.toString(16).padStart(2, '0');
  } catch (_e) {
    body = Math.random().toString(16).slice(2, 14);
  }
  return 'r' + body;
};
/* 幂等键：服务端只把 /^agent-[a-f0-9]{64}$/ 当幂等键（见 dist/_worker.js），位数不够会被忽略并另生成 UUID。 */
const __naiRollHex64 = () => {
  let body = '';
  try {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    for (const byte of bytes) body += byte.toString(16).padStart(2, '0');
  } catch (_e) {
    body = (String(Date.now().toString(16)) + '0000000000000000000000000000000000000000000000000000000000000000').slice(0, 64);
  }
  return body.slice(0, 64).padEnd(64, '0');
};
const __naiRollFreshState = () => ({
  seed: '',
  seeds: {},
  checks: __naiRollCore.KINDS.reduce((acc, kind) => { acc[kind] = true; return acc; }, {}),
  locks: {},
  picks: {},
  notes: [],
  styleMode: 'keep',
  styleId: '',
  history: [],
  cursor: -1,
  save: { phase: 'idle', id: '', message: '', at: 0 },
  at: 0,
  storeWarning: ''
});
const __naiRollLoadState = () => {
  const base = __naiRollFreshState();
  try {
    const raw = window.localStorage.getItem(__NAI_ROLL_STORE);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return base;
    const history = Array.isArray(saved.history)
      ? saved.history.filter(r => r && typeof r === 'object' && r.picks).slice(-__NAI_ROLL_HISTORY_MAX)
      : [];
    return {
      seed: String(saved.seed || ''),
      seeds: saved.seeds && typeof saved.seeds === 'object' ? saved.seeds : {},
      checks: Object.assign({}, base.checks, saved.checks && typeof saved.checks === 'object' ? saved.checks : {}),
      locks: saved.locks && typeof saved.locks === 'object' ? saved.locks : {},
      picks: saved.picks && typeof saved.picks === 'object' ? saved.picks : {},
      notes: Array.isArray(saved.notes) ? saved.notes : [],
      styleMode: saved.styleMode === 'replace' ? 'replace' : 'keep',
      styleId: String(saved.styleId || ''),
      history,
      cursor: Number.isInteger(saved.cursor) ? Math.max(-1, Math.min(history.length - 1, saved.cursor)) : history.length - 1,
      save: saved.save && typeof saved.save === 'object' ? { phase: String(saved.save.phase || 'idle'), id: String(saved.save.id || ''), message: String(saved.save.message || ''), at: Number(saved.save.at) || 0 } : base.save,
      at: Number(saved.at) || 0,
      storeWarning: ''
    };
  } catch (_e) {
    return Object.assign({}, base, { storeWarning: '读取本机上次的 Roll 记录失败，本次从空白开始（不影响继续使用）' });
  }
};

/* 角落小图标：全用既有 svg 画法，不引新依赖 */
const __naiRollIcon = props => {
  const kind = String((props && props.kind) || '');
  const common = {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: (props && props.strokeWidth) || 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
    className: (props && props.className) || 'h-[18px] w-[18px]', 'aria-hidden': 'true'
  };
  if (kind === 'lock') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('rect', { key: 'b', x: 4, y: 10, width: 16, height: 10, rx: 2 }),
      g.jsx('path', { key: 's', d: 'M8 10V7a4 4 0 0 1 8 0v3' })
    ] }));
  }
  if (kind === 'unlock') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('rect', { key: 'b', x: 4, y: 10, width: 16, height: 10, rx: 2 }),
      g.jsx('path', { key: 's', d: 'M8 10V7a4 4 0 0 1 7.5-2' })
    ] }));
  }
  if (kind === 'copy') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('rect', { key: 'b', x: 9, y: 9, width: 11, height: 11, rx: 2 }),
      g.jsx('path', { key: 's', d: 'M5 15V5a1 1 0 0 1 1-1h10' })
    ] }));
  }
  if (kind === 'lab') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('path', { key: 'a', d: 'M9 3h6' }),
      g.jsx('path', { key: 'b', d: 'M10 3v6.5L5.5 18A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3L14 9.5V3' }),
      g.jsx('path', { key: 'c', d: 'M7.5 15h9' })
    ] }));
  }
  if (kind === 'save') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('path', { key: 'a', d: 'M5 3h11l3 3v15H5z' }),
      g.jsx('path', { key: 'b', d: 'M9 3v6h6V3' }),
      g.jsx('path', { key: 'c', d: 'M8 14h8v7H8z' })
    ] }));
  }
  if (kind === 'refresh') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('path', { key: 'a', d: 'M20 12a8 8 0 1 1-2.3-5.6' }),
      g.jsx('path', { key: 'b', d: 'M20 4v5h-5' })
    ] }));
  }
  if (kind === 'swap') {
    return g.jsxs('svg', Object.assign({}, common, { children: [
      g.jsx('path', { key: 'a', d: 'M4 8h13l-3-3' }),
      g.jsx('path', { key: 'b', d: 'M20 16H7l3 3' })
    ] }));
  }
  return g.jsxs('svg', Object.assign({}, common, { children: [
    g.jsx('rect', { key: 'b', x: 3.5, y: 3.5, width: 17, height: 17, rx: 4 }),
    g.jsx('circle', { key: 'd1', cx: 8.5, cy: 8.5, r: 1.1, fill: 'currentColor', stroke: 'none' }),
    g.jsx('circle', { key: 'd2', cx: 15.5, cy: 8.5, r: 1.1, fill: 'currentColor', stroke: 'none' }),
    g.jsx('circle', { key: 'd3', cx: 12, cy: 12, r: 1.1, fill: 'currentColor', stroke: 'none' }),
    g.jsx('circle', { key: 'd4', cx: 8.5, cy: 15.5, r: 1.1, fill: 'currentColor', stroke: 'none' }),
    g.jsx('circle', { key: 'd5', cx: 15.5, cy: 15.5, r: 1.1, fill: 'currentColor', stroke: 'none' })
  ] }));
};
const __naiRollLibIcon = props => g.jsxs('svg', {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: (props && props.strokeWidth) || 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  className: (props && props.className) || 'h-[18px] w-[18px]', 'aria-hidden': 'true',
  children: [
    g.jsx('rect', { key: 'b', x: 3.5, y: 4, width: 17, height: 4.5, rx: 1.2 }),
    g.jsx('path', { key: 'h', d: 'M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5' }),
    g.jsx('path', { key: 'l', d: 'M9.5 14.5h5' })
  ]
});
const __naiRollNavIcon = props => g.jsx(__naiRollIcon, {
  kind: 'dice',
  className: (props && props.className) || 'h-[18px] w-[18px]',
  strokeWidth: (props && props.strokeWidth) || 1.8
});
const __naiRollBtn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const __naiRollChip = (active, extra) => __naiRollBtn + ' ' + (active
  ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800')
  + ' ' + (extra || '');

const __NaiRollWorkspace = props => {
  const chains = Array.isArray(props && props.chains) ? props.chains : [];
  const notify = (props && props.notify) || (() => {});
  const onNavigate = (props && props.onNavigate) || (() => {});
  const onRefresh = (props && props.onRefresh) || (() => {});
  const [state, setState] = N.useState(__naiRollLoadState);
  const [saveOpen, setSaveOpen] = N.useState(false);
  const [contentOpen, setContentOpen] = N.useState(false);
  const [contentName, setContentName] = N.useState('');
  const [contentNote, setContentNote] = N.useState('');
  const [contentTags, setContentTags] = N.useState('');
  const [contentPhase, setContentPhase] = N.useState('idle');
  const [contentMsg, setContentMsg] = N.useState('');
  const [contentId, setContentId] = N.useState('');
  const [saveName, setSaveName] = N.useState('');
  const [saveBusy, setSaveBusy] = N.useState(false);
  const [savePhase, setSavePhase] = N.useState('idle');
  const [savedId, setSavedId] = N.useState('');
  const [overridePending, setOverridePending] = N.useState(false);

  /* 本机记忆：写失败只提示，不拦功能（R17） */
  N.useEffect(() => {
    try {
      window.localStorage.setItem(__NAI_ROLL_STORE, JSON.stringify(state));
      if (state.storeWarning) setState(prev => Object.assign({}, prev, { storeWarning: '' }));
    } catch (_e) {
      setState(prev => (prev.storeWarning ? prev : Object.assign({}, prev, { storeWarning: '本次组合无法保存到本机（浏览器存储不可用）：刷新后会丢，但当前页仍可继续用' })));
    }
  }, [state]);

  const styleList = N.useMemo(() => chains.filter(c => c && String(c.type || '') === 'style'), [chains]);
  const pools = N.useMemo(() => __naiRollCore.poolsOf(chains), [chains]);
  const picks = state.picks || {};
  const locks = state.locks || {};
  const history = Array.isArray(state.history) ? state.history : [];
  const cursor = Number.isInteger(state.cursor) ? state.cursor : history.length - 1;
  const hasResult = Object.keys(picks).length > 0;
  const participating = __naiRollCore.KINDS.filter(kind => state.checks[kind] !== false);
  const anyChecked = participating.length > 0;
  const isLocked = kind => {
    const row = picks[kind];
    return !!(row && row.id) && String(locks[kind] || '') === String(row.id);
  };
  const staleLock = kind => !!locks[kind] && !isLocked(kind) && !!picks[kind] && !!picks[kind].id;
  const lockedCount = __naiRollCore.KINDS.filter(isLocked).length;
  const allLocked = participating.length > 0 && participating.every(kind => isLocked(kind));
  const sections = __naiRollCore.toSections(picks);
  const style = styleList.find(c => String(c.id) === String(state.styleId || '')) || null;
  const styleMode = state.styleMode === 'replace' && style ? 'replace' : 'keep';

  /* ---------- 历史：任何新抽取都截断「前进记录」后追加（首期明确这么做，不假装保留分支树） ---------- */
  const commitRecord = (patch, opts) => {
    setState(prev => {
      const record = {
        at: Date.now(),
        seed: String(patch.seed != null ? patch.seed : prev.seed || ''),
        seeds: patch.seeds || prev.seeds || {},
        checks: patch.checks || prev.checks || {},
        locks: patch.locks || prev.locks || {},
        picks: patch.picks || prev.picks || {},
        notes: patch.notes || [],
        styleMode: patch.styleMode || prev.styleMode || 'keep',
        styleId: patch.styleId != null ? patch.styleId : prev.styleId || ''
      };
      const hist = Array.isArray(prev.history) ? prev.history : [];
      const at = Number.isInteger(prev.cursor) ? prev.cursor : hist.length - 1;
      const keep = hist.slice(0, Math.max(0, at + 1));
      const nextHistory = ((opts && opts.noHistory) ? keep : keep.concat([record])).slice(-__NAI_ROLL_HISTORY_MAX);
      return Object.assign({}, prev, {
        seed: record.seed, seeds: record.seeds, checks: record.checks, locks: record.locks,
        picks: record.picks, notes: record.notes, styleMode: record.styleMode, styleId: record.styleId,
        history: nextHistory, cursor: nextHistory.length - 1, at: record.at
      });
    });
  };
  const gotoHistory = delta => {
    const idx = cursor + delta;
    if (idx < 0 || idx >= history.length) return;
    const rec = history[idx];
    setState(prev => Object.assign({}, prev, {
      seed: rec.seed, seeds: rec.seeds || {}, checks: rec.checks || prev.checks, locks: rec.locks || {},
      picks: rec.picks || {}, notes: rec.notes || [], styleMode: rec.styleMode || 'keep', styleId: rec.styleId || '',
      cursor: idx, at: rec.at || 0
    }));
    __naiRollToast(notify, '已切到第 ' + String(idx + 1) + ' / ' + String(history.length) + ' 组（只是浏览，没有应用、也没有保存）');
  };

  /* ---------- 抽取 ---------- */
  const doRoll = mode => {
    if (!anyChecked) { __naiRollToast(notify, '六个词库至少要勾选一个才能抽', 'error'); return; }
    if (mode === 'again') {
      if (!hasResult) { __naiRollToast(notify, '还没有结果，先抽一次', 'error'); return; }
      if (allLocked) { __naiRollToast(notify, '所有参与的栏位都固定了；要换内容先解除固定', 'error'); return; }
    }
    if (mode === 'redraw') {
      if (!state.seed) { __naiRollToast(notify, '没有可重新计算的随机码', 'error'); return; }
      const out = __naiRollCore.draw({ chains, checks: state.checks, locked: state.locks, seed: state.seed });
      commitRecord(out);
      __naiRollToast(notify, '已按这个组合随机码、用**当前**词库重新计算（池子变了结果就会不同）');
      return;
    }
    const seed = __naiRollNewSeed();
    const locked = mode === 'again' ? state.locks : {};
    /* 「再抽未锁定项」：对候选 >1 的未固定栏**排除当前条目**，候选不足则保留 —— 不靠重试到变化 */
    const avoid = {};
    if (mode === 'again') {
      for (const kind of __naiRollCore.KINDS) {
        const row = picks[kind];
        if (!row || !row.id) continue;
        if (isLocked(kind)) continue;
        if (__naiRollCore.poolOf(chains, kind).length > 1) avoid[kind] = row.id;
      }
    }
    const out = __naiRollCore.draw({ chains, checks: state.checks, locked, seed, avoid });
    const locksNext = {};
    for (const kind of __naiRollCore.KINDS) locksNext[kind] = out.picks[kind] && out.picks[kind].locked ? out.picks[kind].id : '';
    commitRecord(Object.assign({}, out, { locks: locksNext }));
    const blank = __naiRollCore.KINDS.filter(kind => !out.picks[kind].filled).length;
    __naiRollToast(notify, '抽好了（组合随机码 ' + out.seed + '）：' + String(6 - blank) + ' 栏有结果' + (blank ? '，' + String(blank) + ' 栏本次未提供' : ''), blank ? 'error' : 'success');
  };
  const doRerollOne = kind => {
    const nextSeed = __naiRollNewSeed();
    const out = __naiRollCore.rerollOne({ chains, checks: state.checks, picks, locked: state.locks }, kind, nextSeed);
    if (!out.ok) {
      __naiRollToast(notify, out.message, 'error');
      if (out.code === 'empty') gotoLibrary(kind);
      return;
    }
    const nextPicks = Object.assign({}, picks, { [kind]: out.row });
    commitRecord({
      seed: state.seed || nextSeed,
      seeds: Object.assign({}, state.seeds || {}, { [kind]: out.seed }),
      picks: nextPicks,
      notes: []
    });
    __naiRollToast(notify, out.message);
  };
  const gotoLibrary = kind => {
    try { window.localStorage.setItem(__NAI_ROLL_HUB_KIND, String(kind || 'all')); } catch (_e) { /* 忽略 */ }
    __naiRollToast(notify, '去「图片提示词库」添加条目；回来时这一组结果还在');
    onNavigate('prompts');
  };
  const setCheck = (kind, on) => setState(prev => Object.assign({}, prev, { checks: Object.assign({}, prev.checks, { [kind]: !!on }) }));
  const toggleLock = kind => {
    const row = picks[kind];
    if (!row || !row.id) { __naiRollToast(notify, '这一栏还没有抽到条目，无法固定', 'error'); return; }
    setState(prev => {
      const next = Object.assign({}, prev.locks);
      next[kind] = String(prev.locks && prev.locks[kind] || '') === String(row.id) ? '' : row.id;
      return Object.assign({}, prev, { locks: next });
    });
  };
  const clearLocks = () => setState(prev => Object.assign({}, prev, { locks: {} }));

  /* ---------- 填入实验室（pending-import；未消费导入不静默覆盖） ---------- */
  const pendingRaw = () => { try { return window.sessionStorage.getItem(xk); } catch (_e) { return null; } };
  const fillLab = () => {
    if (!sections.written.length) { __naiRollToast(notify, '没有可写入的内容：这一轮所有栏位都留空（未参与或该库为空）', 'error'); return; }
    if (pendingRaw() && !overridePending) {
      setOverridePending(true);
      __naiRollToast(notify, '实验室还有一次没被消费的导入：再点一次「填入实验室」会覆盖它', 'error');
      return;
    }
    const payload = {
      mode: 'roll-apply',
      v: 2,
      algo: __naiRollCore.ALGO,
      seed: String(state.seed || ''),
      styleMode: styleMode,
      style: styleMode === 'replace' && style ? { id: String(style.id), name: String(style.name || ''), basePrompt: String(style.basePrompt || ''), negativePrompt: String(style.negativePrompt || '') } : null,
      checks: Object.assign({}, state.checks),
      picks: __naiRollCore.KINDS.reduce((acc, kind) => {
        const row = picks[kind];
        if (row && row.id && row.filled && state.checks[kind] !== false) acc[kind] = __naiRollCore.snapshotOf(row);
        return acc;
      }, {}),
      evidence: __naiRollCore.evidenceOf({ chains, seed: state.seed, seeds: state.seeds, picks, locked: state.locks, checks: state.checks, at: state.at })
    };
    try {
      window.sessionStorage.setItem(xk, JSON.stringify(payload));
    } catch (e) {
      __naiRollToast(notify, '写入失败：' + String((e && e.message) || e), 'error');
      return;
    }
    setOverridePending(false);
    __naiRollToast(notify, '正在打开实验室确认面板：填入哪些栏、替换什么，都要你确认后才会写');
    onNavigate('playground', undefined, { externalImport: true });
  };

  /* ---------- 存为搭配（稳定操作 id + 服务端回执 + 四态） ---------- */
  const savePreset = async () => {
    const name = String(saveName || '').trim();
    if (!name) { __naiRollToast(notify, '请先给这份搭配起个名字', 'error'); return; }
    if (savePhase === 'saving') return;
    /* 快照在点「保存」这一刻冻结：之后再做一次抽，也不会改变这次提交的内容 */
    const frozen = {
      picks: JSON.parse(JSON.stringify(picks)),
      seed: String(state.seed || ''),
      seeds: Object.assign({}, state.seeds || {}),
      checks: Object.assign({}, state.checks),
      locks: Object.assign({}, state.locks),
      styleMode,
      style: styleMode === 'replace' && style ? { basePrompt: String(style.basePrompt || ''), negativePrompt: String(style.negativePrompt || ''), name: String(style.name || '') } : null
    };
    const content = __naiRollCore.toSections(frozen.picks);
    const params = {};
    if (Object.keys(content.global).length) params._promptSections = Object.assign({}, content.global);
    if (Object.keys(content.character).length) {
      params.characters = [{ id: uc(), name: '角色 1', prompt: '', negativePrompt: '', x: .5, y: .5, sections: Object.assign({}, content.character) }];
    }
    const basePrompt = frozen.style ? frozen.style.basePrompt : '';
    const negativePrompt = frozen.style ? frozen.style.negativePrompt : '';
    const snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      includeParams: true,
      basePrompt,
      negativePrompt,
      tags: [],
      modules: [],
      variableValues: { subject: '' },
      params,
      naiRoll: {
        algo: __naiRollCore.ALGO,
        seed: frozen.seed,
        seeds: frozen.seeds,
        checks: frozen.checks,
        locks: frozen.locks,
        styleMode: frozen.styleMode,
        picks: __naiRollCore.KINDS.reduce((acc, kind) => {
          const row = frozen.picks[kind];
          acc[kind] = row ? __naiRollCore.snapshotOf(row) : null;
          return acc;
        }, {})
      }
    };
    const body = {
      name,
      description: '一键 Roll 组合（组合随机码 ' + frozen.seed + '）· 由「一键 Roll」生成，不是词库条目，也不会反写词库。保存于 ' + new Date().toLocaleString(),
      type: 'preset',
      basePrompt,
      negativePrompt,
      modules: [],
      variableValues: {},
      tags: [],
      params: Object.assign({}, params, { _presetSnapshot: snapshot })
    };
    const sig = name + '\u0000' + frozen.seed + '\u0000' + JSON.stringify(params);
    let id = '';
    try {
      const pending = JSON.parse(window.sessionStorage.getItem(__NAI_ROLL_PENDING) || 'null');
      if (pending && pending.sig === sig && pending.id && (Date.now() - Number(pending.at || 0)) < 600000) id = String(pending.id);
      else {
        id = 'agent-' + __naiRollHex64();
        window.sessionStorage.setItem(__NAI_ROLL_PENDING, JSON.stringify({ sig, id, at: Date.now() }));
      }
    } catch (_e) {
      id = 'agent-' + __naiRollHex64();
    }
    setSaveBusy(true);
    setSavePhase('saving');
    setSavedId('');
    const setPhase = (phase, message, receipt) => {
      setSavePhase(phase);
      setState(prev => Object.assign({}, prev, { save: { phase, message: String(message || ''), id: String(receipt || ''), at: Date.now() } }));
    };
    try {
      /* 同一个操作 id 打同一个 POST：服务端对 agent-<64hex> 做幂等回放，重试不会产生第二条。
         不再用 PUT 覆盖 —— 那正是「旧快照盖掉新版本」的来源。 */
      const res = await we.post('/chains', Object.assign({ id }, body));
      const receiptId = String((res && (res.id || (res.chain && res.chain.id))) || id);
      const replayed = !!(res && res.replayed);
      try { window.sessionStorage.removeItem(__NAI_ROLL_PENDING); } catch (_e) { /* 忽略 */ }
      setSavedId(receiptId);
      setSavePhase('saved');
      setPhase('saved', replayed ? '服务端确认这次操作早已保存（幂等回放），没有产生第二条' : '已保存', receiptId);
      setSaveOpen(false);
      setSaveName('');
      __naiRollToast(notify, '已存为搭配「' + name + '」（服务端回执 ' + receiptId + '）；词库条目一个都没改，也没有开始生图', 'success');
      onRefresh();
    } catch (e) {
      const message = String((e && e.message) || e);
      /* 结果未知（超时 / 断网 / 5xx）先按操作 id 核实，不直接当失败重建 */
      const unknown = !e || typeof e.status !== 'number' || e.status >= 500;
      if (unknown) {
        setPhase('unconfirmed', '结果待确认：' + message + '。可以点「核实保存结果」按同一个操作 id 去查，不会重复创建');
        __naiRollToast(notify, '保存结果未确认（可能是网络中断）：用同一个操作 id 核实即可，不会产生第二条', 'error');
      } else {
        setPhase('failed', '明确失败：' + message);
        __naiRollToast(notify, '存为搭配失败：' + message, 'error');
      }
    } finally {
      setSaveBusy(false);
    }
  };
  const verifySaved = async () => {
    let id = '';
    try { id = String((JSON.parse(window.sessionStorage.getItem(__NAI_ROLL_PENDING) || 'null') || {}).id || ''); } catch (_e) { id = ''; }
    id = id || String(savedId || '');
    if (!id) { __naiRollToast(notify, '没有可核实的操作 id（可能已经保存成功并清理）', 'error'); return; }
    try {
      const live = await we.get('/chains/' + encodeURIComponent(id));
      if (live && live.id) {
        setSavedId(String(live.id));
        setSavePhase('saved');
        setState(prev => Object.assign({}, prev, { save: { phase: 'saved', message: '已核实：这条搭配确实已保存', id: String(live.id), at: Date.now() } }));
        try { window.sessionStorage.removeItem(__NAI_ROLL_PENDING); } catch (_e) { /* 忽略 */ }
        __naiRollToast(notify, '核实结果：已保存（' + String(live.id) + '），不会重复创建', 'success');
        onRefresh();
        return;
      }
      setSavePhase('failed');
      setState(prev => Object.assign({}, prev, { save: { phase: 'failed', message: '核实结果：库里没有这条记录，可以重新保存（会沿用同一个操作 id）', id, at: Date.now() } }));
    } catch (err) {
      const status = Number(err && err.status);
      if (status === 404) {
        setSavePhase('failed');
        setState(prev => Object.assign({}, prev, { save: { phase: 'failed', message: '核实结果：库里没有这条记录（404），可以重新保存（沿用同一个操作 id）', id, at: Date.now() } }));
      } else {
        setSavePhase('unconfirmed');
        setState(prev => Object.assign({}, prev, { save: { phase: 'unconfirmed', message: '核实失败：' + String((err && err.message) || err) + '（结果仍未确认）', id, at: Date.now() } }));
      }
    }
  };
  /* ---------- 存为 Roll 内容（纯内容快照：白名单，不含风格与参数） ---------- */
  const contentDraft = () => __naiRollCore.contentSnapshotOf({ picks, seed: state.seed, seeds: state.seeds, checks: state.checks, locks: state.locks }, new Date().toISOString());
  const openContentSave = () => {
    const snap = contentDraft();
    if (!snap) { __naiRollToast(notify, '当前这一组没有可保存的六类内容或约束：先抽一次，或至少勾选一类', 'error'); return; }
    setContentPhase('idle');
    setContentMsg('');
    setContentId('');
    setContentName((prev) => String(prev || '') || ('Roll 内容 ' + new Date().toLocaleString()));
    setContentOpen(true);
  };
    const saveContent = async () => {
    const name = String(contentName || '').trim();
    if (!name) { __naiRollToast(notify, '请先给这条 Roll 内容起个名字', 'error'); return; }
    if (contentPhase === 'saving') return;
    /* 快照在点「保存」这一刻冻结：之后再做一次抽，也不会改变这次提交的内容 */
    const snap = contentDraft();
    if (!snap) { __naiRollToast(notify, '这一组没有可保存的内容', 'error'); return; }
    snap.savedAt = new Date().toISOString();
    const tags = String(contentTags || '').split(/[,，]/).map(t => String(t || '').trim()).filter(Boolean);
    const note = String(contentNote || '').trim();
    const body = {
      type: 'preset',
      name,
      description: note,
      tags,
      basePrompt: '',
      negativePrompt: '',
      modules: [],
      variableValues: {},
      params: { _rollContentSnapshot: snap }
    };
    const sig = 'content\u0000' + name + '\u0000' + JSON.stringify(snap.roll || {}) + '\u0000' + String(snap.roles.length) + '\u0000' + String(Object.keys(snap.global || {}).length);
    let id = '';
    try {
      const pending = JSON.parse(window.sessionStorage.getItem(__NAI_ROLL_CONTENT_PENDING) || 'null');
      if (pending && pending.sig === sig && pending.id && (Date.now() - Number(pending.at || 0)) < 600000) id = String(pending.id);
      else {
        id = 'agent-' + __naiRollHex64();
        window.sessionStorage.setItem(__NAI_ROLL_CONTENT_PENDING, JSON.stringify({ sig, id, at: Date.now() }));
      }
    } catch (_e) { id = 'agent-' + __naiRollHex64(); }
    setContentPhase('saving');
    setContentMsg('');
    setContentId('');
    try {
      const res = await we.post('/chains', Object.assign({ id }, body));
      const receiptId = String((res && (res.id || (res.chain && res.chain.id))) || id);
      try { window.sessionStorage.removeItem(__NAI_ROLL_CONTENT_PENDING); } catch (_e) { /* 忽略 */ }
      setContentId(receiptId);
      setContentPhase('saved');
      setContentMsg((res && res.replayed) ? '服务端确认这次操作早已保存（幂等回放），没有产生第二条' : '已保存');
      setContentOpen(false);
      __naiRollToast(notify, '已存为 Roll 内容「' + name + '」（服务端回执 ' + receiptId + '）；只存六类内容，不含画师风格与生图参数', 'success');
      onRefresh();
    } catch (e) {
      const message = String((e && e.message) || e);
      const unknown = !e || typeof e.status !== 'number' || e.status >= 500;
      setContentPhase(unknown ? 'unconfirmed' : 'failed');
      setContentMsg((unknown ? '结果待确认：' : '明确失败：') + message + (unknown ? '（用同一个操作 id 重试不会重复创建）' : ''));
      __naiRollToast(notify, (unknown ? '保存结果未确认：' : '保存失败：') + message, 'error');
    }
  };
  const copyEvidence = async () => {
    const text = JSON.stringify(__naiRollCore.evidenceOf({ chains, seed: state.seed, seeds: state.seeds, picks, locked: state.locks, checks: state.checks, at: state.at }), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      __naiRollToast(notify, '已复制：组合随机码 + 算法版本 + 每栏条目 id + 候选池指纹');
    } catch (_e) {
      __naiRollToast(notify, '复制失败，可手动从「技术详情」里选文本', 'error');
    }
  };

  const rowDisabledReason = kind => {
    if (state.checks[kind] === false) return '本次未参与：先勾选再换';
    if (isLocked(kind)) return '已固定：先解除固定再换';
    const pool = (pools[kind] || []).length;
    if (!pool) return '该库 0 条：先去添加';
    if (pool <= 1) return '只有 1 条候选，暂无其他可选';
    return '';
  };

  /* ---------- 行 ---------- */
  const rows = __naiRollCore.KINDS.map(kind => {
    const meta = __naiRollCore.META[kind];
    const row = picks[kind] || null;
    const filled = !!(row && row.filled);
    const locked = isLocked(kind);
    const on = state.checks[kind] !== false;
    const pool = (pools[kind] || []).length;
    const why = rowDisabledReason(kind);
    const stale = staleLock(kind);
    const goAdd = on && pool === 0;
    return g.jsxs('div', {
      key: kind,
      'data-nai-roll-row': kind,
      'data-nai-roll-id': String((row && row.id) || ''),
      'data-nai-roll-reason': String((row && row.reason) || 'none'),
      'data-nai-roll-filled': filled ? 'true' : 'false',
      'data-nai-roll-on': on ? 'true' : 'false',
      'data-nai-roll-locked': locked ? 'true' : 'false',
      className: 'grid grid-cols-1 gap-2 rounded-xl border p-2.5 md:grid-cols-[auto_7.5rem_minmax(0,1fr)_auto_auto] md:items-center '
        + (on ? 'border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40' : 'border-dashed border-gray-200 bg-white opacity-60 dark:border-gray-800 dark:bg-gray-900'),
      children: [
        g.jsxs('label', { key: 'on', className: 'flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400', children: [
          g.jsx('input', {
            key: 'i', type: 'checkbox', 'data-nai-roll-check': kind,
            className: 'h-3.5 w-3.5 accent-indigo-600', checked: on,
            onChange: ev => setCheck(kind, ev.target.checked)
          }),
          '参与'
        ] }),
        g.jsxs('div', { key: 'meta', className: 'text-[11px]', children: [
          g.jsx('span', { className: 'font-bold text-indigo-600 dark:text-indigo-300', children: meta.short }),
          g.jsx('span', { className: 'ml-1 text-gray-400', children: meta.title }),
          g.jsx('span', { key: 'p', className: 'ml-1 text-[10px] text-gray-400', children: String(pool) + ' 条' })
        ] }),
        g.jsxs('div', { key: 'body', className: 'min-w-0', children: [
          filled
            ? g.jsxs('div', { className: 'flex flex-wrap items-baseline gap-x-2 gap-y-0.5', children: [
              g.jsx('span', { key: 'n', 'data-nai-roll-name': kind, className: 'text-xs font-medium text-gray-800 dark:text-gray-200', children: row.name }),
              g.jsx('span', { key: 'r', className: 'text-[10px] text-gray-400', children: (locked ? '固定保留' : row.reason === 'replay' ? '按上次记录还原' : '抽中') + ' · 池 ' + String(row.poolSize) + ' 条' })
            ] })
            : g.jsx('div', { key: 'b', className: 'flex flex-wrap items-baseline gap-2', children: [
              g.jsx('span', { 'data-nai-roll-blank': kind, className: 'text-xs text-gray-400', children: '本次未提供' }),
              g.jsx('span', { className: 'text-[10px] text-gray-400', children: '→ 保留实验室原内容' })
            ] }),
          filled && row.summary
            ? g.jsx('p', { key: 's', 'data-nai-roll-summary': kind, className: 'mt-0.5 text-[11px] leading-5 text-gray-600 dark:text-gray-300', children: row.summary + (row.summaryEnglishOnly ? '（暂无中文对照）' : '') })
            : null,
          filled && row.constraintNotes
            ? g.jsx('p', { key: 'c', 'data-nai-roll-constraint': kind, className: 'mt-0.5 text-[10px] leading-4 text-amber-600 dark:text-amber-400', children: row.constraintNotes })
            : null,
          filled && !on
            ? g.jsx('p', { key: 'off', 'data-nai-roll-off-note': kind, className: 'mt-0.5 text-[10px] leading-4 text-gray-500 dark:text-gray-400', children: '本次不参与：不抽取、也不会填入实验室（候选与固定记忆保留，重新勾选即可恢复）' })
            : null,
          !filled
            ? g.jsx('p', { key: 'w', 'data-nai-roll-why': kind, className: 'mt-0.5 text-[11px] leading-5 text-amber-600 dark:text-amber-400', children: (row && row.reasonText) || (on ? '还没抽' : '本次未参与') })
            : null,
          stale
            ? g.jsx('p', { key: 'x', 'data-nai-roll-lock-stale': kind, className: 'mt-0.5 text-[10px] leading-4 text-amber-600 dark:text-amber-400', children: '固定项已不在词库，本栏已重抽（不会假装还固定着）' })
            : null
        ] }),
        g.jsx('button', {
          key: 'lock', type: 'button', 'data-nai-roll-lock': kind,
          'data-nai-roll-locked': locked ? 'true' : 'false',
          'aria-label': (locked ? '解除固定' : '固定') + meta.title,
          title: !filled ? '这一栏还没有条目，不能固定' : (locked ? '已固定：再抽时保留这一栏' : '固定：再抽时保留这一栏'),
          disabled: !filled || !on,
          className: 'inline-flex h-7 w-7 items-center justify-center rounded-md border ' + (locked
            ? 'border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
            : 'border-gray-200 text-gray-400 hover:text-gray-600 dark:border-gray-700 dark:text-gray-500'),
          onClick: () => toggleLock(kind),
          children: g.jsx(__naiRollIcon, { key: 'i', kind: locked ? 'lock' : 'unlock', className: 'h-3.5 w-3.5' })
        }),
        g.jsxs('button', {
          key: 'swap', type: 'button', 'data-nai-roll-swap': kind,
          'data-nai-roll-swap-state': goAdd ? 'add' : (why ? 'blocked' : 'ready'),
          disabled: !goAdd && !!why, title: why || '只换这一栏（会避开当前这一条）',
          className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'),
          onClick: () => (goAdd ? gotoLibrary(kind) : doRerollOne(kind)),
          children: [g.jsx(__naiRollIcon, { key: 'i', kind: 'swap', className: 'h-3.5 w-3.5' }), goAdd ? '去添加' : (on && pool <= 1 ? '仅 1 条' : '换一个')]
        })
      ]
    });
  });
  const notes = Array.isArray(state.notes) ? state.notes : [];
  const savePhaseText = { idle: '', saving: '保存中…', saved: '已保存', failed: '明确失败', unconfirmed: '结果待确认' };
  return g.jsxs('div', {
    'data-nai-roll': 'workspace',
    className: 'flex flex-1 min-h-0 flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950',
    children: g.jsxs('div', { className: 'mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6', children: [
      g.jsxs('section', { key: 's0', className: 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900', children: [
        g.jsxs('div', { key: 'h', className: 'flex flex-wrap items-baseline justify-between gap-2', children: [
          g.jsx('h2', { key: 't', className: 'text-base font-bold text-gray-900 dark:text-gray-100', children: '一键 Roll' }),
          g.jsxs('span', { key: 's', className: 'text-[11px] text-gray-400', children: [
            '组合随机码 ',
            g.jsx('span', { key: 'v', 'data-nai-roll-seed': String(state.seed || ''), className: 'font-mono text-gray-600 dark:text-gray-300', children: String(state.seed || '（还没抽）') }),
            history.length ? ' · 历史 ' + String(cursor + 1) + '/' + String(history.length) : ''
          ] })
        ] }),
        g.jsx('p', { key: 'd', className: 'mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400', children: '从已保存的词库条目组合内容，不会开始生图、不消耗额度、不改写任何词库条目。组合随机码只决定这次怎么抽，与生图用的 seed 无关。' })
      ] }),
      g.jsxs('section', { key: 's1', className: 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900', children: [
        g.jsxs('div', { key: 'style', className: 'flex flex-wrap items-center gap-2', children: [
          g.jsx('span', { key: 'l', className: 'text-xs font-medium text-gray-600 dark:text-gray-400', children: '风格' }),
          g.jsx('button', {
            key: 'keep', type: 'button', 'data-nai-roll-style-mode': 'keep',
            'data-nai-roll-style-mode-active': styleMode === 'keep' ? 'true' : 'false',
            className: __naiRollChip(styleMode === 'keep', ''), onClick: () => setState(prev => Object.assign({}, prev, { styleMode: 'keep' })),
            children: '保持实验室当前风格'
          }),
          g.jsx('button', {
            key: 'replace', type: 'button', 'data-nai-roll-style-mode': 'replace',
            'data-nai-roll-style-mode-active': styleMode === 'replace' ? 'true' : 'false',
            className: __naiRollChip(styleMode === 'replace', ''), onClick: () => setState(prev => Object.assign({}, prev, { styleMode: 'replace' })),
            children: '替换为所选风格串'
          }),
          g.jsx('select', {
            key: 'sel', 'data-nai-roll-style': 'true',
            className: 'h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
            value: String(state.styleId || ''),
            onChange: ev => setState(prev => Object.assign({}, prev, { styleId: String(ev.target.value || ''), styleMode: String(ev.target.value || '') ? 'replace' : prev.styleMode })),
            children: [g.jsx('option', { key: 'none', value: '', children: '（未选风格串）' })].concat(
              styleList.map(c => g.jsx('option', { key: String(c.id), value: String(c.id), children: String(c.name || '（未命名）') }))
            )
          }),
          styleMode === 'replace' && !style
            ? g.jsx('span', { key: 'w', className: 'text-[11px] text-amber-600 dark:text-amber-400', children: '「替换」需要先选一个风格串；现在不会清空当前风格' })
            : null
        ] }),
        g.jsx('p', { key: 'hint', className: 'mt-1 text-[11px] leading-5 text-gray-400', children: '「保持当前」＝ 不动实验室的画师与风格；「替换」＝ 用所选风格串的 basePrompt 与负面提示词覆盖（确认面板里还会再列一次）。' })
      ] }),
      g.jsxs('section', { key: 's2', className: 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900', children: [
        g.jsxs('div', { key: 'head', className: 'flex flex-wrap items-center justify-between gap-2', children: [
          g.jsx('h3', { key: 't', className: 'text-sm font-bold text-gray-800 dark:text-gray-200', children: '参与 · 结果 · 固定 · 换一个' }),
          g.jsxs('div', { key: 'hist', className: 'flex items-center gap-1', children: [
            g.jsx('button', { key: 'prev', type: 'button', 'data-nai-roll-history': 'prev', disabled: cursor <= 0, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => gotoHistory(-1), children: '上一组' }),
            g.jsx('button', { key: 'next', type: 'button', 'data-nai-roll-history': 'next', disabled: cursor >= history.length - 1, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => gotoHistory(1), children: '下一组' }),
            g.jsx('button', { key: 'restore', type: 'button', 'data-nai-roll-action': 'restore', disabled: !history.length, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), title: '用记录里的内容快照还原（不查词库）', onClick: () => {
              const rec = history[cursor] || history[history.length - 1];
              if (!rec) { __naiRollToast(notify, '还没有可还原的记录', 'error'); return; }
              const out = __naiRollCore.replay({ chains, checks: rec.checks || state.checks }, rec);
              commitRecord(Object.assign({}, out, { checks: rec.checks || state.checks, styleMode: rec.styleMode || 'keep', styleId: rec.styleId || '' }));
              __naiRollToast(notify, out.redrawn ? '已还原：' + String(out.restored) + ' 栏照旧，' + String(out.redrawn) + ' 栏因条目已删除而重抽' : '已按记录还原这一组（' + String(out.restored) + ' 栏）', out.redrawn ? 'error' : 'success');
            }, children: '还原这组' }),
            g.jsx('button', { key: 'redraw', type: 'button', 'data-nai-roll-action': 'redraw', disabled: !state.seed, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), title: '用当前词库按同一个随机码重新计算（池子变了结果会不同）', onClick: () => doRoll('redraw'), children: '按当前词库重算' })
          ] })
        ] }),
        hasResult
          ? g.jsx('div', { key: 'rows', className: 'mt-3 space-y-2', children: rows })
          : g.jsx('p', { key: 'empty', 'data-nai-roll-empty': 'true', className: 'mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800/60 dark:text-gray-400', children: '还没有结果。点下面的「抽一次」，从勾选的库里各抽 1 条。' }),
        notes.length
          ? g.jsx('div', { key: 'notes', className: 'mt-2 space-y-1', children: notes.map((note, i) => g.jsx('p', {
            key: String(i) + ':' + String((note && note.code) || ''),
            'data-nai-roll-note': String((note && note.code) || ''),
            className: 'text-[11px] leading-5 text-amber-600 dark:text-amber-400',
            children: String((note && note.message) || '')
          })) })
          : null,
        g.jsxs('div', { key: 'roll', className: 'mt-3 flex flex-wrap items-center gap-2', children: [
          g.jsxs('button', {
            key: 'fresh', type: 'button', 'data-nai-roll-action': 'roll', className: __naiRollChip(true, '!px-4 !py-2 !text-sm'),
            onClick: () => doRoll('fresh'),
            children: [g.jsx(__naiRollIcon, { key: 'i', kind: 'dice', className: 'h-4 w-4' }), '抽一次']
          }),
          g.jsxs('button', {
            key: 'again', type: 'button', 'data-nai-roll-action': 'again', disabled: !hasResult || allLocked,
            title: allLocked ? '所有参与的栏位都固定了，先解除固定' : '只换未固定的栏位（会避开当前这一条）',
            className: __naiRollChip(false, '!px-4 !py-2 !text-sm'), onClick: () => doRoll('again'),
            children: ['再抽未固定项', lockedCount ? '（保留固定的 ' + String(lockedCount) + ' 栏）' : '']
          }),
          lockedCount ? g.jsx('button', { key: 'unlock', type: 'button', 'data-nai-roll-action': 'unlock-all', className: __naiRollChip(false, ''), onClick: clearLocks, children: '清除全部固定' }) : null,
          !anyChecked ? g.jsx('span', { key: 'need', className: 'text-[11px] text-amber-600 dark:text-amber-400', children: '至少勾选一类才能抽' }) : null
        ] })
      ] }),
      g.jsxs('section', { key: 's3', className: 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900', children: [
        g.jsx('h3', { key: 't', className: 'text-sm font-bold text-gray-800 dark:text-gray-200', children: '应用到实验室 / 存为搭配' }),
        g.jsx('p', { key: 'plan', 'data-nai-roll-plan': 'true', className: 'mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400', children: hasResult
          ? '本次提供：角色 ' + String(sections.rows.filter(r => r.scope === 'character').length) + ' 类、全局 ' + String(sections.rows.filter(r => r.scope === 'global').length) + ' 类；其余 ' + String(6 - sections.written.length) + ' 栏保留原内容。'
            + (styleMode === 'replace' && style ? '风格：替换为「' + String(style.name || '') + '」。' : '风格：保持实验室当前风格。')
            + ' 目标角色在实验室的确认面板里选。'
          : '先抽一次，再决定填入实验室还是存为搭配。' }),
        g.jsxs('div', { key: 'actions', className: 'mt-3 flex flex-wrap items-center gap-2', children: [
          g.jsxs('button', {
            key: 'fill', type: 'button', 'data-nai-roll-action': 'fill', disabled: !sections.written.length,
            className: __naiRollChip(true, '!px-4 !py-2 !text-sm'), onClick: fillLab,
            children: [g.jsx(__naiRollIcon, { key: 'i', kind: 'lab', className: 'h-4 w-4' }), overridePending ? '覆盖未消费的导入并填入' : '填入实验室…']
          }),
          g.jsxs('button', {
            key: 'save', type: 'button', 'data-nai-roll-action': 'save', disabled: !sections.written.length || savePhase === 'saving',
            className: __naiRollChip(false, '!px-4 !py-2 !text-sm'), onClick: () => { setSavedId(''); setSavePhase('idle'); setSaveOpen(v => !v); },
            children: [g.jsx(__naiRollIcon, { key: 'i', kind: 'save', className: 'h-4 w-4' }), '存为搭配']
          })
          ,g.jsxs('button', {
            key: 'save-content', type: 'button', 'data-nai-roll-action': 'save-content',
            disabled: !sections.written.length || contentPhase === 'saving',
            className: __naiRollChip(false, '!px-4 !py-2 !text-sm'), onClick: openContentSave,
            title: '只保存六类内容与它们自己的约束，不含画师风格与生图参数',
            children: ['存为 Roll 内容']
          })
        ] }),
        overridePending
          ? g.jsx('p', { key: 'ov', 'data-nai-roll-pending-warn': 'true', className: 'mt-2 text-[11px] leading-5 text-amber-600 dark:text-amber-400', children: '实验室里还有一次没被消费的导入。要不要覆盖由你决定；按「取消覆盖」保留它。' })
          : null,
        overridePending ? g.jsx('button', { key: 'ovc', type: 'button', 'data-nai-roll-action': 'pending-cancel', className: __naiRollChip(false, 'mt-1'), onClick: () => setOverridePending(false), children: '取消覆盖' }) : null,
        savePhase !== 'idle'
          ? g.jsx('p', {
            key: 'sv', 'data-nai-roll-save-phase': savePhase,
            'data-nai-roll-preset-id': savedId || '',
            className: 'mt-2 text-[11px] leading-5 ' + (savePhase === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : savePhase === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'),
            children: (savePhaseText[savePhase] || savePhase) + (savedId ? ' · 服务端回执 ' + savedId : '') + (state.save && state.save.message ? ' · ' + String(state.save.message) : '')
          })
          : null,
        savePhase === 'unconfirmed' || savePhase === 'failed'
          ? g.jsx('button', { key: 'vfy', type: 'button', 'data-nai-roll-action': 'verify-save', className: __naiRollChip(false, 'mt-1'), onClick: verifySaved, children: '核实保存结果（不会重复创建）' })
          : null,
        saveOpen ? g.jsxs('div', { key: 'panel', 'data-nai-roll-save-panel': 'true', className: 'mt-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900/60 dark:bg-indigo-950/40', children: [
          g.jsxs('label', { key: 'l', className: 'block text-[11px] font-medium text-gray-600 dark:text-gray-300', children: [
            '搭配名称',
            g.jsx('input', {
              key: 'i', type: 'text', 'data-nai-roll-save-name': 'true', value: saveName, maxLength: 80,
              placeholder: '例如：赛博雨夜 · 金发少女',
              className: 'mt-1 h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
              onChange: ev => setSaveName(ev.target.value)
            })
          ] }),
          g.jsx('p', { key: 'n', className: 'mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400', children: '存成一条 type=preset 的记录：保存的是「点保存这一刻的组合快照」（之后再做一次抽，不会改变这次提交的内容）。不含模型/尺寸/种子，也不会改写任何词库条目。' }),
          g.jsxs('div', { key: 'a', className: 'mt-2 flex items-center gap-2', children: [
            g.jsx('button', { key: 'ok', type: 'button', 'data-nai-roll-action': 'save-confirm', disabled: saveBusy, className: __naiRollChip(true, ''), onClick: savePreset, children: saveBusy ? '保存中…' : '保存这条搭配' }),
            g.jsx('button', { key: 'no', type: 'button', 'data-nai-roll-action': 'save-cancel', className: __naiRollChip(false, ''), onClick: () => setSaveOpen(false), children: '取消' })
          ] })
        ] }) : null,
        contentOpen ? g.jsxs('div', { key: 'content-panel', 'data-nai-roll-content-panel': 'true', className: 'mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/40', children: [
          g.jsx('p', { key: 'h', className: 'text-[11px] font-bold text-emerald-800 dark:text-emerald-200', children: '仅保存六类内容，不含画师风格与生图参数' }),
          g.jsxs('label', { key: 'n', className: 'mt-2 block text-[11px] font-medium text-gray-600 dark:text-gray-300', children: [
            '名称（必填）',
            g.jsx('input', {
              key: 'i', type: 'text', 'data-nai-roll-content-name': 'true', value: contentName, maxLength: 80,
              className: 'mt-1 h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
              onChange: ev => setContentName(ev.target.value)
            })
          ] }),
          g.jsxs('label', { key: 'd', className: 'mt-2 block text-[11px] font-medium text-gray-600 dark:text-gray-300', children: [
            '备注（可选）',
            g.jsx('input', {
              key: 'i', type: 'text', 'data-nai-roll-content-note': 'true', value: contentNote, maxLength: 200,
              className: 'mt-1 h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
              onChange: ev => setContentNote(ev.target.value)
            })
          ] }),
          g.jsxs('label', { key: 't', className: 'mt-2 block text-[11px] font-medium text-gray-600 dark:text-gray-300', children: [
            '标签（逗号分隔，可选）',
            g.jsx('input', {
              key: 'i', type: 'text', 'data-nai-roll-content-tags': 'true', value: contentTags, maxLength: 200,
              className: 'mt-1 h-8 w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
              onChange: ev => setContentTags(ev.target.value)
            })
          ] }),
          g.jsx('p', { key: 'hint', className: 'mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400', children: '保存的是这一刻的六类内容与内容约束；画师串、风格配套负面、你手填的全局负面、模型与全部生图参数都不会进入这条记录。之后再做一次抽，也不会改变这次提交的内容。' }),
          g.jsxs('div', { key: 'a', className: 'mt-2 flex items-center gap-2', children: [
            g.jsx('button', { key: 'ok', type: 'button', 'data-nai-roll-action': 'save-content-confirm', disabled: contentPhase === 'saving', className: __naiRollChip(true, ''), onClick: saveContent, children: contentPhase === 'saving' ? '保存中…' : '保存这条 Roll 内容' }),
            g.jsx('button', { key: 'no', type: 'button', 'data-nai-roll-action': 'save-content-cancel', className: __naiRollChip(false, ''), onClick: () => setContentOpen(false), children: '取消（不创建记录）' })
          ] })
        ] }) : null,
        contentPhase !== 'idle'
          ? g.jsx('p', {
            key: 'cphase', 'data-nai-roll-content-phase': contentPhase, 'data-nai-roll-content-id': contentId || '',
            className: 'mt-2 text-[11px] leading-5 ' + (contentPhase === 'saved' ? 'text-emerald-600 dark:text-emerald-400' : contentPhase === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'),
            children: ({ saving: '保存中…', saved: '已保存', failed: '明确失败', unconfirmed: '结果待确认' })[contentPhase] + (contentId ? ' · 服务端回执 ' + contentId : '') + (contentMsg ? ' · ' + contentMsg : '')
          })
          : null,
        state.storeWarning
          ? g.jsx('p', { key: 'sw', 'data-nai-roll-store-warning': 'true', className: 'mt-2 text-[11px] leading-5 text-amber-600 dark:text-amber-400', children: state.storeWarning })
          : null,
        g.jsxs('details', { key: 'tech', className: 'mt-3 rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-800/40', children: [
          g.jsx('summary', { key: 's', className: 'cursor-pointer text-[11px] font-medium text-gray-500 dark:text-gray-400', children: '技术详情（算法版本 / 组合随机码 / 每栏条目 id / 候选池指纹）' }),
          g.jsx('pre', {
            key: 'pre', 'data-nai-roll-evidence': 'true',
            className: 'mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-gray-500 dark:text-gray-400',
            children: JSON.stringify(__naiRollCore.evidenceOf({ chains, seed: state.seed, seeds: state.seeds, picks, locked: state.locks, checks: state.checks, at: state.at }), null, 2)
          }),
          g.jsxs('button', { key: 'copy', type: 'button', 'data-nai-roll-action': 'copy-evidence', className: __naiRollChip(false, 'mt-2'), onClick: copyEvidence, children: [g.jsx(__naiRollIcon, { key: 'i', kind: 'copy', className: 'h-3.5 w-3.5' }), '复制证据'] })
        ] })
      ] })
    ] })
  });
};
/* __NAI_ROLL_VIEW_END__ */

/* =====================================================================
 * Roll 内容搭配库 · 工作区视图（纯内容快照：只存六类内容与它们自己的约束）
 * ---------------------------------------------------------------------
 * 需求：`NAI-Atelier-Roll纯内容搭配库最新修改需求.md`
 *   · 只保存六类内容 + 内容自身的负面/缺席约束/备注/来源快照；
 *   · **绝不**保存画师串、风格配套负面、用户手填全局负面、模型/采样器/步数/CFG/尺寸/张数/生图 seed；
 *   · 用白名单构造与读取（不复制整份 params）；来源条目改名/改内容/删除都不改变已存记录；
 *   · 与旧「完整搭配」（`params._presetSnapshot`）用不同字段区分，旧记录语义不变；
 *   · 载入必须进实验室的确认面板（目标角色 + 逐类勾选 + 一次撤销），不在本页直接写配置。
 * ===================================================================== */
/* __NAI_ROLL_LIB_BEGIN__ */
const __NAI_ROLL_LIB_STORE = 'nai_roll_lib_ui';
const __naiRollLibRecords = chains => (Array.isArray(chains) ? chains : []).filter(c => __naiRollCore.isContentRecord(c));
const __naiRollLibRead = chain => {
  const read = __naiRollCore.contentOfChain(chain);
  return Object.assign({}, read, { scope: __naiRollCore.contentScopeOf(read) });
};
const __naiRollShrinkImage = (file, max) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round((img.naturalWidth || max) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || max) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片转码失败'))), 'image/png');
    } catch (e) { URL.revokeObjectURL(url); reject(e); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图片读不出来')); };
  img.src = url;
});
const __naiRollLibKindLabel = kind => (__naiRollCore.META[kind] ? __naiRollCore.META[kind].title : kind);
const __naiRollLibCoverOf = chain => {
  const chain_cover = String((chain && chain.previewImage) || '');
  if (!chain_cover) return '';
  const read = __naiRollLibRead(chain);
  const first = (read.roles && read.roles[0] && read.roles[0].meta) || {};
  const g = read.global || {};
  const pickMeta = (m) => (m && (m.entryPreviewImage || '')) || '';
  for (const kind of __naiRollCore.ROLE_KEYS) if (pickMeta(first[kind])) return pickMeta(first[kind]);
  for (const kind of __naiRollCore.GLOBAL_KEYS) if (g[kind] && pickMeta(g[kind].meta)) return pickMeta(g[kind].meta);
  return chain_cover;
};

const __NaiRollLibraryWorkspace = props => {
  const chains = Array.isArray(props && props.chains) ? props.chains : [];
  const notify = (props && props.notify) || (() => {});
  const onNavigate = (props && props.onNavigate) || (() => {});
  const onRefresh = (props && props.onRefresh) || (() => {});
  const [query, setQuery] = N.useState('');
  const [sort, setSort] = N.useState('updated');
  const [previewId, setPreviewId] = N.useState('');
  const [renaming, setRenaming] = N.useState(null);
  const [busy, setBusy] = N.useState(false);
  const [deleting, setDeleting] = N.useState(null);

  const records = N.useMemo(() => __naiRollLibRecords(chains), [chains]);
  const rows = N.useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const list = records.map(c => {
      const read = __naiRollLibRead(c);
      return { chain: c, read, id: String(c.id), name: String(c.name || '（未命名）'), note: String(c.description || ''), tags: Array.isArray(c.tags) ? c.tags : [], updatedAt: Number(c.updatedAt) || 0 };
    }).filter(r => {
      if (!q) return true;
      const hay = [r.name, r.note, r.tags.join(' '), r.read.scope.label].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
    list.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, 'zh') : b.updatedAt - a.updatedAt));
    return list;
  }, [records, query, sort]);
  const preview = rows.find(r => r.id === previewId) || null;

  const loadIntoLab = id => {
    if (!pendingFree()) return;
    try {
      window.sessionStorage.setItem(xk, JSON.stringify({ mode: 'roll-content-load', v: 1, recordId: String(id) }));
    } catch (e) {
      notify('写入失败：' + String((e && e.message) || e), 'error');
      return;
    }
    notify('正在打开实验室的载入确认面板：目标角色与每一类都可以再确认');
    onNavigate('playground', undefined, { externalImport: true });
  };
  const pendingFree = () => {
    try {
      const raw = window.sessionStorage.getItem(xk);
      if (!raw) return true;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.mode) {
        notify('实验室还有一次没被消费的导入：先到实验室处理它，再载入这条记录', 'error');
        return false;
      }
      return true;
    } catch (_e) { return true; }
  };
  const rename = async (rec, next) => {
    const name = String(next || '').trim();
    if (!name) { notify('名字不能为空', 'error'); return; }
    if (name === rec.name) { setRenaming(null); return; }
    setBusy(true);
    try {
      await we.put('/chains/' + encodeURIComponent(rec.id), {
        name, description: rec.note, basePrompt: String(rec.chain.basePrompt || ''), negativePrompt: String(rec.chain.negativePrompt || ''),
        modules: Array.isArray(rec.chain.modules) ? rec.chain.modules : [], variableValues: rec.chain.variableValues || {},
        tags: rec.tags, params: rec.chain.params, expectedUpdatedAt: String(rec.chain.updatedAt == null ? '' : rec.chain.updatedAt)
      });
      setRenaming(null);
      notify('已改名（只改这一条记录的名字，不改内容）', 'success');
      onRefresh();
    } catch (e) {
      notify('改名失败：' + String((e && e.message) || e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async rec => {
    setBusy(true);
    try {
      await we.delete('/chains/' + encodeURIComponent(rec.id));
      setDeleting(null);
      setPreviewId('');
      notify('已删除这条 Roll 内容记录（六库原条目和已应用副本都不受影响）', 'success');
      onRefresh();
    } catch (e) {
      notify('删除失败：' + String((e && e.message) || e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const duplicate = async rec => {
    setBusy(true);
    try {
      const id = 'agent-' + __naiRollHex64();
      const copy = JSON.parse(JSON.stringify(rec.chain.params._rollContentSnapshot));
      await we.post('/chains', {
        id, type: 'preset', name: rec.name + ' · 副本', description: rec.note, tags: rec.tags,
        basePrompt: '', negativePrompt: '', modules: [], variableValues: {},
        params: { _rollContentSnapshot: copy }
      });
      notify('已复制成新记录（新 id，原记录不变）', 'success');
      onRefresh();
    } catch (e) {
      notify('复制失败：' + String((e && e.message) || e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const card = rec => {
    const scope = rec.read.scope;
    const cover = __naiRollLibCoverOf(rec.chain);
    return g.jsxs('article', {
      key: rec.id, 'data-nai-rolllib-card': rec.id, 'data-nai-rolllib-ok': rec.read.ok ? 'true' : 'false',
      className: 'flex gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900',
      children: [
        g.jsx('div', { className: 'h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800', children:
          cover ? g.jsx('img', { src: cover, alt: '', className: 'h-full w-full object-cover', loading: 'lazy' }) : g.jsx('div', { className: 'flex h-full w-full items-center justify-center text-[10px] text-gray-400', children: '无封面' })
        }),
        g.jsxs('div', { className: 'min-w-0 flex-1', children: [
          g.jsxs('div', { className: 'flex flex-wrap items-baseline gap-2', children: [
            renaming && renaming.id === rec.id
              ? g.jsx('input', {
                type: 'text', 'data-nai-rolllib-rename-input': rec.id, defaultValue: rec.name, maxLength: 80,
                className: 'h-7 min-w-0 flex-1 rounded border border-gray-200 px-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100',
                onKeyDown: ev => { if (ev.key === 'Enter') rename(rec.chain, ev.currentTarget.value); else if (ev.key === 'Escape') setRenaming(null); }
              })
              : g.jsx('button', { type: 'button', 'data-nai-rolllib-preview': rec.id, className: 'min-w-0 truncate text-left text-sm font-bold text-gray-800 hover:text-indigo-600 dark:text-gray-100', onClick: () => setPreviewId(rec.id), title: '只读预览', children: rec.name }),
            g.jsx('span', { className: 'text-[10px] text-gray-400', children: '不含画师风格与生图参数' })
          ] }),
          g.jsx('p', { 'data-nai-rolllib-scope': rec.id, className: 'mt-0.5 text-[11px] leading-5 text-gray-600 dark:text-gray-300', children: scope.label || '（没有可载入的内容）' }),
          rec.note ? g.jsx('p', { className: 'mt-0.5 text-[11px] leading-5 text-gray-500 dark:text-gray-400', children: rec.note.slice(0, 80) }) : null,
          rec.tags.length ? g.jsx('div', { className: 'mt-1 flex flex-wrap gap-1', children: rec.tags.slice(0, 6).map(t => g.jsx('span', { key: t, className: 'rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400', children: t })) }) : null,
          g.jsxs('div', { className: 'mt-2 flex flex-wrap items-center gap-1', children: [
            g.jsx('button', { type: 'button', 'data-nai-rolllib-load': rec.id, disabled: !rec.read.ok || busy, className: __naiRollChip(true, '!px-2 !py-1 !text-[11px]'), onClick: () => loadIntoLab(rec.id), children: '载入实验室…' }),
            g.jsx('button', { type: 'button', 'data-nai-rolllib-cover': rec.id, disabled: busy || coverBusy === rec.id, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => openCoverPicker(rec), title: '给这条记录设一张封图（只改封面，不改六类内容）', children: coverBusy === rec.id ? '上传中…' : (cover ? '换封面' : '设封面') }),
            cover ? g.jsx('button', { type: 'button', 'data-nai-rolllib-cover-clear': rec.id, disabled: busy || coverBusy === rec.id, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => clearCover(rec), title: '清除封面（不影响内容）', children: '清除封面' }) : null,
            g.jsx('button', { type: 'button', 'data-nai-rolllib-rename': rec.id, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => setRenaming({ id: rec.id }), children: '改名' }),
            g.jsx('button', { type: 'button', 'data-nai-rolllib-copy': rec.id, disabled: busy, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => duplicate(rec), children: '复制' }),
            g.jsx('button', { type: 'button', 'data-nai-rolllib-delete': rec.id, disabled: busy, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => setDeleting({ id: rec.id, name: rec.name }), children: '删除' })
          ] }),
          deleting && deleting.id === rec.id ? g.jsxs('div', { 'data-nai-rolllib-delete-confirm': rec.id, className: 'mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] leading-5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200', children: [
            '删除这条记录「' + rec.name + '」？六库原条目、已经应用到实验室的内容都不受影响。',
            g.jsxs('div', { className: 'mt-1 flex gap-1', children: [
              g.jsx('button', { type: 'button', 'data-nai-rolllib-delete-ok': rec.id, className: __naiRollChip(true, '!px-2 !py-1 !text-[11px]'), onClick: () => remove(rec), children: '确认删除' }),
              g.jsx('button', { type: 'button', 'data-nai-rolllib-delete-cancel': rec.id, className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => setDeleting(null), children: '取消' })
            ] })
          ] }) : null
        ] })
      ]
    });
  };
﻿  /* ---------- C18：从「完整搭配」人工提取六类内容另存（明确排除画师/风格负面/参数） ---------- */
  /* ---------- 封面：上传 / 替换 / 清除（只改这条记录的封图，不改内容） ---------- */
  const coverInputRef = N.useRef(null);
  const [coverBusy, setCoverBusy] = N.useState('');
  const putCover = async (rec, url) => {
    await we.put('/chains/' + encodeURIComponent(rec.id), {
      name: rec.name, description: rec.note,
      basePrompt: String(rec.chain.basePrompt || ''), negativePrompt: String(rec.chain.negativePrompt || ''),
      modules: Array.isArray(rec.chain.modules) ? rec.chain.modules : [],
      variableValues: rec.chain.variableValues || {}, tags: rec.tags,
      params: rec.chain.params, previewImage: url,
      expectedUpdatedAt: String(rec.chain.updatedAt == null ? '' : rec.chain.updatedAt)
    });
  };
  const pickUpload = rec => {
    const el = coverInputRef.current;
    if (!el) { notify('这个浏览器不支持选图', 'error'); return; }
    el.value = '';
    el.dataset.recordId = rec.id;
    el.click();
  };
  /* ---------- 封面：从本地生图历史里选（用户要求：不要只能上传本地文件） ---------- */
  const [coverPick, setCoverPick] = N.useState(null);
  const coverThumb = url => '/api/media?source=' + encodeURIComponent(String(url || '')) + '&variant=thumb-320';
  const loadCoverPage = async (recordId, page, append) => {
    setCoverPick(cur => (cur && cur.recordId === recordId ? Object.assign({}, cur, { loading: true, err: '' }) : cur));
    try {
      const res = await we.get('/local-history?page=' + String(Math.max(0, page)) + '&pageSize=40');
      const items = res && Array.isArray(res.items) ? res.items : [];
      const count = Number((res && res.count) || 0) || items.length;
      setCoverPick(cur => (cur && cur.recordId === recordId
        ? Object.assign({}, cur, { loading: false, items: append ? cur.items.concat(items) : items, count, page: Math.max(0, page) + 1 })
        : cur));
    } catch (e) {
      setCoverPick(cur => (cur && cur.recordId === recordId
        ? Object.assign({}, cur, { loading: false, err: '读取本地生图历史失败：' + String((e && e.message) || e) + '（历史可能没有开启，可在「记录 → 历史」里确认）' })
        : cur));
    }
  };
  const openCoverPicker = rec => {
    setCoverPick({ recordId: rec.id, name: rec.name, items: [], count: 0, loading: true, err: '', page: 0 });
    void loadCoverPage(rec.id, 0, false);
  };
  const applyCover = async (recordId, imageUrl) => {
    const rec = rows.find(r => r.id === recordId) || null;
    if (!rec) { notify('找不到这条记录：刷新后再试一次', 'error'); return; }
    setCoverBusy(recordId);
    try {
      await putCover(rec, imageUrl);
      setCoverPick(null);
      notify('封面已更新（从历史图复制一份，原历史图不受影响）', 'success');
      onRefresh();
    } catch (e) {
      notify('设置封面失败：' + String((e && e.message) || e), 'error');
    } finally {
      setCoverBusy('');
    }
  };
  const onCoverPicked = async ev => {
    const el = ev.target;
    const file = el.files && el.files[0];
    const id = String(el.dataset.recordId || '');
    el.value = '';
    if (!file || !id) return;
    const rec = rows.find(r => r.id === id) || null;
    if (!rec) { notify('找不到这条记录：刷新后再试一次', 'error'); return; }
    setCoverBusy(id);
    try {
      const blob = await __naiRollShrinkImage(file, 640);
      const form = new FormData();
      form.append('file', blob, 'cover.png');
      form.append('folder', 'covers');
      const up = await fetch('/api/upload', { method: 'POST', body: form });
      if (!up.ok) throw new Error('上传失败（HTTP ' + up.status + '）');
      const upJson = await up.json().catch(() => null);
      const url = upJson && upJson.url;
      if (!url) throw new Error('上传没有返回图片地址');
      await putCover(rec, url);
      setCoverPick(null);
      notify('封面已更新（只改这条记录的封面，六类内容一个字都没动）', 'success');
      onRefresh();
    } catch (e) {
      notify('设置封面失败：' + String((e && e.message) || e), 'error');
    } finally {
      setCoverBusy('');
    }
  };
  const clearCover = async rec => {
    setCoverBusy(rec.id);
    try {
      await putCover(rec, '');
      notify('封面已清除', 'success');
      onRefresh();
    } catch (e) {
      notify('清除封面失败：' + String((e && e.message) || e), 'error');
    } finally {
      setCoverBusy('');
    }
  };
  const [extractOpen, setExtractOpen] = N.useState(false);
  const [extractList, setExtractList] = N.useState(null);
  const [extractPick, setExtractPick] = N.useState('');
  const [extractBusy, setExtractBusy] = N.useState(false);
  const [extractMsg, setExtractMsg] = N.useState('');
  const openExtract = async () => {
    setExtractOpen(true);
    setExtractMsg('');
    setExtractPick('');
    setExtractList(null);
    try {
      const res = await we.get('/chains');
      const list = Array.isArray(res) ? res : (res && Array.isArray(res.chains) ? res.chains : []);
      const full = list.filter(x => {
        const sp = (x && x.params && x.params._presetSnapshot) || null;
        return !!sp && String(sp.format || '') !== __naiRollCore.CONTENT_FORMAT;
      }).map(x => ({ id: String(x.id), name: String(x.name || '（未命名）'), updatedAt: Number(x.updatedAt) || 0, snapshot: x.params._presetSnapshot }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setExtractList(full);
    } catch (e) {
      setExtractMsg('读取完整搭配失败：' + String((e && e.message) || e));
      setExtractList([]);
    }
  };
  const runExtract = async () => {
    const hit = (extractList || []).find(x => x.id === extractPick);
    if (!hit) { setExtractMsg('先选一份完整搭配'); return; }
    const built = __naiRollCore.contentFromPresetSnapshot(hit.snapshot, new Date().toISOString());
    if (!built) { setExtractMsg('这份搭配里没有可提取的六类内容（可能只有画师串与参数）'); return; }
    setExtractBusy(true);
    setExtractMsg('');
    try {
      const id = 'agent-' + __naiRollHex64();
      await we.post('/chains', {
        id, type: 'preset',
        name: hit.name + ' · 提取内容',
        description: '从完整搭配「' + hit.name + '」人工提取的六类内容（已排除画师串、风格负面与生图参数）',
        tags: ['提取'], basePrompt: '', negativePrompt: '', modules: [], variableValues: {},
        params: { _rollContentSnapshot: built }
      });
      setExtractOpen(false);
      setExtractPick('');
      notify('已提取成新的 Roll 内容记录（画师串、风格负面与参数都没有带过来）', 'success');
      onRefresh();
    } catch (e) {
      setExtractMsg('提取失败：' + String((e && e.message) || e));
    } finally {
      setExtractBusy(false);
    }
  };
  const extractPanel = () => {
    if (!extractOpen) return null;
    const hit = (extractList || []).find(x => x.id === extractPick);
    const built = hit ? __naiRollCore.contentFromPresetSnapshot(hit.snapshot, '') : null;
    return g.jsxs('section', { 'data-nai-rolllib-extract-panel': 'true', className: 'rounded-2xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/30', children: [
      g.jsxs('div', { className: 'flex flex-wrap items-baseline justify-between gap-2', children: [
        g.jsx('h3', { className: 'text-sm font-bold text-amber-900 dark:text-amber-200', children: '从完整搭配提取六类内容' }),
        g.jsx('button', { type: 'button', 'data-nai-rolllib-extract-close': 'true', className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => setExtractOpen(false), children: '关闭' })
      ] }),
      g.jsx('p', { className: 'mt-1 text-[11px] leading-5 text-gray-600 dark:text-gray-300', children: '提取只复制六类内容与它们自己的约束；画师串、风格配套负面、用户全局负面、模型与全部生图参数都会被排除。旧记录本身不会被修改。' }),
      extractList === null
        ? g.jsx('p', { className: 'mt-2 text-[11px] text-gray-500 dark:text-gray-400', children: '正在读取完整搭配…' })
        : (extractList.length
          ? g.jsx('div', { className: 'mt-2 flex flex-wrap gap-1', children: extractList.map(x => g.jsx('button', {
            key: x.id, type: 'button', 'data-nai-rolllib-extract-item': x.id,
            'data-nai-rolllib-extract-active': extractPick === x.id ? 'true' : 'false',
            className: __naiRollChip(extractPick === x.id, '!px-2 !py-1 !text-[11px]'), onClick: () => setExtractPick(x.id), children: x.name
          }, x.id)) })
          : g.jsx('p', { 'data-nai-rolllib-extract-empty': 'true', className: 'mt-2 text-[11px] text-gray-500 dark:text-gray-400', children: '还没有任何完整搭配可提取（完整搭配是「保存搭配」生成的记录）。' })),
      built
        ? g.jsx('p', { 'data-nai-rolllib-extract-scope': 'true', className: 'mt-2 text-[11px] leading-5 text-gray-600 dark:text-gray-300', children: '将提取：' + (__naiRollCore.contentScopeOf(__naiRollCore.contentRead(built)).label || '（无可提取内容）') + '；将排除：画师串 / 风格配套负面 / 用户全局负面 / 模型与全部生图参数' })
        : null,
      extractMsg ? g.jsx('p', { 'data-nai-rolllib-extract-msg': 'true', className: 'mt-1 text-[11px] leading-5 text-red-600 dark:text-red-400', children: extractMsg }) : null,
      g.jsx('button', { type: 'button', 'data-nai-rolllib-extract-run': 'true', disabled: !extractPick || extractBusy, className: __naiRollChip(true, 'mt-2'), onClick: runExtract, children: extractBusy ? '提取中…' : '提取并另存为内容记录' })
    ] });
  };
  const coverPickerUI = () => {
    if (!coverPick) return null;
    const cur = coverPick;
    /* 面板必须**视口固定**：Roll 内容库这页是可滚动容器，绝对定位会跟着内容滚到视口外（实测 y=-3781 点不到）。 */
    return g.jsx('div', {
      className: 'nai-preset-overlay',
      'data-nai-rolllib-cover-overlay': 'true',
      style: { position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, background: 'rgba(15,23,42,.45)' },
      children:
      g.jsxs('div', { className: 'nai-preset-card', 'data-nai-rolllib-cover-panel': cur.recordId, style: { maxWidth: 760, width: 'min(92vw, 760px)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }, children: [
        g.jsxs('div', { className: 'nai-preset-head', children: [
          g.jsx('span', { className: 'nai-preset-badge', children: '封面' }),
          g.jsxs('div', { style: { flex: '1 1 auto', minWidth: 0 }, children: [
            g.jsx('p', { className: 'nai-preset-title', children: '为「' + cur.name + '」选一张封面' }),
            g.jsx('p', { className: 'nai-preset-sub', children: '从本地生图历史里选（共 ' + String(cur.count) + ' 张）；选中的图会复制一份做封面，原历史图不受影响' })
          ] }),
          g.jsx('button', { type: 'button', 'data-nai-rolllib-cover-close': 'true', className: 'nai-preset-close', 'aria-label': '关闭', onClick: () => setCoverPick(null), children: '×' })
        ] }),
        g.jsx('div', { className: 'nai-preset-body', style: { overflowY: 'auto', minHeight: 0 }, children:
          g.jsxs('div', { children: [
            cur.err ? g.jsx('p', { 'data-nai-rolllib-cover-err': 'true', className: 'nai-preset-note', children: cur.err }) : null,
            g.jsx('div', { 'data-nai-rolllib-cover-grid': 'true', className: 'grid grid-cols-3 gap-2 sm:grid-cols-5', children:
              cur.items.map(it => g.jsxs('button', {
                key: it.id, type: 'button', 'data-nai-rolllib-cover-pick': it.id,
                title: (it.prompt || '').slice(0, 120) || '（这张图没有提示词记录）',
                disabled: coverBusy === cur.recordId, onClick: () => applyCover(cur.recordId, it.imageUrl),
                className: 'group relative aspect-[3/4] overflow-hidden rounded-lg border border-gray-200 bg-gray-100 hover:border-indigo-400 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800',
                children: [
                  /* 让点击目标始终是按钮本身：安全模式下应用会在捕获阶段吞掉落在 <img> 上的点击，
                   pointer-events:none 之后事件直接从按钮起跳，两种模式都能点。 */
                  g.jsx('img', { key: 'i', src: coverThumb(it.imageUrl), alt: '', loading: 'lazy', style: { pointerEvents: 'none' }, className: 'h-full w-full object-cover' }),
                  it.isFavorite ? g.jsx('span', { key: 'f', className: 'absolute left-1 top-1 rounded bg-amber-400 px-1 text-[10px] font-bold text-white', children: '★' }) : null
                ]
              }, it.id))
            }),
            !cur.items.length && cur.loading ? g.jsx('p', { className: 'nai-preset-note', children: '正在读取本地生图历史…' }) : null,
            !cur.items.length && !cur.loading && !cur.err ? g.jsx('p', { 'data-nai-rolllib-cover-empty': 'true', className: 'nai-preset-note', children: '本地历史里没有图片：先去生图，或用下面的「上传本地图片」。' }) : null,
            g.jsxs('div', { className: 'mt-2 flex flex-wrap items-center gap-2', children: [
              cur.items.length < cur.count
                ? g.jsx('button', { type: 'button', 'data-nai-rolllib-cover-more': 'true', className: __naiRollChip(false, '!px-3 !py-1.5 !text-xs'), onClick: () => loadCoverPage(cur.recordId, cur.page, true), children: '加载更多（已显示 ' + String(cur.items.length) + ' / ' + String(cur.count) + '）' })
                : null,
              g.jsx('button', { type: 'button', 'data-nai-rolllib-cover-upload': cur.recordId, className: __naiRollChip(false, '!px-3 !py-1.5 !text-xs'), onClick: () => pickUpload({ id: cur.recordId }), children: '上传本地图片' }),
              g.jsx('button', { type: 'button', 'data-nai-rolllib-cover-cancel': 'true', className: __naiRollChip(false, '!px-3 !py-1.5 !text-xs'), onClick: () => setCoverPick(null), children: '取消' })
            ] })
          ] })
        })
      ] })
    });
  };
  const previewBody = () => {
    if (!preview) return null;
    const rec = preview;
    const read = rec.read;
    const rowsOut = [];
    if (read.roles && read.roles[0]) {
      for (const kind of __naiRollCore.ROLE_KEYS) {
        const provided = read.roles[0].provided[kind];
        const neg = read.roles[0].negatives[kind];
        rowsOut.push(g.jsxs('div', { key: 'r-' + kind, 'data-nai-rolllib-preview-row': kind, className: 'rounded-lg border border-gray-200 p-2 dark:border-gray-800', children: [
          g.jsxs('div', { className: 'flex flex-wrap items-baseline justify-between gap-1', children: [
            g.jsx('span', { className: 'text-[11px] font-bold text-indigo-600 dark:text-indigo-300', children: __naiRollLibKindLabel(kind) }),
            g.jsx('span', { className: 'text-[10px] text-gray-400', children: provided ? '角色内容（' + (read.roles[0].name || '角色 1') + '）' : '本次未提供' })
          ] }),
          provided ? g.jsx('p', { className: 'mt-1 break-words font-mono text-[11px] leading-4 text-gray-700 dark:text-gray-300', children: read.roles[0].sections[kind] }) : null,
          neg ? g.jsx('p', { 'data-nai-rolllib-preview-neg': kind, className: 'mt-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400', children: '内容负面/约束：' + [neg.text, neg.note].filter(Boolean).join('；') }) : null
        ] }, 'r-' + kind));
      }
    }
    for (const kind of __naiRollCore.GLOBAL_KEYS) {
      const g2 = read.global[kind];
      rowsOut.push(g.jsxs('div', { key: 'g-' + kind, 'data-nai-rolllib-preview-row': kind, className: 'rounded-lg border border-gray-200 p-2 dark:border-gray-800', children: [
        g.jsxs('div', { className: 'flex flex-wrap items-baseline justify-between gap-1', children: [
          g.jsx('span', { className: 'text-[11px] font-bold text-indigo-600 dark:text-indigo-300', children: __naiRollLibKindLabel(kind) }),
          g.jsx('span', { className: 'text-[10px] text-gray-400', children: g2 && g2.provided ? '全局内容（影响整幅图）' : '本次未提供' })
        ] }),
        g2 && g2.provided ? g.jsx('p', { className: 'mt-1 break-words font-mono text-[11px] leading-4 text-gray-700 dark:text-gray-300', children: g2.text }) : null,
        g2 && g2.negative ? g.jsx('p', { 'data-nai-rolllib-preview-neg': kind, className: 'mt-1 text-[10px] leading-4 text-amber-600 dark:text-amber-400', children: '内容负面/约束：' + [g2.negative.text, g2.negative.note].filter(Boolean).join('；') }) : null
      ] }, 'g-' + kind));
    }
    return g.jsxs('div', { 'data-nai-rolllib-preview-panel': rec.id, className: 'mt-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900', children: [
      g.jsxs('div', { className: 'flex flex-wrap items-baseline justify-between gap-2', children: [
        g.jsx('h3', { className: 'text-sm font-bold text-gray-800 dark:text-gray-100', children: '只读预览：' + rec.name }),
        g.jsx('button', { type: 'button', 'data-nai-rolllib-preview-close': 'true', className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: () => setPreviewId(''), children: '关闭预览' })
      ] }),
      g.jsx('p', { className: 'mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400', children: '这条记录只含六类内容与它们自己的约束；画师串、风格配套负面、你手填的全局负面、模型与全部生图参数都不在里面。' }),
      read.warnings && read.warnings.length ? g.jsx('p', { 'data-nai-rolllib-preview-warn': 'true', className: 'mt-1 text-[11px] leading-5 text-amber-600 dark:text-amber-400', children: read.warnings.join('；') }) : null,
      g.jsx('div', { className: 'mt-2 space-y-2', children: rowsOut }),
      g.jsxs('details', { className: 'mt-2 rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-800/40', children: [
        g.jsx('summary', { className: 'cursor-pointer text-[11px] font-medium text-gray-500 dark:text-gray-400', children: '随机证据与来源（按需展开）' }),
        g.jsx('pre', { 'data-nai-rolllib-preview-evidence': 'true', className: 'mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-gray-500 dark:text-gray-400', children: JSON.stringify({ format: read.format, version: read.version, savedAt: read.savedAt, algo: read.algo, roll: read.roll, source: rec.chain.params._rollContentSnapshot }, null, 2) })
      ] }),
      g.jsx('button', { type: 'button', 'data-nai-rolllib-load': rec.id, disabled: !read.ok || busy, className: __naiRollChip(true, 'mt-2 !px-3 !py-1.5 !text-xs'), onClick: () => loadIntoLab(rec.id), children: '载入实验室…（先进确认面板）' }),
      g.jsx('button', { type: 'button', 'data-nai-rolllib-cover': rec.id, disabled: busy || coverBusy === rec.id, className: __naiRollChip(false, 'mt-2 ml-1 !px-3 !py-1.5 !text-xs'), onClick: () => openCoverPicker(rec), title: '给这条记录设一张封图（只改封面，不改六类内容）', children: coverBusy === rec.id ? '上传中…' : (__naiRollLibCoverOf(rec.chain) ? '换封面' : '设封面') })
    ] });
  };
  return g.jsxs('div', {
    'data-nai-rolllib': 'workspace',
    className: 'flex flex-1 min-h-0 flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950',
    children: g.jsxs('div', { className: 'mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6', children: [
      g.jsxs('section', { className: 'rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900', children: [
        g.jsxs('div', { className: 'flex flex-wrap items-baseline justify-between gap-2', children: [
          g.jsx('h2', { className: 'text-base font-bold text-gray-900 dark:text-gray-100', children: 'Roll 内容库' }),
          g.jsxs('span', { 'data-nai-rolllib-count': String(rows.length), className: 'text-[11px] text-gray-400', children: ['共 ' + String(rows.length) + ' 条', query ? '（已筛选）' : ''] }),
          g.jsx('button', { type: 'button', 'data-nai-rolllib-extract-open': 'true', className: __naiRollChip(false, '!px-2 !py-1 !text-[11px]'), onClick: openExtract, children: '从完整搭配提取…' })
        ] }),
        g.jsx('p', { className: 'mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400', children: '六类内容的组合，可与任意现有画师风格搭配：先选稳定画风，再挑内容搭配。这一页只保存内容，不含画师串、风格负面与生图参数。' }),
        g.jsxs('div', { className: 'mt-3 flex flex-wrap items-center gap-2', children: [
          g.jsx('input', {
            type: 'text', 'data-nai-rolllib-search': 'true', value: query, placeholder: '搜索名称、标签、备注…',
            className: 'h-8 min-w-[12rem] flex-1 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
            onChange: ev => setQuery(ev.target.value)
          }),
          g.jsx('select', {
            'data-nai-rolllib-sort': 'true', value: sort,
            className: 'h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200',
            onChange: ev => setSort(ev.target.value),
            children: [g.jsx('option', { key: 'updated', value: 'updated', children: '按更新时间' }), g.jsx('option', { key: 'name', value: 'name', children: '按名称' })]
          }),
          g.jsx('span', { className: 'text-[11px] text-gray-400', children: '搜索只影响本页浏览，不影响同步范围与旧搭配列表' })
        ] })
      ] }),
      coverPickerUI(),
      g.jsx('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp', 'data-nai-rolllib-cover-input': 'true',
        ref: coverInputRef, style: { display: 'none' }, onChange: onCoverPicked
      }),
      g.jsxs('section', { children: [
        rows.length
          ? g.jsx('div', { className: 'space-y-2', children: rows.map(card) })
          : g.jsx('p', { 'data-nai-rolllib-empty': 'true', className: 'rounded-2xl border border-dashed border-gray-200 bg-white p-4 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400', children: records.length
            ? '没有符合搜索条件的记录。'
            : '还没有 Roll 内容记录：到「一键 Roll」抽一组，然后点「存为 Roll 内容」即可创建（只存六类内容）。' })
      ] }),
      extractPanel(),
      previewBody()
    ] })
  });
};
/* __NAI_ROLL_LIB_END__ */


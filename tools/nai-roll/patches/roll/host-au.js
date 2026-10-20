/* =====================================================================
 * 一键 Roll · 实验室侧的计划 / 写入 / 撤销（注入 ChainEditor 主组件 au 的组件体）
 * ---------------------------------------------------------------------
 * 需求要点（P0-2 / P0-3 / P0-4）：
 *   · 目标角色：按**稳定角色 id** 定位；列真实角色名；没有角色时默认「新建角色」；
 *     确认后才创建，取消不创建；目标被删 → 旧预览失效并要求重新确认。
 *   · 预览：逐栏「当前 → 将填入」+ 动作（替换/保留）+ 来源（含「已更新 / 已失效」）；
 *     未参与或空库的栏位显示「本次未提供 · 保留」，不隐藏、不清空。
 *   · 写入：只调既有 setter；全局与角色各**一次**状态更新；正负面+元数据一起提交。
 *   · 撤销：一次撤销覆盖本次全部范围；撤销会覆盖填入之后的手改时，先说明影响再确认。
 *   · 不自动保存、不自动提交生成。
 * ===================================================================== */
/* __NAI_ROLL_HOST_AU_BEGIN__ */
const __naiRollHostGlobal = l.useRef(null);
const __naiRollHostChar = l.useRef(null);
/* 宿主登记：渲染期由 tu / Pi 直接调用（不用 useCallback，减少 hook 面） */
const __naiRollRegisterHost = api => {
  if (!api || typeof api !== 'object') return;
  if (api.kind === 'global') __naiRollHostGlobal.current = api;
  else if (api.kind === 'character') __naiRollHostChar.current = api;
};
const [__naiRollApply, __naiSetRollApply] = l.useState(null);
const [__naiRollUndo, __naiSetRollUndo] = l.useState(null);
const [__naiRollUndoWarn, __naiSetRollUndoWarn] = l.useState(null);

/* ---------- 只读读取（优先用宿主登记的实现，拿不到时回落成与实验室同口径的直读） ---------- */
const __naiRollReadGlobal = key => {
  const host = __naiRollHostGlobal.current;
  if (host && typeof host.readSection === 'function') { try { return String(host.readSection(key) || ''); } catch (_e) { /* 回落 */ } }
  const sec = ie._promptSections || {};
  if (key === 'scene') return String(sec.scene != null ? sec.scene : (sec.extra != null ? sec.extra : ''));
  return String(sec[key] == null ? '' : sec[key]);
};
const __naiRollReadGlobalNeg = key => {
  const host = __naiRollHostGlobal.current;
  if (host && typeof host.readNeg === 'function') { try { return host.readNeg(key); } catch (_e) { /* 回落 */ } }
  return (ie._promptSectionsNegatives || {})[key] || null;
};
const __naiRollReadGlobalMeta = key => {
  const host = __naiRollHostGlobal.current;
  if (host && typeof host.readMeta === 'function') { try { return host.readMeta(key); } catch (_e) { /* 回落 */ } }
  return (ie._promptSectionsMeta || {})[key] || null;
};
const __naiRollFindChar = id => (Array.isArray(ie.characters) ? ie.characters : []).find(c => String((c && c.id) || '') === String(id || '')) || null;
const __naiRollReadChar = (id, key) => {
  const host = __naiRollHostChar.current;
  if (host && typeof host.readSection === 'function') { try { return String(host.readSection(id, key) || ''); } catch (_e) { /* 回落 */ } }
  const c = __naiRollFindChar(id);
  const direct = String((c && c.sections && c.sections[key]) || '');
  if (direct) return direct;
  return String(((ie._characterSectionsMeta || {})[String(id || '') + '::' + String(key || '')] || {}).appliedText || '');
};
const __naiRollReadCharNeg = (id, key) => {
  const host = __naiRollHostChar.current;
  if (host && typeof host.readNeg === 'function') { try { return host.readNeg(id, key); } catch (_e) { /* 回落 */ } }
  return (ie._characterSectionsNegatives || {})[String(id || '') + '::' + String(key || '')] || null;
};
const __naiRollCharName = (c, ix) => {
  const name = String((c && c.name) || '').trim();
  return name || ('角色 ' + String(Number(ix) + 1));
};
const __naiRollCharFilled = id => __naiRollCore.KINDS.filter(k => __naiRollCore.META[k].scope === 'character' && String(__naiRollReadChar(id, k) || '').trim()).length;

/* ---------- 条目解析：优先用**最新**词库条目；条目改了/删了都如实标出来（R13） ---------- */
const __naiRollResolveEntry = snap => {
  const list = Array.isArray(n) ? n : [];
  const entryId = String((snap && (snap.entryId || snap.id)) || '');
  const fresh = entryId ? list.find(c => String(c.id || '') === entryId) : null;
  const snapText = String((snap && (snap.text || snap.basePrompt)) || '');
  const snapAt = Number(snap && snap.updatedAt) || null;
  if (!entryId) return { entry: null, status: 'missing', source: snap || null };
  if (!fresh) return { entry: null, status: 'missing', source: snap || null };
  const freshAt = Number(fresh.updatedAt) || null;
  const freshText = __naiRollCore.textOf(fresh);
  const changed = (snapAt !== null && freshAt !== null && snapAt !== freshAt) || (!!snapText && snapText !== freshText);
  return { entry: fresh, status: changed ? 'updated' : 'ok', source: snap || null };
};
/* 与统一编辑面板同一形状的 meta（既有的「来源快照 / 本图已修改 / 结构待确认」据此生效） */
const __naiRollMetaOf = (entry, snap, text, seed) => {
  const constraints = entry ? __naiRollCore.constraintsOf(entry) : null;
  return {
    source: 'library',
    entryId: String((entry && entry.id) || (snap && snap.entryId) || ''),
    entryType: String((entry && entry.type) || ''),
    entryName: String((entry && entry.name) || (snap && snap.name) || ''),
    entryUpdatedAt: (entry ? __naiRollCore.updatedAtOf(entry) : (snap && snap.updatedAt)) || null,
    entryBasePrompt: String((entry ? __naiRollCore.textOf(entry) : (snap && snap.text)) || ''),
    entryBilingual: String((entry ? __naiRollCore.bilingualOf(entry) : (snap && snap.bilingual)) || ''),
    entryDescription: String((entry ? __naiRollCore.descriptionOf(entry) : (snap && snap.description)) || ''),
    entryTags: ((entry ? __naiRollCore.tagsOf(entry) : ((snap && snap.tags) || [])) || []).slice(),
    entryPreviewImage: String((entry ? __naiRollCore.previewOf(entry) : '') || ''),
    /* 四态：原样副本 + 待确认标记（只读取、不猜测、不回写词库） */
    entryFacets: constraints ? constraints.facets : ((snap && snap.constraints && snap.constraints.facets) || null),
    entryConstraints: constraints ? {
      absent: constraints.absent.map(x => ({ key: x.key, label: x.label, known: !!x.known })),
      auto: constraints.auto.map(x => ({ key: x.key, label: x.label, known: !!x.known })),
      values: constraints.values.map(x => ({ key: x.key, label: x.label, value: x.value })),
      unknown: constraints.unknown.slice(),
      notes: constraints.notes
    } : null,
    rollSource: '一键 Roll',
    rollSeed: String(seed || ''),
    appliedAt: Date.now(),
    appliedMode: 'replace',
    appliedText: String(text || ''),
    needsReview: !!(constraints ? constraints.needsReview : false),
    bilingualStale: false
  };
};
/* 每个栏位的负面与备注：来源=该条目自己的 negativePrompt + 四态派生的约束说明 */
const __naiRollNegativeOf = entry => {
  const constraints = entry ? __naiRollCore.constraintsOf(entry) : null;
  return {
    negative: entry ? __naiRollCore.negativeOf(entry) : '',
    notes: constraints ? constraints.notes : '',
    source: entry ? __naiRollCore.nameOf(entry) : ''
  };
};

/* ---------- 组计划（预览与写入共用同一份，避免「预览一套、写入另一套」） ----------
   两条来源：
     · 一键 Roll：条目按**最新**词库内容解析（条目改了就用新的，并标出来）；
     · Roll 内容库：**只用记录里的快照**（来源改名/改内容/删除都不改变已存内容，需求 §5.1）。
   两条来源共用同一份计划结构与同一个应用引擎。 */
const __naiRollBuildPlan = (payload, target) => {
  const checks = (payload && payload.checks) || {};
  const picks = (payload && payload.picks) || {};
  const fromLib = !!(payload && payload.fromLibrary);
  const rows = [];
  for (const kind of __naiRollCore.KINDS) {
    const meta = __naiRollCore.META[kind];
    const scope = meta.scope;
    const snap = picks[kind] || null;
    const participated = checks[kind] !== false;
    const cur = scope === 'global'
      ? __naiRollReadGlobal(kind)
      : (target && target.mode === 'existing' ? __naiRollReadChar(target.id, kind) : (target && target.mode === 'none' ? '（先选目标角色）' : ''));
    const currentNeg = scope === 'global'
      ? __naiRollReadGlobalNeg(kind)
      : (target && target.mode === 'existing' ? __naiRollReadCharNeg(target.id, kind) : null);
    let entry = null;
    let status = 'none';
    let nextText = '';
    let neg = { negative: '', notes: '', source: '' };
    let metaObj = null;
    let reason = '';
    if (!participated) {
      reason = '本次未参与';
    } else if (!snap) {
      reason = fromLib ? '这条记录本次未提供' : '该库 0 条（本次未提供）';
    } else if (fromLib) {
      /* 快照直用：不查词库、不重抽 */
      status = 'snapshot';
      nextText = String(snap.text || '');
      neg = { negative: String(snap.negative || ''), notes: String(snap.negativeNotes || ''), source: String(snap.name || '') };
      metaObj = snap.meta || null;
      if (!String(nextText || '').trim()) reason = '记录里这一类没有正面内容';
    } else {
      const resolved = __naiRollResolveEntry(snap);
      entry = resolved.entry;
      status = resolved.status;
      nextText = entry ? __naiRollCore.textOf(entry) : String((snap && snap.text) || '');
      neg = __naiRollNegativeOf(entry);
      metaObj = __naiRollMetaOf(entry, snap, nextText, payload && payload.seed);
      if (!String(nextText || '').trim()) reason = '条目没有正面内容';
      else if (status === 'missing') reason = '来源条目已删除，用本次快照内容';
      else if (status === 'updated') reason = '来源条目已更新，用新内容';
    }
    const canWrite = participated && !!snap && !!String(nextText || '').trim();
    rows.push({
      kind,
      key: kind,
      scope,
      title: meta.title,
      currentText: cur,
      currentNeg: currentNeg,
      nextText: canWrite ? nextText : '',
      negative: canWrite ? neg.negative : '',
      negativeNotes: canWrite ? neg.notes : '',
      negativeSource: canWrite ? neg.source : '',
      meta: canWrite ? metaObj : null,
      action: canWrite ? 'replace' : 'keep',
      forcedKeep: false,
      writable: canWrite,
      reason,
      sourceStatus: status,
      sourceName: entry ? __naiRollCore.nameOf(entry) : String((snap && snap.name) || ''),
      constraints: entry ? __naiRollCore.constraintsOf(entry) : null
    });
  }
  return rows;
};
const __naiRollStyleState = (payload) => {
  const style = payload && payload.style ? payload.style : null;
  return {
    mode: style && payload.styleMode !== 'keep' ? 'replace' : 'keep',
    available: !!style,
    name: style ? String(style.name || '') : '',
    nextBase: style ? String(style.basePrompt || '') : '',
    nextNeg: style ? String(style.negativePrompt || '') : '',
    beforeBase: String(ue || ''),
    beforeNeg: String(Z || '')
  };
};

/* ---------- 打开面板（由 pending-import 的 roll-apply 分支调用） ---------- */
const __naiRollOpen = payload => {
  const list = Array.isArray(ie.characters) ? ie.characters : [];
  const targets = list.map((c, ix) => ({ id: String((c && c.id) || ''), name: __naiRollCharName(c, ix), filled: __naiRollCharFilled(String((c && c.id) || '')) }));
  const hostReady = !!(__naiRollHostGlobal.current || __naiRollHostChar.current);
  /* 需求 §二：Roll 页没有实验室的新鲜上下文，实验室这里也不「默认第一个角色」，
     必须由用户明确选一次（没有角色时默认「新建角色」，那时「新建」本身就是明确选择）。 */
  const preferred = (payload && payload.targetMode === 'existing' && payload.targetId && __naiRollFindChar(payload.targetId))
    ? { mode: 'existing', id: String(payload.targetId) }
    : null;
  const target = preferred || (list.length ? { mode: 'none', id: '' } : { mode: 'new', id: '' });
  const rows = __naiRollBuildPlan(payload, target);
  const fromLib = !!(payload && payload.fromLibrary);
  const modelNote = fromLib ? __naiRollModelNote() : { text: '', ok: true };
  __naiSetRollUndoWarn(null);
  __naiSetRollApply({
    payload,
    mode: fromLib ? 'library' : 'roll',
    showStyle: !fromLib,
    recordId: String((payload && payload.recordId) || ''),
    recordName: String((payload && payload.recordName) || ''),
    seed: String((payload && payload.seed) || ''),
    at: Date.now(),
    target,
    targets,
    rows,
    style: __naiRollStyleState(payload),
    note: fromLib
      ? (String((payload && payload.note) || '') + ' ' + String(modelNote.text || '')).trim()
      : '',
    warnings: Array.isArray(payload && payload.warnings) ? payload.warnings : [],
    err: hostReady ? '' : '实验室的分区面板还没挂载（当前可能不是生图模式），先切到生图模式再试。',
    stale: '',
    busy: false
  });
};
/* 换目标：重建计划（读新目标的当前内容），旧预览立即失效重算 */
const __naiRollPickTarget = next => {
  __naiSetRollApply(prev => {
    if (!prev) return prev;
    const target = next && next.mode === 'existing' ? { mode: 'existing', id: String(next.id || '') } : { mode: 'new', id: '' };
    return { ...prev, target, rows: __naiRollBuildPlan(prev.payload, target), stale: '', err: '' };
  });
};
const __naiRollPickStyle = next => {
  __naiSetRollApply(prev => (prev ? { ...prev, style: { ...prev.style, mode: next && next.mode === 'replace' ? 'replace' : 'keep' } } : prev));
};
const __naiRollToggleRow = kind => {
  __naiSetRollApply(prev => {
    if (!prev) return prev;
    return {
      ...prev,
      rows: prev.rows.map(r => {
        if (r.kind !== kind) return r;
        if (!r.writable) return r;
        const next = r.action === 'replace' ? 'keep' : 'replace';
        return { ...r, action: next, forcedKeep: next === 'keep' };
      })
    };
  });
};

/* ---------- 确认写入（先复查、再一次提交、再记撤销） ---------- */
const __naiRollConfirm = force => {
  const st = __naiRollApply;
  if (!st) return;
  const rows = (st.rows || []).filter(r => r.action === 'replace');
  const target = st.target || { mode: 'new', id: '' };
  if (!rows.length) { __naiSetRollApply(s => (s ? { ...s, err: '没有可写入的栏位：把某一栏改成「改为填入」再试。' } : s)); return; }
  if (target.mode === 'none') { __naiSetRollApply(s => (s ? { ...s, err: '请先选择「填入哪个角色」（或选「新建角色」）再确认。' } : s)); return; }
  if (target.mode === 'existing' && !__naiRollFindChar(target.id)) {
    __naiSetRollApply(s => (s ? { ...s, stale: '目标角色已经不存在了（可能被删除），请重新选择目标后再确认。', err: '' } : s));
    return;
  }
  /* 复查：打开面板之后有人改了这些栏位 → 不写，重新算一遍让用户再看一眼 */
  const drifted = rows.filter(r => String(r.scope === 'global' ? __naiRollReadGlobal(r.key) : __naiRollReadChar(target.id, r.key)) !== String(r.currentText || ''));
  if (drifted.length && !force) {
    __naiSetRollApply(s => (s ? {
      ...s,
      stale: '这些栏位在打开面板后被改过：' + drifted.map(r => r.title).join('、') + '。已按最新内容重算预览，请再确认一次（不会写入半套）。',
      rows: __naiRollBuildPlan(s.payload, target)
    } : s));
    return;
  }
  const points = [];
  for (const r of rows) {
    if (r.scope === 'global') {
      const beforeNeg = __naiRollReadGlobalNeg(r.key);
      points.push({
        scope: 'global', key: r.key, title: r.title,
        beforeText: __naiRollReadGlobal(r.key), beforeMeta: __naiRollReadGlobalMeta(r.key), beforeNeg: beforeNeg || null,
        wroteText: r.nextText, wroteNegText: String(r.negative || ''), wroteNegNote: String(r.negativeNotes || '')
      });
    } else {
      const beforeNeg = target.mode === 'existing' ? __naiRollReadCharNeg(target.id, r.key) : null;
      points.push({
        scope: 'character', characterId: target.mode === 'existing' ? String(target.id) : '', key: r.key, title: r.title,
        beforeText: target.mode === 'existing' ? __naiRollReadChar(target.id, r.key) : '', beforeMeta: null, beforeNeg: beforeNeg || null,
        wroteText: r.nextText, wroteNegText: String(r.negative || ''), wroteNegNote: String(r.negativeNotes || '')
      });
    }
  }
  const globalRows = rows.filter(r => r.scope === 'global');
  const charRows = rows.filter(r => r.scope === 'character');
  const result = { global: null, character: null };
  try {
    if (globalRows.length) {
      const host = __naiRollHostGlobal.current;
      if (!host) throw new Error('全局分区面板未挂载');
      result.global = host.applyPlan(globalRows.map(r => ({ key: r.key, text: r.nextText, meta: r.meta, negative: r.negative, negativeNotes: r.negativeNotes, negativeSource: r.negativeSource })));
      if (result.global && result.global.ok === false) throw new Error('全局栏写入被拒绝：' + String(result.global.reason || ''));
    }
    if (charRows.length) {
      const host = __naiRollHostChar.current;
      if (!host) throw new Error('角色分区面板未挂载');
      result.character = host.applyPlan(target.mode === 'existing' ? target.id : '', charRows.map(r => ({ key: r.key, text: r.nextText, meta: r.meta, negative: r.negative, negativeNotes: r.negativeNotes, negativeSource: r.negativeSource })), target.mode === 'new');
      if (result.character && result.character.ok === false) throw new Error('角色栏写入被拒绝：' + String(result.character.reason || ''));
    }
    const createdId = result.character && result.character.created ? String(result.character.characterId || '') : '';
    if (createdId) for (const p of points) if (p.scope === 'character') p.characterId = createdId;
    const styleChanged = st.style && st.style.mode === 'replace' && (String(st.style.nextBase || '') !== String(ue || '') || String(st.style.nextNeg || '') !== String(Z || ''));
    if (st.style && st.style.mode === 'replace') { Q(String(st.style.nextBase || '')); ge(String(st.style.nextNeg || '')); }
    Et();
    __naiSetRollUndo({
      at: Date.now(),
      label: (st.mode === 'library' ? (st.recordName ? '「' + st.recordName + '」' : 'Roll 内容') : 'Roll 组合') + '：角色 ' + String(charRows.length) + ' 类 / 全局 ' + String(globalRows.length) + ' 类',
      seed: String(st.seed || ''),
      points,
      createdCharacterId: createdId,
      style: styleChanged ? { beforeBase: st.style.beforeBase, beforeNeg: st.style.beforeNeg } : null
    });
    __naiSetRollApply(null);
    if (st.mode === 'library') {
      h('已载入 Roll 内容' + (st.recordName ? '「' + st.recordName + '」' : '') + '：角色 ' + String(charRows.length) + ' 类、全局 ' + String(globalRows.length) + ' 类'
        + (createdId ? '，并新建了 1 个角色' : '') + '；画师风格、风格配套负面与生图参数都保持当前配置，也没有开始生图', 'success');
    } else {
      h('已填入 Roll 组合（' + String(st.seed || '') + '）：角色 ' + String(charRows.length) + ' 类、全局 ' + String(globalRows.length) + ' 类'
        + (createdId ? '，并新建了 1 个角色' : '')
        + '；其它角色与生成参数没有改，也没有开始生图', 'success');
    }
  } catch (err) {
    __naiSetRollApply(s => (s ? { ...s, err: '写入失败：' + String((err && err.message) || err) + '（已写入的部分可用「撤销本次 Roll 填入」整体回退）', busy: false } : s));
  }
};

/* ---------- 一次撤销 ---------- */
const __naiRollUndoRun = force => {
  const u = __naiRollUndo;
  if (!u) return;
  if (u.createdCharacterId) {
    const host = __naiRollHostChar.current;
    if (host && typeof host.removePlan === 'function') {
      try { host.removePlan(u.createdCharacterId); } catch (_e) { /* 下面继续回写其它点 */ }
    }
  }
  const conflicts = [];
  for (const p of u.points) {
    if (p.scope === 'character' && u.createdCharacterId && String(p.characterId) === String(u.createdCharacterId)) continue;
    const cur = p.scope === 'global' ? __naiRollReadGlobal(p.key) : __naiRollReadChar(p.characterId, p.key);
    if (String(cur || '') !== String(p.wroteText || '')) conflicts.push(p.title);
  }
  if (conflicts.length && !force) {
    __naiSetRollUndoWarn('撤销会覆盖你在填入之后对 ' + conflicts.join('、') + ' 的手动修改；无关的手改不会被抹掉。');
    return;
  }
  try {
    const byChar = {};
    const globalPoints = [];
    for (const p of u.points) {
      if (p.scope === 'global') globalPoints.push(p);
      else if (!(u.createdCharacterId && String(p.characterId) === String(u.createdCharacterId))) {
        if (!byChar[p.characterId]) byChar[p.characterId] = [];
        byChar[p.characterId].push(p);
      }
    }
    const toPlan = p => ({
      key: p.key, text: String(p.beforeText || ''), meta: p.beforeMeta || null,
      negative: String((p.beforeNeg && p.beforeNeg.text) || ''), negativeNotes: String((p.beforeNeg && p.beforeNeg.note) || ''),
      negativeSource: String((p.beforeNeg && p.beforeNeg.source) || '')
    });
    if (globalPoints.length && __naiRollHostGlobal.current) __naiRollHostGlobal.current.applyPlan(globalPoints.map(toPlan));
    for (const charId of Object.keys(byChar)) {
      if (!__naiRollHostChar.current || !__naiRollFindChar(charId)) continue;
      __naiRollHostChar.current.applyPlan(charId, byChar[charId].map(toPlan), false);
    }
    if (u.style) { Q(String(u.style.beforeBase || '')); ge(String(u.style.beforeNeg || '')); }
    Et();
    __naiSetRollUndo(null);
    __naiSetRollUndoWarn(null);
    h('已撤销本次 Roll 填入：恢复了 ' + String(u.points.length) + ' 个范围' + (u.createdCharacterId ? '，并移除了新建的角色' : '') + '；无关的修改没有被抹掉', 'success');
  } catch (err) {
    h('撤销失败：' + String((err && err.message) || err), 'error');
  }
};
const __naiRollContentUI = () => __naiRollPickerUI();
const __naiRollApplyUI = () => e.jsx(__NaiRollApplyPanel, {
  state: __naiRollApply,
  onCancel: () => __naiSetRollApply(null),
  onConfirm: __naiRollConfirm,
  onPickTarget: __naiRollPickTarget,
  onToggleRow: __naiRollToggleRow,
  onPickStyle: __naiRollPickStyle,
  onUndoRoll: __naiRollUndo ? () => __naiRollUndoRun(false) : null
});
const __naiRollUndoUI = () => e.jsx(__NaiRollUndoBanner, {
  info: __naiRollUndo,
  warn: __naiRollUndoWarn,
  onUndo: () => __naiRollUndoRun(false),
  onForce: () => __naiRollUndoRun(true),
  onDismiss: () => { __naiSetRollUndo(null); __naiSetRollUndoWarn(null); }
});
/* __NAI_ROLL_HOST_AU_END__ */

/* =====================================================================
 * 一键 Roll · 实验室侧「填入前确认」面板（模块作用域，纯展示）
 * ---------------------------------------------------------------------
 * 由 patches/apply-roll.mjs 注入 ChainEditor 模块作用域（所以用 ChainEditor 的绑定：e = jsx, l = React）。
 * 它**只负责把 state 画出来**：目标角色选择、逐栏「当前 → 将填入」、动作（替换/保留）、
 * 风格保持/替换、范围摘要、未覆盖检查说明、警告与错误。
 * 计划怎么算、写到哪、撤销怎么走，全在 patches/roll/host-au.js 里 ——
 * 这里不碰任何 state，也不做任何写入。
 * ===================================================================== */
/* __NAI_ROLL_PANEL_BEGIN__ */
const __NaiRollApplyPanel = ({ state, onCancel, onConfirm, onPickTarget, onToggleRow, onPickStyle, onUndoRoll }) => {
  if (!state) return null;
  const isLib = state.mode === 'library';
  const rows = state.rows || [];
  const targets = state.targets || [];
  const targetMode = state.target && state.target.mode === 'new' ? 'new' : (state.target && state.target.mode === 'existing' ? 'existing' : 'none');
  const targetId = state.target && state.target.id ? String(state.target.id) : '';
  const targetName = (() => {
    if (targetMode === 'none') return '（尚未选择）';
    if (targetMode === 'new') return '新建角色';
    const hit = targets.find(x => String(x.id) === targetId);
    return hit ? hit.name : '（目标已不存在）';
  })();
  const writes = rows.filter(r => r.action === 'replace');
  const keeps = rows.filter(r => r.action === 'keep');
  const charWrites = writes.filter(r => r.scope === 'character');
  const globalWrites = writes.filter(r => r.scope === 'global');
  const confirmLabel = targetMode === 'none'
    ? '先选择填入哪个角色'
    : (targetMode === 'new'
      ? '新建角色并填入（' + String(writes.length) + ' 栏）'
      : '填入「' + targetName + '」（' + String(writes.length) + ' 栏）');
  const styleState = state.style || { mode: 'keep' };
  const scopeOf = r => (r.scope === 'global' ? '全局（影响所有角色所在画面）' : '角色「' + targetName + '」');
  const short = (text, max) => {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const n = max || 90;
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  return e.jsx('div', { className: 'nai-preset-overlay', children:
    e.jsxs('div', { className: 'nai-preset-card', 'data-nai-roll-apply-panel': 'plan', children: [
      e.jsxs('div', { className: 'nai-preset-head', children: [
        e.jsx('span', { className: 'nai-preset-badge', children: '一键 Roll' }),
        e.jsxs('div', { style: { flex: '1 1 auto', minWidth: 0 }, children: [
          e.jsx('p', { className: 'nai-preset-title', children: isLib ? '载入 Roll 内容前先确认' : '填入实验室前先确认要改的地方' }),
          e.jsxs('p', { className: 'nai-preset-sub', children: [
            isLib ? '这条记录只含六类内容' : '组合随机码 ',
            isLib ? null : e.jsx('span', { 'data-nai-roll-apply-seed': String(state.seed || ''), children: String(state.seed || '（无）') }),
            isLib ? '' : ' · ',
            isLib ? '；画师风格、生图参数与风格负面都保持当前配置；这一步不出图' : '这一步只改实验室内容，不出图、不消耗额度、不改写任何词库条目'
          ] })
        ] }),
        e.jsx('button', { type: 'button', 'data-nai-roll-apply-action': 'dismiss', onClick: onCancel, className: 'nai-preset-close', 'aria-label': '关闭一键 Roll 面板', children: '×' })
      ] }),
      state.err ? e.jsx('p', { className: 'nai-preset-err', 'data-nai-roll-apply-error': 'true', children: String(state.err) }) : null,
      state.stale ? e.jsx('p', { className: 'nai-preset-warn', 'data-nai-roll-apply-stale': 'true', children: String(state.stale) }) : null,
      e.jsxs('div', { className: 'nai-preset-body', children: [
        /* ---------- 目标角色 ---------- */
        e.jsxs('div', { className: 'nai-preset-check', style: { display: 'block' }, children: [
          e.jsx('span', { className: 'nai-preset-label', children: '填入哪个角色（按稳定角色 id 定位，改名不影响；已删除的角色会要求重新确认）' }),
          e.jsx('div', { 'data-nai-roll-apply-targets': 'true', style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }, children: [
            e.jsx('button', {
              key: '__new',
              type: 'button',
              'data-nai-roll-apply-target': 'new',
              'data-nai-roll-apply-target-active': targetMode === 'new' ? 'true' : 'false',
              onClick: () => onPickTarget({ mode: 'new' }),
              className: 'nai-preset-btn' + (targetMode === 'new' ? '' : ' nai-preset-secondary'),
              children: '＋ 新建角色'
            }),
            ...targets.map(t => e.jsx('button', {
              key: String(t.id),
              type: 'button',
              'data-nai-roll-apply-target': String(t.id),
              'data-nai-roll-apply-target-active': targetMode === 'existing' && String(t.id) === targetId ? 'true' : 'false',
              onClick: () => onPickTarget({ mode: 'existing', id: String(t.id) }),
              className: 'nai-preset-btn' + (targetMode === 'existing' && String(t.id) === targetId ? '' : ' nai-preset-secondary'),
              title: String(t.id),
              children: String(t.name) + (t.filled ? '（已有 ' + String(t.filled) + ' 栏内容）' : '（空角色）')
            }))
          ] }),
          e.jsx('p', { className: 'nai-preset-note', 'data-nai-roll-apply-target-note': targetName, children: targetMode === 'new'
            ? '取消不会创建任何角色；确认后才新建。'
            : '只改这个角色的四类内容，其它角色的字段一个都不动。' })
        ] }),
        /* ---------- 风格（只在「一键 Roll 填入」时出现；纯内容载入明确不出这一块） ---------- */
        state.showStyle === false ? null : e.jsxs('div', { className: 'nai-preset-check', style: { display: 'block' }, children: [
          e.jsx('span', { className: 'nai-preset-label', children: '画师与风格（全局）' }),
          e.jsxs('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }, children: [
            e.jsx('button', {
              type: 'button', 'data-nai-roll-apply-style': 'keep',
              'data-nai-roll-apply-style-active': styleState.mode === 'keep' ? 'true' : 'false',
              onClick: () => onPickStyle({ mode: 'keep' }),
              className: 'nai-preset-btn' + (styleState.mode === 'keep' ? '' : ' nai-preset-secondary'),
              children: '保持实验室当前风格'
            }),
            e.jsx('button', {
              type: 'button', 'data-nai-roll-apply-style': 'replace',
              'data-nai-roll-apply-style-active': styleState.mode === 'replace' ? 'true' : 'false',
              disabled: !styleState.available,
              onClick: () => onPickStyle({ mode: 'replace' }),
              className: 'nai-preset-btn' + (styleState.mode === 'replace' ? '' : ' nai-preset-secondary'),
              children: styleState.available ? '替换为所选风格串' : '（本次没有选风格串）'
            })
          ] }),
          e.jsx('p', { className: 'nai-preset-note', children: (styleState.mode === 'replace')
            ? '将替换：画师与风格 = ' + short(styleState.nextBase, 80) + (String(styleState.nextNeg || '').trim() ? ' ；全局负面 = ' + short(styleState.nextNeg, 60) : '')
            : '保留实验室当前的画师与风格（不改）。' }),
          styleState.mode === 'replace' && styleState.name
            ? e.jsx('p', { className: 'nai-preset-note', 'data-nai-roll-apply-style-name': String(styleState.name), children: '来源风格串：' + String(styleState.name) })
            : null
        ] }),
        /* ---------- 逐栏 ---------- */
        e.jsxs('table', { className: 'nai-preset-table', 'data-nai-roll-apply-table': 'true', children: [
          e.jsx('thead', { children: e.jsxs('tr', { children: [
            e.jsx('th', { children: '分类' }), e.jsx('th', { children: '范围' }), e.jsx('th', { children: '当前内容' }),
            e.jsx('th', { children: '将填入' }), e.jsx('th', { children: '动作' })
          ] }) }),
          e.jsx('tbody', { children: rows.map(r => e.jsxs('tr', {
            key: r.kind,
            'data-nai-roll-apply-row': r.kind,
            'data-nai-roll-apply-action-cell': r.action,
            'data-nai-roll-apply-source': r.sourceStatus || 'none',
            className: r.action === 'replace' ? 'is-changed' : '',
            children: [
              e.jsxs('td', { className: 'is-scope', children: [
                String(r.title),
                r.sourceName ? e.jsx('span', { 'data-nai-roll-apply-source-name': r.kind, style: { display: 'block', opacity: .7 }, children: '来源：' + String(r.sourceName) }) : null,
                r.sourceStatus === 'snapshot' ? e.jsx('span', { 'data-nai-roll-apply-source-snapshot': r.kind, style: { display: 'block' }, children: '按记录里的内容载入（来源变更不影响这条记录）' }) : null,
                r.sourceStatus === 'updated' ? e.jsx('span', { 'data-nai-roll-apply-source-updated': r.kind, style: { display: 'block' }, children: '来源条目已更新：本次用新内容新建快照' }) : null,
                r.sourceStatus === 'missing' ? e.jsx('span', { 'data-nai-roll-apply-source-missing': r.kind, style: { display: 'block' }, children: '来源条目已不存在：用本次组合里的快照内容' }) : null
              ] }),
              e.jsx('td', { className: 'is-scope', children: scopeOf(r) }),
              e.jsx('td', { className: 'is-current', 'data-nai-roll-apply-current': r.kind, children: r.currentText ? short(r.currentText, 70) : '（空）' }),
              e.jsx('td', { className: 'is-next', 'data-nai-roll-apply-next': r.kind, children: [
                r.action === 'replace'
                  ? (r.nextText ? short(r.nextText, 70) : (r.nextNegative ? '（只带约束）' : '（空）'))
                  : '本次未提供 · 保留原内容',
                r.action === 'replace' && (r.negative || r.negativeNotes)
                  ? e.jsxs('span', { 'data-nai-roll-apply-neg': r.kind, style: { display: 'block', opacity: .8 }, children: [
                    r.negative ? '负面（整栏替换）：' + short(r.negative, 60) : '',
                    r.negativeNotes ? (r.negative ? '；' : '') + '约束/备注：' + short(r.negativeNotes, 90) : ''
                  ] })
                  : null
              ] }),
              e.jsx('td', { children: e.jsx('button', {
                type: 'button',
                'data-nai-roll-apply-toggle': r.kind,
                onClick: () => onToggleRow(r.kind),
                className: 'nai-preset-btn nai-preset-secondary',
                children: r.action === 'replace' ? '改为保留' : '改为填入'
              }) })
            ]
          }, r.kind)) })
        ] }),
        /* ---------- 范围摘要 ---------- */
        state.note ? e.jsx('p', { className: 'nai-preset-note', 'data-nai-roll-apply-note': 'true', children: String(state.note) }) : null,
        e.jsxs('div', { className: 'nai-preset-note', 'data-nai-roll-apply-scope': 'true', children: [
          e.jsx('p', { children: '本次填入：角色 ' + String(charWrites.length) + ' 类、全局 ' + String(globalWrites.length) + ' 类；其余 ' + String(keeps.length) + ' 栏保留实验室原内容（不是清空）。' }),
          e.jsx('p', { children: '正负面与约束：每个被填入的栏位，本栏自己的负面/缺席约束会被**整栏替换**（来源＝该词库条目）；全局负面提示词、其它栏、其它角色的同名约束都不动。' }),
          e.jsx('p', { children: '四态：条目声明的「明确没有 / 自动搭配」只作为约束与备注带过来，原样保留、不猜测、不回写词库。' }),
          e.jsx('p', { 'data-nai-roll-apply-unchecked': 'true', children: '未覆盖检查：左右手占用、角色互动关系、坐椅子等支撑物依赖、自由文本语义解析**不做**自动冲突判定（与词库统一编辑面板的口径一致）。' })
        ] })
      ] }),
      e.jsxs('div', { className: 'nai-preset-actions', children: [
        onUndoRoll ? e.jsx('button', { type: 'button', 'data-nai-roll-apply-action': 'undo-roll', onClick: onUndoRoll, className: 'nai-preset-secondary', children: '撤销上一次 Roll 填入' }) : null,
        e.jsx('button', { type: 'button', 'data-nai-roll-apply-action': 'cancel', onClick: onCancel, className: 'nai-preset-secondary', children: '取消（不写入、不创建角色）' }),
        e.jsx('button', { type: 'button', 'data-nai-roll-apply-action': 'confirm', disabled: !!state.busy || !writes.length || targetMode === 'none', onClick: () => onConfirm(false), className: 'nai-preset-primary', children: state.busy ? '写入中…' : confirmLabel })
      ] })
    ] }) });
};
/* __NAI_ROLL_PANEL_END__ */

/* =====================================================================
 * 一键 Roll · 撤销横幅（应用之后常驻可见，一次撤销覆盖本次全部范围）
 * ===================================================================== */
/* __NAI_ROLL_BANNER_BEGIN__ */
const __NaiRollUndoBanner = ({ info, warn, onUndo, onForce, onDismiss }) => {
  if (!info) return null;
  return e.jsxs('div', {
    'data-nai-roll-undo-banner': 'true',
    'data-nai-roll-undo-warn': warn ? 'true' : 'false',
    className: 'nai-preset-warn',
    style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
    children: [
      e.jsx('span', { 'data-nai-roll-undo-label': 'true', children: '已填入 Roll 组合：' + String(info.label || '') + '（' + String((info.points || []).length) + ' 个范围，可一次撤销）' }),
      warn ? e.jsx('span', { 'data-nai-roll-undo-conflict': 'true', children: '撤销会覆盖你在填入之后的手动修改：' + String(warn) }) : null,
      warn
        ? e.jsx('button', { type: 'button', 'data-nai-roll-undo-action': 'force', className: 'nai-preset-btn', onClick: onForce, children: '仍然撤销（含这些手改）' })
        : e.jsx('button', { type: 'button', 'data-nai-roll-undo-action': 'undo', className: 'nai-preset-btn', onClick: onUndo, children: '撤销本次 Roll 填入' }),
      e.jsx('button', { type: 'button', 'data-nai-roll-undo-action': 'dismiss', className: 'nai-preset-secondary', onClick: onDismiss, children: '不再提示' })
    ]
  });
};
/* __NAI_ROLL_BANNER_END__ */

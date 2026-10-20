/* =====================================================================
 * 一键 Roll · 「Roll 内容库」载入（注入 ChainEditor 主组件 au 的组件体）
 * ---------------------------------------------------------------------
 * 需求要点：
 *   · 与「一键 Roll 填入」共用同一个确认面板与同一套应用引擎（一次提交 + 一次撤销）；
 *   · **只用快照**：记录里保存的是完整内容副本，来源条目改名/改内容/删除都不改变已存内容；
 *   · 只碰六类内容与它们自己的负面/约束/备注：画师串、风格配套负面、用户手填全局负面、
 *     全部生图参数（模型/采样器/步数/CFG/尺寸/张数/seed）都不在计划里（不是「隐藏覆盖项」）；
 *   · 目标角色：真实角色 + 稳定 id，「没有可靠目标时要求选择」，记录没有角色类内容时不强制建角色；
 *   · 全程只改当前创作状态：不自动保存实验室、不开始生图、不复制整份 snapshot.params。
 * 入口：实验室工具栏 / 画师与风格行 / 工作区「Roll 内容库」页（经 pending-import）。
 * ===================================================================== */
/* __NAI_ROLL_CONTENT_BEGIN__ */
const __naiRollLibraryList = () => (Array.isArray(n) ? n : []).filter(c => __naiRollCore.isContentRecord(c));
const __naiRollContentPickedOf = (read, kind) => {
  /* 快照 → 面板用的「picks」行（保留来源快照，供面板显示与落盘记账） */
  const role = (read.roles && read.roles[0]) || null;
  if (role && __naiRollCore.ROLE_KEYS.indexOf(kind) >= 0) {
    if (!role.provided[kind]) return null;
    return {
      kind, entryId: String((role.meta[kind] && role.meta[kind].entryId) || ''),
      name: String((role.meta[kind] && role.meta[kind].entryName) || (role.name + ' 的' + __naiRollCore.META[kind].title)),
      text: String(role.sections[kind] || ''),
      negative: String((role.negatives[kind] && role.negatives[kind].text) || ''),
      negativeNotes: String((role.negatives[kind] && role.negatives[kind].note) || ''),
      meta: role.meta[kind] || null,
      updatedAt: (role.meta[kind] && Number(role.meta[kind].entryUpdatedAt)) || null,
      provided: true, fromSnapshot: true
    };
  }
  const g = read.global && read.global[kind];
  if (!g || !g.provided) return null;
  return {
    kind, entryId: String((g.meta && g.meta.entryId) || ''),
    name: String((g.meta && g.meta.entryName) || __naiRollCore.META[kind].title),
    text: String(g.text || ''),
    negative: String((g.negative && g.negative.text) || ''),
    negativeNotes: String((g.negative && g.negative.note) || ''),
    meta: g.meta || null,
    updatedAt: (g.meta && Number(g.meta.entryUpdatedAt)) || null,
    provided: true, fromSnapshot: true
  };
};
/* 打开「载入 Roll 内容」确认面板：与一键 Roll 共用面板，但 mode='library'、无风格块、只用快照 */
const __naiRollOpenContentLoad = record => {
  const read = __naiRollCore.contentOfChain(record);
  if (!read.ok) {
    h('这条记录不能按纯内容载入：' + String((read.warnings && read.warnings[0]) || read.reason || '未知原因'), 'error');
    return;
  }
  const picks = {};
  for (const kind of __naiRollCore.KINDS) {
    const row = __naiRollContentPickedOf(read, kind);
    if (row) picks[kind] = row;
  }
  const checks = {};
  for (const kind of __naiRollCore.KINDS) checks[kind] = !!picks[kind];
  __naiRollOpen({
    mode: 'library',
    recordId: String(record.id || ''),
    recordName: String(record.name || ''),
    fromLibrary: true,
    seed: read.roll ? String(read.roll.seed || '') : '',
    picks,
    checks,
    warnings: read.warnings || [],
    note: '这条记录只提供六类内容与其自身约束；画师风格、风格配套负面、你手填的全局负面、模型与全部生图参数都保持当前配置。'
  });
};
/* 选择器：列出所有纯内容记录（供实验室工具栏 / 画师与风格行 / 工作区页使用） */
const [__naiRollPickList, __naiSetRollPickList] = l.useState(null);
const __naiRollOpenPicker = () => {
  const list = __naiRollLibraryList().map(c => {
    const read = __naiRollCore.contentOfChain(c);
    const scope = __naiRollCore.contentScopeOf(read);
    return { id: String(c.id), name: String(c.name || '（未命名）'), note: String(c.description || ''), tags: Array.isArray(c.tags) ? c.tags : [], updatedAt: Number(c.updatedAt) || 0, ok: read.ok, scope: scope.label, warnings: read.warnings || [] };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
  __naiSetRollPickList({ list, err: '' });
};
const __naiRollPickerUI = () => {
  if (!__naiRollPickList) return null;
  const list = __naiRollPickList.list || [];
  const pick = item => { __naiSetRollPickList(null); __naiRollOpenContentLoad(__naiRollLibraryList().find(c => String(c.id) === String(item.id)) || null); };
  return e.jsx('div', { className: 'nai-preset-overlay', children:
    e.jsxs('div', { className: 'nai-preset-card', 'data-nai-rolllib-picker': 'true', children: [
      e.jsxs('div', { className: 'nai-preset-head', children: [
        e.jsx('span', { className: 'nai-preset-badge', children: 'Roll 内容库' }),
        e.jsxs('div', { style: { flex: '1 1 auto', minWidth: 0 }, children: [
          e.jsx('p', { className: 'nai-preset-title', children: '选择一份内容搭配' }),
          e.jsx('p', { className: 'nai-preset-sub', children: '只提供六类内容；画师风格、生图参数与风格负面保持当前配置' })
        ] }),
        e.jsx('button', { type: 'button', 'data-nai-rolllib-action': 'dismiss', onClick: () => __naiSetRollPickList(null), className: 'nai-preset-close', 'aria-label': '关闭', children: '×' })
      ] }),
      e.jsx('div', { className: 'nai-preset-body', children:
        e.jsx('div', { 'data-nai-rolllib-list': 'true', className: 'nai-preset-list', children: list.length
          ? list.map(item => e.jsxs('button', {
            type: 'button', key: item.id, 'data-nai-rolllib-item': item.id, disabled: !item.ok,
            onClick: () => pick(item), className: 'nai-preset-list-item', title: item.name,
            children: [
              e.jsx('span', { 'data-nai-rolllib-item-name': 'true', className: 'nai-preset-item-name', children: item.name }),
              e.jsx('span', { className: 'nai-preset-item-meta', children: item.ok ? (item.scope || '（无内容）') : '（这条记录不可按纯内容载入）' }),
              item.note ? e.jsx('span', { className: 'nai-preset-item-meta', children: item.note.slice(0, 60) }) : null
            ]
          }, item.id))
          : e.jsx('p', { 'data-nai-rolllib-empty': 'true', className: 'nai-preset-note', children: '还没有 Roll 内容记录：在一键 Roll 里点「存为 Roll 内容」即可创建。' })
        })
      })
    ] })
  });
};
/* 模型能力提示：角色上限不够时如实说明，不自动换模型、不静默截断（需求 §8.3 / C13） */
const __naiRollModelNote = () => {
  try {
    const cap = ee && typeof ee.maxCharacters === 'number' ? ee.maxCharacters : null;
    if (cap === null) return { text: '当前模型未声明独立角色段能力：角色四类可能不能单独发送，这一点按既有请求预览为准。', ok: true };
    if (cap <= 0) return { text: '当前模型不支持独立角色段：角色四类不会作为独立段发送（不会自动换模型，也不会改参数）。', ok: false };
    return { text: '当前模型最多 ' + String(cap) + ' 个角色段；本次只写 1 个角色，未超限。', ok: true };
  } catch (_e) {
    return { text: '', ok: true };
  }
};
/* __NAI_ROLL_CONTENT_END__ */

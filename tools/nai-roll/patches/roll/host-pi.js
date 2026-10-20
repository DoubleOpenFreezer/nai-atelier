/* =====================================================================
 * 一键 Roll · 宿主登记（注入 Pi 组件体：角色分区面板）
 * ---------------------------------------------------------------------
 * 角色四栏的写入走既有口径：`characters[i].sections[k]` +
 * `_characterSectionsMeta["id::k"]` + `_characterSectionsNegatives["id::k"]`
 * （与 `__naiApplySec` 完全同一形状），并且：
 *   · **必须用函数式更新** `n(T=>…T)`：同一 tick 里全局栏也刚写过 `params`，
 *     用 `n({...t,…})` 展开旧 props 会把刚写进去的 `_promptSections` 一起抹掉
 *     （这就是「一次状态变更、不出现半套更新」的实质要求，之前实测踩过）；
 *   · 只动被选中的那个角色；
 *   · 「新建角色」与写入在**同一个**状态更新里完成（否则第二次写会读到还没更新的角色列表）；
 *   · 撤销「新建角色」用 removePlan，把角色连同 sections 一起移除。
 * 登记方式：渲染期赋值、不用 hook（原因见 host-tu.js 顶部说明）。
 * ===================================================================== */
/* __NAI_ROLL_HOST_PI_BEGIN__ */
if (typeof RH === 'function') RH({
  kind: 'character',
  readSection: (charId, key) => __naiSecOf((t.characters || []).find(c => __naiId(c) === String(charId)), key),
  readNeg: (charId, key) => charSectionNegativeOf(charId, key),
  applyPlan: (charId, planRows, createNew) => {
    const rows = Array.isArray(planRows) ? planRows : [];
    if (!rows.length) return { ok: false, reason: 'empty_plan' };
    let id = String(charId || '');
    const created = !!createNew || !id;
    if (created) id = String(ri());
    n(prev => {
      const list = Array.isArray(prev.characters) ? prev.characters.slice() : [];
      let idx = list.findIndex(c => __naiId(c) === id);
      if (idx < 0) {
        if (!created) return prev;
        list.push({ id, prompt: '', x: .5, y: .5, sections: {} });
        idx = list.length - 1;
      }
      const sections = { ...(list[idx].sections || {}) };
      const cmeta = { ...(prev._characterSectionsMeta || {}) };
      const cneg = { ...(prev._characterSectionsNegatives || {}) };
      for (const row of rows) {
        const k = String(row.key || '');
        const val = String(row.text == null ? '' : row.text);
        sections[k] = val;
        const mk = __naiMetaKey(id, k);
        if (row.meta) cmeta[mk] = { ...row.meta, appliedText: val };
        else delete cmeta[mk];
        if (row.negative || row.negativeNotes) {
          cneg[mk] = {
            text: String(row.negative || ''),
            note: String(row.negativeNotes || ''),
            source: String(row.negativeSource || ''),
            mode: 'replace',
            appliedAt: Date.now()
          };
        } else delete cneg[mk];
      }
      list[idx] = { ...list[idx], sections };
      return { ...prev, characters: list, _characterSectionsMeta: cmeta, _characterSectionsNegatives: cneg };
    });
    if (h) h();
    return { ok: true, characterId: id, created, wrote: rows.map(r => String(r.key || '')) };
  },
  /* 撤销「新建角色」用：把整个角色连同它的 sections 一起移除（只对本次 Roll 建的角色用） */
  removePlan: charId => {
    const id = String(charId || '');
    if (!id) return { ok: false, reason: 'unknown_target' };
    n(prev => {
      const list = Array.isArray(prev.characters) ? prev.characters : [];
      if (!list.some(c => __naiId(c) === id)) return prev;
      return { ...prev, characters: list.filter(c => __naiId(c) !== id) };
    });
    if (h) h();
    return { ok: true };
  }
});
/* __NAI_ROLL_HOST_PI_END__ */

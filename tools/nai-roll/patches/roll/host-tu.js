/* =====================================================================
 * 一键 Roll · 宿主登记（注入 tu 组件体：全局分区面板）
 * ---------------------------------------------------------------------
 * 为什么不是「宿主自己重写一遍」：全局两栏的写入要跟着既有的三个口径走 ——
 *   ① 旧版第六栏 extra 并入 scene（`nextSectionsFor`）；
 *   ② 主体提示词（supplement）要按 `subjectWithSections` 同步，否则被替换掉的旧文
 *      会以「未被栏位覆盖的片段」继续留在请求里（P0「不出现半套更新」要修的正是这个）；
 *   ③ 负面按「本栏自己的槽位」整栏替换，不动全局负面、不动其它栏。
 * 这三条只在 tu 的作用域里现成存在，所以把「整套计划一次提交」的能力**登记**给宿主，
 * 由宿主组计划、由 tu 落盘 —— 一次 `commitSections` = 一次状态变更（含主体同步）。
 *
 * 登记方式：**不用 hook**。这里无法保证 hook 一定落在组件体最外层（加 hook 会触发
 * React「Invalid hook call」#321），所以改成渲染期直接把这个能力对象交给宿主 ——
 * 与既有 `__naiPresetApi` 在渲染期构造并交给工具栏是同一类做法，幂等、无副作用。
 * ===================================================================== */
/* __NAI_ROLL_HOST_TU_BEGIN__ */
if (typeof RH === 'function') RH({
  kind: 'global',
  readSection: k => String(effectiveSectionText(k) || ''),
  readNeg: k => sectionNegativeOf(k),
  readMeta: k => sectionMetaOf(k),
  applyPlan: planRows => {
    const list = Array.isArray(planRows) ? planRows : [];
    if (!list.length) return { ok: false, reason: 'empty_plan' };
    const next = { ...sections, scene: effectiveSceneText() };
    const metaNext = { ...(SM || {}) };
    const negNext = { ...(SN || {}) };
    for (const row of list) {
      const k = String(row.key || '');
      const val = String(row.text == null ? '' : row.text);
      next[k] = val;
      if (row.meta) metaNext[k] = { ...row.meta, appliedText: val };
      else delete metaNext[k];
      if (row.negative || row.negativeNotes) {
        negNext[k] = {
          text: String(row.negative || ''),
          note: String(row.negativeNotes || ''),
          source: String(row.negativeSource || ''),
          mode: 'replace',
          appliedAt: Date.now()
        };
      } else delete negNext[k];
    }
    commitSections(next, metaNext, negNext);
    return { ok: true, wrote: list.map(r => String(r.key)) };
  }
});
/* __NAI_ROLL_HOST_TU_END__ */

/* =====================================================================
 * 一键 Roll · 落盘入口（注入 ChainEditor 的 pending-import 处理器 Yi）
 * ---------------------------------------------------------------------
 * 只做分派，不直接写任何字段：
 *   · `roll-apply`        → 一键 Roll 的「填入实验室」：打开确认面板（目标角色 / 逐栏替换或保留 / 一次撤销）
 *   · `roll-content-load` → 「Roll 内容库」的「载入内容」：同一套确认面板与引擎，但**只用记录里的快照**，
 *                           且画师风格、风格配套负面、用户全局负面与全部生图参数都不在计划里。
 * 具体实现在 host-au.js / content-load.js（同组件作用域）。
 * ===================================================================== */
/* __NAI_ROLL_APPLY_BEGIN__ */
  if(a.mode==="roll-apply"){
    try{ __naiRollOpen(a); }
    catch(__e){ h("一键 Roll：打开确认面板失败："+String((__e&&__e.message)||__e),"error"); }
    return;
  }
  if(a.mode==="roll-content-load"){
    try{
      const __rec=(Array.isArray(n)?n:[]).find(c=>String((c&&c.id)||"")===String(a.recordId||""));
      if(!__rec)h("Roll 内容库：找不到这条记录（可能已被删除）","error");
      else __naiRollOpenContentLoad(__rec);
    }catch(__e){ h("Roll 内容库：打开载入面板失败："+String((__e&&__e.message)||__e),"error"); }
    return;
  }
/* __NAI_ROLL_APPLY_END__ */

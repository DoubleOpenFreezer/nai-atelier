/*
 * §五 走查辅助：在隔离实例上打开实验室编辑器 / 打开某个分类面板。
 * 全部是只读交互（不点保存），写入只在 w3 里显式发生。
 */
import { sleep } from './cdp.mjs';
import { CLICK } from './walk.mjs';

/** 入口看板 tab：条目属于哪个库就先用哪个 tab。 */
const TAB_BY_TYPE = { style: '风格串', character: '角色库', wardrobe: '实验室', appearance: '实验室', pose: '实验室', scene: '实验室' };

export async function gotoLab(c, opts = {}) {
  await c.goto(opts.url);
  await sleep(opts.wait || 10000);
}

/** 打开实验室编辑器。返回 {ok, tab, tries, detail} —— tries 就是走查要记录的「找入口点击数」。 */
export async function openLabEditor(c, { name, type, tabs, tries = 4 } = {}) {
  const order = tabs || [TAB_BY_TYPE[type] || '风格串', '风格串', '实验室', '角色库'];
  let attempts = 0;
  const detail = [];
  for (let a = 0; a < tries; a++) {
    for (const tab of order) {
      attempts += 1;
      const hit = await c.eval(CLICK(`[...document.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(tab)})`));
      await sleep(2200);
      const visible = await c.eval(`document.body.innerText.includes(${JSON.stringify(name)})`);
      detail.push({ tab, hit: !!(hit && hit.ok), visible });
      if (!visible) continue;
      const clicked = await c.eval(`(()=>{const cand=[...document.querySelectorAll('div,article,li')].filter(e=>{const t=(e.innerText||'').replace(/\\s+/g,' ');return t.includes(${JSON.stringify(name)})&&t.length<520;});const el=cand[cand.length-1];if(!el)return{ok:false,n:cand.length};el.click();return{ok:true};})()`);
      if (clicked && clicked.ok) {
        for (let j = 0; j < 26; j++) {
          if (await c.eval(`!!document.querySelector('.chain-editor-workspace')`)) { await sleep(1200); return { ok: true, tab, attempts, detail }; }
          await sleep(500);
        }
      }
      await sleep(800);
    }
  }
  return { ok: false, attempts, detail };
}

/** 顶层分类导航（全局 / 角色 / 参数）。 */
export async function switchSection(c, label) {
  await c.eval(CLICK(`[...document.querySelectorAll('.chain-editor-workspace button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(label)})`));
  await sleep(1400);
}

/** 切到某个角色标签页（0 基）。 */
export async function switchCharacter(c, index) {
  const r = await c.eval(`(()=>{const tabs=[...document.querySelectorAll('[data-nai-char-tabs] [role="tab"], [data-nai-char-tabs] button')].filter(b=>!/新增角色/.test(b.innerText||''));const t=tabs[${index}];if(!t)return{ok:false,n:tabs.length};const r=t.getBoundingClientRect();const o={bubbles:true,cancelable:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2};for(const e of ['pointerdown','mousedown','pointerup','mouseup','click'])t.dispatchEvent(new MouseEvent(e,o));return{ok:true,label:(t.innerText||'').replace(/\\s+/g,' ').trim().slice(0,30)};})()`);
  await sleep(1400);
  return r;
}

/** 所有「选择 / 修改」触发器的 aria-label 列表。 */
export async function rowTriggers(c) {
  return c.eval(`[...document.querySelectorAll('.chain-editor-workspace button[aria-label^="选择 / 修改"]')].map((b,i)=>({i,aria:b.getAttribute('aria-label'),kind:(b.dataset||{}).plpKind||''}))`);
}

/** 点开某一行（aria 里含 given 子串）的「选择 / 修改」。 */
export async function openRow(c, contains, { tries = 1 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await c.eval(CLICK(`[...document.querySelectorAll('.chain-editor-workspace button[aria-label^="选择 / 修改"]')].find(b=>(b.getAttribute('aria-label')||'').includes(${JSON.stringify(contains)}))`));
    if (r && r.ok) { await sleep(2200); return r; }
    await sleep(900);
  }
  return { ok: false };
}

/** 关闭面板（× 或 Esc；有草稿时会弹确认）。 */
export async function closePanel(c, { acceptDiscard = true } = {}) {
  await c.eval(`(()=>{const d=document.querySelector('[role="dialog"]');if(!d)return false;const b=[...d.querySelectorAll('button')].find(x=>(x.innerText||'').trim()==='×'||/close/i.test(x.getAttribute('aria-label')||''));if(b){b.click();return true}document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;})()`);
  await sleep(800);
  const dlg = await c.eval(`(()=>{const a=document.querySelector('[role="alertdialog"]');if(!a)return null;const btns=[...a.querySelectorAll('button')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim());return {title:((a.querySelector('h2')||{innerText:''}).innerText||'').replace(/\\s+/g,' ').trim(),btns};})()`);
  if (dlg) {
    const want = acceptDiscard ? /放弃|丢弃|关闭|确定|确认/ : /继续编辑|取消/;
    const label = dlg.btns.find(t => want.test(t)) || dlg.btns[0];
    await c.eval(CLICK(`(()=>{const a=document.querySelector('[role="alertdialog"]');return [...a.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(label)});})()`));
    await sleep(900);
    return { ok: true, dialog: dlg, clicked: label };
  }
  return { ok: true, dialog: null };
}

/** 面板是否还开着。 */
export const panelOpen = c => c.eval(`!!document.querySelector('[role="dialog"]')`);

/** 当前编辑器里每个分类行的可读摘要（「查看结果配置」用）。 */
export async function summaryRows(c) {
  return c.eval(`[...document.querySelectorAll('[data-nai-summary-row]')].map(r=>({key:r.getAttribute('data-nai-summary-row'),empty:r.hasAttribute('data-nai-summary-empty'),stale:r.hasAttribute('data-nai-summary-stale'),text:(r.innerText||'').replace(/\\s+/g,' ').trim().slice(0,180)}))`);
}

/** 角色标签页 + 每个角色的四段摘要。 */
export async function characterPanel(c) {
  return c.eval(`(()=>{
    const tabs=[...document.querySelectorAll('[data-nai-char-tabs] [role="tab"],[data-nai-char-tabs] button')].map(b=>({t:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24),sel:b.getAttribute('aria-selected')||'',cls:String(b.className).slice(0,80)}));
    const rows=[...document.querySelectorAll('[data-nai-summary-row]')].map(r=>({key:r.getAttribute('data-nai-summary-row'),text:(r.innerText||'').replace(/\\s+/g,' ').trim().slice(0,140)}));
    return {tabs,rows};})()`);
}

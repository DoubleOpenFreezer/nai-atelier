/*
 * §五 走查辅助状态机（被 w1/w2/w3/w4 复用）。
 * 目标：用真实鼠标事件走界面，同时**如实记录**每一次点击、面板开关次数、
 * 找不到入口的次数、耗时与横向滚动 —— 这些就是改进建议的证据。
 */
import { sleep } from './cdp.mjs';

export function makeRecorder(c) {
  const rec = {
    clicks: [], // { seq, label, ok, ms }
    missing: [], // 找不到入口的记录
    panelOpens: 0,
    panelCloses: 0,
    seq: 0,
  };
  rec.t = () => Date.now();
  return rec;
}

export const CLICK = f => `(()=>{const el=${f};if(!el)return{ok:false};const r=el.getBoundingClientRect();const o={bubbles:true,cancelable:true,view:window,clientX:r.left+r.width/2,clientY:r.top+r.height/2};for(const t of ['pointerdown','mousedown','pointerup','mouseup','click'])el.dispatchEvent(new MouseEvent(t,o));return{ok:true,text:(el.innerText||'').replace(/\\s+/g,' ').trim().slice(0,50)};})()`;

export const SET_INPUT = (sel, val) => `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return{ok:false};const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,'value').set;setter.call(el,${JSON.stringify(val)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true,value:el.value};})()`;

/** 按 aria-label 精确点击（返回是否找到）。 */
export async function clickAria(c, rec, aria, { note = '', wait = 700 } = {}) {
  const t0 = Date.now();
  const r = await c.eval(CLICK(`document.querySelector('[aria-label=${JSON.stringify(aria)}]')`));
  const ms = Date.now() - t0;
  rec.seq += 1;
  if (!r || !r.ok) rec.missing.push({ seq: rec.seq, what: aria, note, at: new Date().toISOString() });
  rec.clicks.push({ seq: rec.seq, how: 'aria', target: aria, ok: !!(r && r.ok), ms, note });
  await sleep(wait);
  return !!(r && r.ok);
}

/** 按按钮文案精确匹配点击。 */
export async function clickText(c, rec, text, { note = '', wait = 700, scope = 'body' } = {}) {
  const t0 = Date.now();
  const sel = scope === 'dialog' ? '[role="dialog"] button' : 'button';
  const r = await c.eval(CLICK(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(text)})`));
  const ms = Date.now() - t0;
  rec.seq += 1;
  if (!r || !r.ok) rec.missing.push({ seq: rec.seq, what: `button:${text}`, note, at: new Date().toISOString() });
  rec.clicks.push({ seq: rec.seq, how: 'text', target: text, ok: !!(r && r.ok), ms, note });
  await sleep(wait);
  return !!(r && r.ok);
}

/** 按 CSS 选择器点击。 */
export async function clickSel(c, rec, sel, { note = '', wait = 700 } = {}) {
  const t0 = Date.now();
  const r = await c.eval(CLICK(`document.querySelector(${JSON.stringify(sel)})`));
  const ms = Date.now() - t0;
  rec.seq += 1;
  if (!r || !r.ok) rec.missing.push({ seq: rec.seq, what: `sel:${sel}`, note, at: new Date().toISOString() });
  rec.clicks.push({ seq: rec.seq, how: 'sel', target: sel, ok: !!(r && r.ok), ms, note });
  await sleep(wait);
  return !!(r && r.ok);
}

/** 面板当前状态快照（走查用，不依赖截图）。 */
export async function panelState(c) {
  return c.eval(`(()=>{
    const d=document.querySelector('[role="dialog"]');
    const box=document.querySelector('[data-plp-preview]');
    const title=(d&&(d.querySelector('h2,h3')||{innerText:''}).innerText||'').replace(/\\s+/g,' ').trim();
    const paneEl=[...document.querySelectorAll('[data-plp-pane][aria-selected="true"],[data-plp-pane][data-state="active"]')].map(e=>e.getAttribute('data-plp-pane'));
    const panes=[...document.querySelectorAll('[data-plp-pane]')].map(e=>e.getAttribute('data-plp-pane'));
    const actions=d?[...d.querySelectorAll('button')].map(b=>({t:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,30),dis:b.disabled})):[];
    const rows=[...document.querySelectorAll('[data-plp-preview] > *')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()).filter(Boolean);
    return {open:!!d,title,paneEl,panes,actions,previewRows:rows,
      previewText:box?(box.innerText||'').replace(/\\s+/g,' ').trim().slice(0,600):null,
      hasPreview:!!box};})()`);
}

/** 目标行是否存在 & 文案（回答「当前角色与类别是否始终清楚」）。 */
export async function targetClarity(c) {
  return c.eval(`(()=>{
    const d=document.querySelector('[role="dialog"]');
    if(!d)return {open:false};
    const txt=(d.innerText||'').replace(/\\s+/g,' ');
    const m=txt.match(/应用到[^。]{0,80}/);
    return {open:true,applied:m?m[0]:null,head:txt.slice(0,160)};})()`);
}

/** 当前角色标签页状态。 */
export async function charTabState(c) {
  return c.eval(`(()=>{
    const tabs=[...document.querySelectorAll('[data-nai-char-tabs] [role="tab"], [data-nai-char-tabs] button')].map(b=>({t:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24),sel:b.getAttribute('aria-selected')||b.getAttribute('aria-current')||'',cls:String(b.className).slice(0,60)}));
    const active=[...document.querySelectorAll('[data-nai-char-tabs] [aria-selected="true"],[data-nai-char-tabs] [data-state="active"]')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24));
    return {tabs,active};})()`);
}

/** 横向滚动检测（420px 窄屏）。 */
export async function overflowState(c) {
  return c.eval(`(()=>({docScrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,overflowX:document.documentElement.scrollWidth>window.innerWidth+1,offenders:[...document.querySelectorAll('.chain-editor-workspace *')].map(e=>({cls:String(e.className||'').slice(0,70),sw:e.scrollWidth,cw:e.clientWidth})).filter(x=>x.sw>x.cw+2&&x.cw>0).slice(0,6)}))()`);
}

export async function setViewport(c, width, height) {
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
}
export async function clearViewport(c) {
  await c.send('Emulation.clearDeviceMetricsOverride');
}

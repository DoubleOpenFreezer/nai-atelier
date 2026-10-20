/*
 * 一键 Roll · 布局几何核对（不能靠肉眼看截图时，用 DOM 读数代替「看一眼」）
 *
 *   node nai-atelier-testenv/tests/roll-layout-check.mjs 3055
 *
 * 检查：桌面 1500px 与窄屏 390px 两档下
 *   · 页面没有横向溢出（scrollWidth <= innerWidth + 1）
 *   · 六行结果 / 三个动作按钮 / 勾选 chips / 证据块 都不越出视口左右边界，也没有互相重叠
 *   · 关键文案确实渲染出来了（标题、勾选、计划说明）
 */
import path from 'node:path';
import { runDir, dump, assertTestTarget } from '../lib/env.mjs';
import { launch, sleep } from '../lib/cdp.mjs';
import { CLICK } from '../lib/walk.mjs';

const BASE = 'http://127.0.0.1:' + (process.argv[2] || '3055');
assertTestTarget(BASE);
const dir = runDir('roll-layout');
const results = [];
let failed = 0;
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};

const measure = () => `(()=>{
  const vw = window.innerWidth;
  const rects = sel => [...document.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),t:Math.round(r.top),b:Math.round(r.bottom),text:(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24)};});
  const rows = rects('[data-nai-roll-row]');
  const acts = rects('[data-nai-roll-action]');
  const chips = rects('[data-nai-roll-check-label]');
  const out = {vw, scrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, rows, acts, chips,
    headings: [...document.querySelectorAll('[data-nai-roll] h2, [data-nai-roll] h3')].map(e=>e.innerText.trim()),
    plan: (document.querySelector('[data-nai-roll-plan]')||{innerText:''}).innerText.replace(/\\s+/g,' ').trim().slice(0,60)};
  const overlaps = (list, axis) => { for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++){
    const a=list[i], b=list[j];
    if(a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b) return [i,j,a.text,b.text]; } return null; };
  out.rowOverlap = overlaps(rows);
  out.actOverlap = overlaps(acts);
  out.chipOverlap = overlaps(chips);
  out.outOfView = [...rows,...acts,...chips].filter(x=>x.l < -1 || x.r > vw + 1).map(x=>x.text);
  return out;
})()`;

const c = await launch({ port: 9731, profile: '.chrome-roll-layout', width: 1500, height: 1100, url: BASE });
let evidence = {};
try {
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 90000, label: '应用启动' });
  await sleep(2500);
  await c.eval(CLICK(`[...document.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()==='一键 Roll')`));
  await sleep(1500);
  await c.eval(CLICK(`document.querySelector('[data-nai-roll-action="roll"]')`));
  await sleep(1500);

  for (const [label, width, height, mobile] of [['桌面 1500', 1500, 1100, false], ['窄屏 390', 390, 844, true]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await sleep(1600);
    const m = await c.eval(measure());
    evidence[label] = m;
    check(`${label}：页面没有横向溢出`, m.scrollW <= m.vw + 1, { vw: m.vw, scrollW: m.scrollW });
    check(`${label}：六行结果都在视口内且互不重叠`, m.rows.length === 6 && !m.rowOverlap && m.outOfView.length === 0, { rows: m.rows.length, overlap: m.rowOverlap, out: m.outOfView });
    check(`${label}：三个动作按钮都在视口内且互不重叠`, m.acts.length >= 5 && !m.actOverlap, { acts: m.acts.map(a => a.text), overlap: m.actOverlap });
    check(`${label}：六个勾选 chips 都在视口内且互不重叠`, m.chips.length === 6 && !m.chipOverlap, { chips: m.chips.length, overlap: m.chipOverlap });
    check(`${label}：关键文案渲染出来（标题 / 三段标题 / 计划说明）`,
      m.headings.length >= 4 && /只写入本次抽中且有内容的/.test(m.plan), { headings: m.headings, plan: m.plan });
    await c.screenshot(path.join(dir, label.replace(/\s+/g, '-') + '.png'));
  }
  await c.send('Emulation.clearDeviceMetricsOverride');
} catch (e) {
  check('布局核对脚本执行完成（无异常中断）', false, String((e && e.stack) || e));
} finally {
  try { await c.close(); } catch (_e) { /* ignore */ }
}

dump(dir, 'roll-layout.json', { at: new Date().toISOString(), base: BASE, total: results.length, failed, evidence, results });
console.log(`\n=== 一键 Roll 布局几何：${results.length - failed}/${results.length} 通过（失败 ${failed}）`);
console.log('原始输出：' + path.join(dir, 'roll-layout.json'));
process.exit(failed ? 1 : 0);

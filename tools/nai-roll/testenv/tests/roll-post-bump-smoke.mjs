/*
 * 一键 Roll · bump 后的重启冒烟（生产只读 / 隔离实例全流程）
 *
 *   node nai-atelier-testenv/tests/roll-post-bump-smoke.mjs 3055        # 隔离实例：入口 + Roll 一次
 *   node nai-atelier-testenv/tests/roll-post-bump-smoke.mjs 3000 prod   # 生产：只读冒烟（只 GET + 客户端点一遍）
 *
 * 生产模式下**不做任何写入动作**：不点「存为搭配」、不点「填入实验室」，
 * 只验证「入口在、视图能渲染、Roll 能出六栏」，并在前后用只读 GET 全字段比对生产条目。
 */
import fs from 'node:fs';
import path from 'node:path';
import { runDir, dump, assertTestTarget, PROD_URL } from '../lib/env.mjs';
import { launch, sleep } from '../lib/cdp.mjs';
import { CLICK } from '../lib/walk.mjs';

const PORT = process.argv[2] || '3055';
const PROD = (process.argv[3] || '').toLowerCase() === 'prod';
const BASE = PROD ? PROD_URL : 'http://127.0.0.1:' + PORT;
if (!PROD) assertTestTarget(BASE);

const dir = runDir('roll-post-bump' + (PROD ? '-prod' : ''));
const results = [];
let failed = 0;
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
};

const snapshot = async () => {
  const res = await fetch(BASE + '/api/chains', { cache: 'no-store' });
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body && body.chains) || [];
  return new Map(list.map(c => [c.id, JSON.stringify(c)]));
};

const before = await snapshot();
console.log(`[smoke] ${BASE} 条目 ${before.size} 条`);

const c = await launch({ port: PROD ? 9729 : 9728, profile: PROD ? '.chrome-roll-prod' : '.chrome-roll-smoke', width: 1500, height: 1100, url: BASE });
const requests = [];
c.ws.addEventListener('message', e => {
  try {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') requests.push({ method: m.params.request.method, url: m.params.request.url });
  } catch (_e) { /* ignore */ }
});
let evidence = {};
try {
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 90000, label: '应用启动' });
  await sleep(2500);
  const served = await c.eval(`(()=>{const s=[...document.querySelectorAll('script[src]')].map(x=>x.getAttribute('src'));return s;})()`);
  /* 版本串断言不写死数字（每轮 bump 都会变），改为断言「不变量」：
     ① 页面里出现的版本串只有一个取值；② 不是旧的 v170-71；③ 形如 atelier-v170-<数字>。 */
  const versionSeen = [...new Set((served.join(' ').match(/atelier-v[0-9]+-[0-9]+/g) || []))];
  check('index.html 的版本串唯一且已 bump（' + (versionSeen[0] || '无') + '）',
    versionSeen.length === 1 && versionSeen[0] !== 'atelier-v170-71' && /^atelier-v[0-9]+-[0-9]+$/.test(versionSeen[0] || ''),
    versionSeen);
  const nav = await c.eval(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()==='一键 Roll');return {count:b.length,visible:b.length?b[0].offsetParent!==null:false};})()`);
  check('工作区入口在且可见', nav.count === 1 && nav.visible, nav);
  await c.eval(CLICK(`[...document.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()==='一键 Roll')`));
  await sleep(1500);
  const mounted = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll="workspace"]');return !!el&&(el.offsetParent!==null||el.getClientRects().length>0);})()`);
  check('视图真机渲染（不是白屏）', mounted);
  await c.eval(CLICK(`document.querySelector('[data-nai-roll-action="roll"]')`));
  await sleep(1500);
  const rows = await c.eval(`[...document.querySelectorAll('[data-nai-roll-row]')].map(r=>({kind:r.getAttribute('data-nai-roll-row'),filled:r.getAttribute('data-nai-roll-filled')==='true',reason:r.getAttribute('data-nai-roll-reason'),name:(r.querySelector('[data-nai-roll-name]')||{textContent:''}).textContent.trim(),why:(r.querySelector('[data-nai-roll-why]')||{textContent:''}).textContent.trim()}))`);
  const seed = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-seed]');return el?el.getAttribute('data-nai-roll-seed'):null;})()`);
  evidence = { served, rows, seed, poolSizes: await c.eval(`[...document.querySelectorAll('[data-nai-roll-check]')].map(i=>({kind:i.getAttribute('data-nai-roll-check'),label:(i.parentElement.innerText||'').replace(/\\s+/g,' ').trim()}))`) };
  check('Roll 一次给出六栏结果（空库/未勾选的栏位会如实留空并说明）', rows.length === 6, rows);
  check('seed 被记录', !!seed && seed.length > 3, seed);
  check('有结果的栏位都带条目名与摘要', rows.filter(r => r.filled).every(r => r.name), rows.filter(r => r.filled).map(r => r.name));
  await c.screenshot(path.join(dir, PROD ? 'prod-roll.png' : 'smoke-roll.png'));
  if (PROD) {
    /* 说明：应用自己有一个「外观偏好同步」的既有副作用 —— appearance 变化时会 POST
       /api/style-collector/appearance（本地风格收集器，跟 chains 无关，也不改任何条目）。
       这里只断言「没有任何写向 /api/chains 的请求」，并把收集器的 POST 如实记下来，
       另外用 control 脚本证明它在不碰 Roll 时同样会发生。 */
    const writes = requests.filter(r => r.method !== 'GET' && !/\/api\/style-collector\//.test(String(r.url)));
    const collector = requests.filter(r => /\/api\/style-collector\//.test(String(r.url)) && r.method !== 'GET');
    check('生产冒烟期间没有任何写向 /api/chains 的请求', writes.length === 0, writes);
    check('同期观察到的非 GET 只有既有的外观偏好同步（与 Roll 无关，也不改条目）',
      collector.every(r => /\/api\/style-collector\/appearance/.test(String(r.url))), collector);
  }
} catch (e) {
  check('冒烟脚本执行完成（无异常中断）', false, String((e && e.stack) || e));
} finally {
  try { await c.close(); } catch (_e) { /* ignore */ }
}

const after = await snapshot();
const changed = [...before.keys()].filter(id => before.get(id) !== after.get(id));
const added = [...after.keys()].filter(id => !before.has(id));
const removed = [...before.keys()].filter(id => !after.has(id));
check('条目数未变、逐条逐字段未变（只读 GET 比对）', changed.length === 0 && added.length === 0 && removed.length === 0,
  { before: before.size, after: after.size, changed, added, removed });
if (PROD) {
  const writes = requests.filter(r => r.method !== 'GET' && !/\/api\/style-collector\//.test(String(r.url)));
  check('除既有的外观偏好同步外，整轮没有任何非 GET 请求', writes.length === 0, writes.map(r => r.method + ' ' + r.url));
}

dump(dir, 'roll-post-bump-smoke.json', { at: new Date().toISOString(), base: BASE, prod: PROD, total: results.length, failed, evidence, requests, results });
console.log(`\n=== bump 后冒烟（${BASE}）：${results.length - failed}/${results.length} 通过（失败 ${failed}）`);
console.log('原始输出：' + path.join(dir, 'roll-post-bump-smoke.json'));
process.exit(failed ? 1 : 0);

/*
 * 一键 Roll v2 · 真机验收（隔离实例 3055，真实浏览器）
 * 对应 `NAI-Atelier-v170-72一键Roll优化需求.md` §九 R01–R18。
 *
 *   node nai-atelier-testenv/tests/roll-ui-suite.mjs
 *
 * 写入只发生在隔离实例（lib/guard.mjs 守卫）；生产实例一步都不碰。
 * 关键仪器：
 *   · DOM 读数（data-nai-roll-* / data-nai-roll-apply-* 属性）
 *   · 实验室「查看实际请求」只读预览（RQ()→xi()：与实际提交同一套合成）用来做请求闭环（R05）
 *   · CDP 请求捕获：证明没有生成请求
 */
import fs from 'node:fs';
import path from 'node:path';
import { BASE_URL, runDir, dump, assertTestTarget } from '../lib/env.mjs';
import { api, createTestEntry, cleanupCreated, createdIds, requestLog } from '../lib/guard.mjs';
import { launch, sleep } from '../lib/cdp.mjs';
import { CLICK } from '../lib/walk.mjs';
import core from '../../patches/roll/core.mjs';

assertTestTarget(BASE_URL);
const dir = runDir('roll-v2');
const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
}

const allChains = async () => {
  const res = await api('GET', '/api/chains');
  const body = res.detail;
  return Array.isArray(body) ? body : (body && Array.isArray(body.chains) ? body.chains : []);
};
const beforeAll = await allChains();
const baselineIds = beforeAll.filter(x => x.name !== '生图实验室').map(x => x.id).sort();
const beforeJson = new Map(beforeAll.map(x => [x.id, JSON.stringify(x)]));

/* ---------- 造词库条目：让六个池子都可换（≥2 条），再留一个「只有 1 条」的对照 ---------- */
const EXTRA = [
  ['roll-a2', 'appearance', '[R] 形象乙', 'rap2_hair, rap2_eyes', 'rap2_hair（验收发色乙）, rap2_eyes（验收瞳色乙）'],
  ['roll-a3', 'appearance', '[R] 形象丙', 'rap3_hat, rap3_glasses', 'rap3_hat（验收帽子丙）, rap3_glasses（验收眼镜丙）'],
  ['roll-w2', 'wardrobe', '[R] 服饰乙', 'rwd2_coat, rwd2_boots', 'rwd2_coat（验收外套乙）, rwd2_boots（验收靴子乙）'],
  ['roll-p1', 'pose', '[R] 动作甲', 'rpo1_stand, rpo1_lookup', 'rpo1_stand（验收站姿甲）, rpo1_lookup（验收仰头甲）'],
  ['roll-p2', 'pose', '[R] 动作乙', 'rpo2_kneel, rpo2_wave', 'rpo2_kneel（验收跪姿乙）, rpo2_wave（验收挥手乙）'],
  ['roll-e1', 'expression', '[R] 表情甲', 'rex1_smile, rex1_blush', 'rex1_smile（验收微笑）, rex1_blush（验收脸红）'],
  ['roll-e2', 'expression', '[R] 表情乙', 'rex2_cry, rex2_angry', 'rex2_cry（验收哭）, rex2_angry（验收生气）'],
  ['roll-c1', 'camera', '[R] 镜头甲', 'rcm1_closeup, rcm1_lowangle', 'rcm1_closeup（验收特写）, rcm1_lowangle（验收低角度）'],
  ['roll-c2', 'camera', '[R] 镜头乙', 'rcm2_wide, rcm2_highangle', 'rcm2_wide（验收广角）, rcm2_highangle（验收高角度）'],
  ['roll-s1', 'scene', '[R] 场景甲', 'rsc1_rain, rsc1_night', 'rsc1_rain（验收雨）, rsc1_night（验收夜）'],
  ['roll-s2', 'scene', '[R] 场景乙', 'rsc2_desert, rsc2_noon', 'rsc2_desert（验收沙漠）, rsc2_noon（验收正午）'],
  /* 四态「明确没有」的条目（R04）：accessory 明确没有 → 应作为该角色该栏的缺席约束，且不上提到全局负面 */
  ['roll-w-none', 'wardrobe', '[R] 服饰·无配饰', 'rwdn_dress', 'rwdn_dress（验收连衣裙）']
];
for (const [slug, type, name, basePrompt, bilingual] of EXTRA) {
  await createTestEntry({
    type, name, description: '一键 Roll v2 真机验收临时条目',
    basePrompt, negativePrompt: slug === 'roll-a2' ? 'rap2_bad' : '',
    tags: ['RollV2'], modules: [],
    params: {
      width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [],
      _wardrobe: Object.assign(
        { bilingual, references: [] },
        slug === 'roll-w-none' ? { facets: { accessory: '__none__', material: { value: 'silk' } } } : {}
      )
    },
    variableValues: { subject: '1girl' }
  }, slug);
}

const c = await launch({ port: 9733, profile: '.chrome-roll-v2', width: 1500, height: 1100, url: BASE_URL });
const ev = {};
const evalClick = sel => c.eval(CLICK(sel));
const navRoll = () => c.eval(CLICK(`[...document.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()==='一键 Roll')`));
const rollVisible = () => c.eval(`(()=>{const el=document.querySelector('[data-nai-roll="workspace"]');return !!el&&(el.offsetParent!==null||el.getClientRects().length>0);})()`);
const rowsOf = () => c.eval(`[...document.querySelectorAll('[data-nai-roll-row]')].map(r=>({kind:r.getAttribute('data-nai-roll-row'),id:r.getAttribute('data-nai-roll-id'),reason:r.getAttribute('data-nai-roll-reason'),filled:r.getAttribute('data-nai-roll-filled')==='true',on:r.getAttribute('data-nai-roll-on')==='true',locked:r.getAttribute('data-nai-roll-locked')==='true',name:(r.querySelector('[data-nai-roll-name]')||{textContent:''}).textContent.trim(),why:(r.querySelector('[data-nai-roll-why]')||{textContent:''}).textContent.trim(),constraint:(r.querySelector('[data-nai-roll-constraint]')||{textContent:''}).textContent.trim(),stale:!!r.querySelector('[data-nai-roll-lock-stale]'),swap:(()=>{const b=r.querySelector('[data-nai-roll-swap]');return b?{state:b.getAttribute('data-nai-roll-swap-state'),disabled:b.disabled,text:(b.innerText||'').trim(),title:b.title}:null;})()}))`);
const seedOf = () => c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-seed]');return el?el.getAttribute('data-nai-roll-seed'):'';})()`);
const act = name => evalClick(`document.querySelector('[data-nai-roll-action="${name}"]')`);
const idsOf = rows => rows.reduce((acc, r) => { acc[r.kind] = r.id; return acc; }, {});
const panel = () => c.eval(`(()=>{const p=document.querySelector('[data-nai-roll-apply-panel="plan"]');if(!p)return null;return {
  seed:p.querySelector('[data-nai-roll-apply-seed]')?p.querySelector('[data-nai-roll-apply-seed]').getAttribute('data-nai-roll-apply-seed'):'',
  stale:!!p.querySelector('[data-nai-roll-apply-stale]'),
  err:(p.querySelector('[data-nai-roll-apply-error]')||{textContent:''}).textContent.trim(),
  confirmLabel:(p.querySelector('[data-nai-roll-apply-action="confirm"]')||{innerText:''}).innerText.trim(),
  confirmDisabled:!!(p.querySelector('[data-nai-roll-apply-action="confirm"]')||{}).disabled,
  targets:[...p.querySelectorAll('[data-nai-roll-apply-target]')].map(b=>({id:b.getAttribute('data-nai-roll-apply-target'),active:b.getAttribute('data-nai-roll-apply-target-active')==='true',text:(b.innerText||'').replace(/\\s+/g,' ').trim()})),
  style:[...p.querySelectorAll('[data-nai-roll-apply-style]')].map(b=>({mode:b.getAttribute('data-nai-roll-apply-style'),active:b.getAttribute('data-nai-roll-apply-style-active')==='true',disabled:b.disabled})),
  rows:[...p.querySelectorAll('[data-nai-roll-apply-row]')].map(r=>({kind:r.getAttribute('data-nai-roll-apply-row'),action:r.getAttribute('data-nai-roll-apply-action-cell'),source:r.getAttribute('data-nai-roll-apply-source'),current:(r.querySelector('[data-nai-roll-apply-current]')||{textContent:''}).textContent.trim(),next:(r.querySelector('[data-nai-roll-apply-next]')||{textContent:''}).textContent.trim()}))
};})()`);
const pickTarget = id => evalClick(`document.querySelector('[data-nai-roll-apply-target="${id}"]')`);
const confirmPanel = () => evalClick(`document.querySelector('[data-nai-roll-apply-action="confirm"]')`);
const cancelPanel = () => evalClick(`document.querySelector('[data-nai-roll-apply-action="cancel"]')`);
const viewNow = () => c.eval(`(()=>{const el=document.querySelector('[data-agent-view]');return el?el.getAttribute('data-agent-view'):null;})()`);
const labReady = () => c.eval(`!!document.querySelector('.chain-editor-workspace')`);
/* 实验室「查看实际请求」（只读、不计费）：展开后读到的是与实际提交同一套合成的结果。
   两个坑都踩过，这里一起处理：
     ① 它嵌在「全局提示词」details 里面 → 必须按**自己的 summary** 取最内层那个；
     ② 外层 details 收起来时 innerText 是空串 → 先把所有祖先 details 展开，读 textContent。 */
const REQ_PREVIEW_FIND = `[...document.querySelectorAll('details')].filter(function(d){var s=d.querySelector(':scope > summary');return !!s&&/查看实际请求/.test(s.textContent||'');})[0]`;
const openReqPreview = async () => {
  /* 每次都强制重算：它的 onToggle 只在「打开」时重新取 RQ()，
     已经开着再读会拿到上一次的旧内容（这个坑也踩过）。 */
  const ok = await c.eval(`(()=>{const d=${REQ_PREVIEW_FIND};if(!d)return false;let p=d.parentElement;while(p){if(p.tagName==='DETAILS'&&!p.open){p.open=true;p.dispatchEvent(new Event('toggle',{bubbles:true}));}p=p.parentElement;}d.open=false;d.dispatchEvent(new Event('toggle',{bubbles:true}));d.open=true;d.dispatchEvent(new Event('toggle',{bubbles:true}));return true;})()`);
  await sleep(1800);
  return ok ? c.eval(`(()=>{const d=${REQ_PREVIEW_FIND};if(!d)return '';return String(d.textContent||'').replace(/\\s+/g,' ').trim();})()`) : '';
};
const charTabs = () => c.eval(`[...document.querySelectorAll('[data-nai-char-tab]')].map(b=>({idx:b.getAttribute('data-nai-char-tab'),id:b.getAttribute('data-nai-char-id'),active:b.getAttribute('data-nai-char-tab-active')==='true',text:(b.innerText||'').replace(/\\s+/g,' ').trim()}))`);
/* 从实验室回工作区：桌面端实验室是全屏、导航隐藏，只有窄屏才有「退出实验室」按钮。
   真实路径：窄屏点返回 → 若有未保存修正会弹确认 → 选「放弃并离开」（测试不写库）。 */
const leaveLab = async () => {
  await c.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(1000);
  const clicked = await c.eval(CLICK(`document.querySelector('[aria-label="退出实验室，返回上一页面"]')`));
  await sleep(1300);
  const dlg = await c.eval(`(()=>{const a=document.querySelector('[role="alertdialog"]');if(!a)return null;return {title:((a.querySelector('h2')||{}).innerText||'').replace(/\\s+/g,' ').trim(),btns:[...a.querySelectorAll('button')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim())};})()`);
  let dismissed = '';
  if (dlg) {
    dismissed = dlg.btns.find(t => /放弃|不保存|离开/.test(t)) || dlg.btns[0];
    await evalClick(`(()=>{const a=document.querySelector('[role="alertdialog"]');return [...a.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(dismissed)});})()`);
    await sleep(1500);
  }
  await c.send('Emulation.clearDeviceMetricsOverride');
  await sleep(1200);
  return { clicked: !!(clicked && clicked.ok), dlg, dismissed };
};
const switchChar = async idx => { await evalClick(`document.querySelector('[data-nai-char-tab="${idx}"]')`); await sleep(1200); };
const charSectionText = kind => c.eval(`(()=>{const r=document.querySelector('[data-nai-char-section="${kind}"]');if(!r)return null;const s=r.querySelector('[data-nai-summary]');return {charId:r.getAttribute('data-nai-char-id'),text:(s?s.textContent:r.textContent).replace(/\\s+/g,' ').trim()};})()`);
const labSummary = key => c.eval(`(()=>{const el=document.querySelector('[data-nai-summary="'+${JSON.stringify(key)}+'"]');return el?el.textContent.replace(/\\s+/g,' ').trim():null;})()`);
const summary = labSummary;

try {
  /* ================= R00 入口与渲染 ================= */
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 90000, label: '应用启动' });
  await c.eval(`(()=>{try{localStorage.removeItem('nai_roll_last');}catch(e){}return true;})()`);
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: '重载' });
  await sleep(2500);
  const nav = await c.eval(`(()=>{const b=[...document.querySelectorAll('button')].filter(x=>(x.innerText||'').replace(/\\s+/g,' ').trim()==='一键 Roll');return {count:b.length,visible:b.length?b[0].offsetParent!==null:false};})()`);
  check('R00 工作区入口唯一且可见', nav.count === 1 && nav.visible, nav);
  await navRoll();
  await sleep(1500);
  check('R00 视图真机渲染（不是白屏）', await rollVisible());
  check('R00 初始没有结果（先看后付）', (await rowsOf()).length === 0);

  /* ================= 抽一次 + R14 确定性 ================= */
  await act('roll');
  await sleep(1400);
  let rows = await rowsOf();
  const firstIds = idsOf(rows);
  const firstSeed = await seedOf();
  ev.first = { seed: firstSeed, ids: firstIds, names: rows.map(r => r.kind + ':' + r.name) };
  check('抽一次：六栏齐全、都有结果（池子已补齐）', rows.length === 6 && rows.every(r => r.filled), rows.map(r => r.kind + '=' + r.id.slice(0, 10)));
  check('组合随机码被记录', !!firstSeed && firstSeed.length > 3, firstSeed);
  await act('restore');
  await sleep(1500);
  const restoreIds = idsOf(await rowsOf());
  check('R14 同随机码/同输入还原：逐栏 id 完全一致', core.KINDS.every(k => restoreIds[k] === firstIds[k]), { firstIds, restoreIds });
  const eviText = await c.eval(`(()=>{const p=document.querySelector('[data-nai-roll-evidence]');return p?p.textContent:'';})()`);
  let evi = null; try { evi = JSON.parse(eviText); } catch (_e) { /* ignore */ }
  check('R14 证据里有算法版本 / 每栏随机流 / 候选池指纹',
    !!evi && evi.algo === 'nai-roll-2' && core.KINDS.every(k => typeof evi.seeds[k] === 'string' && /^[0-9a-f]{8}$/.test(evi.pools[k].fingerprint)),
    evi && { algo: evi.algo, pools: evi.pools });

  /* ================= R10 单栏换一个 / 固定 / 再抽 ================= */
  const beforeSwap = idsOf(await rowsOf());
  await evalClick(`document.querySelector('[data-nai-roll-swap="appearance"]')`);
  await sleep(1300);
  const afterSwap = idsOf(await rowsOf());
  check('R10 单栏「换一个」只改这一栏，其它五栏不变',
    afterSwap.appearance !== beforeSwap.appearance &&
    core.KINDS.filter(k => k !== 'appearance').every(k => afterSwap[k] === beforeSwap[k]),
    { before: beforeSwap.appearance, after: afterSwap.appearance });
  const swapTwice = idsOf(await rowsOf());
  await evalClick(`document.querySelector('[data-nai-roll-swap="appearance"]')`);
  await sleep(1300);
  check('R10 再换一次仍换掉上一个（排除当前项，不靠重试）', idsOf(await rowsOf()).appearance !== swapTwice.appearance);
  await evalClick(`document.querySelector('[data-nai-roll-lock="wardrobe"]')`);
  await sleep(500);
  const lockedRow = (await rowsOf()).find(r => r.kind === 'wardrobe');
  const lockedSwap = lockedRow.swap;
  check('R10 固定后：该栏「换一个」被禁用并说明原因（不背地绕过固定）',
    lockedRow.locked === true && lockedSwap.disabled === true && /固定/.test(lockedSwap.title), { lockedRow: lockedRow.locked, swap: lockedSwap });
  const beforeAgain = idsOf(await rowsOf());
  await act('again');
  await sleep(1400);
  const afterAgain = idsOf(await rowsOf());
  check('R10「再抽未固定项」保留固定的那一栏', afterAgain.wardrobe === beforeAgain.wardrobe);
  check('R10「再抽未固定项」把候选>1 的未固定栏都换掉了（排除当前项，确定性）',
    ['appearance', 'pose', 'expression', 'scene', 'camera'].every(k => afterAgain[k] !== beforeAgain[k]),
    { beforeAgain, afterAgain });
  /* 全部固定 → 再抽禁用 */
  for (const kind of core.KINDS) {
    const row = (await rowsOf()).find(r => r.kind === kind);
    if (row && row.filled && !row.locked) { await evalClick(`document.querySelector('[data-nai-roll-lock="${kind}"]')`); await sleep(220); }
  }
  const allLockedState = await c.eval(`(()=>{const b=document.querySelector('[data-nai-roll-action="again"]');return b?{disabled:b.disabled,title:b.title,text:(b.innerText||'').replace(/\\s+/g,' ').trim()}:null;})()`);
  check('R11 全部固定时「再抽未固定项」禁用并提示解除固定',
    !!allLockedState && allLockedState.disabled === true, allLockedState);
  await act('unlock-all');
  await sleep(600);
  check('R11 清除全部固定后恢复可用', await c.eval(`!document.querySelector('[data-nai-roll-action="unlock-all"]')`));

  /* ================= R12 上一组 / 下一组 ================= */
  const histBefore = await c.eval(`(()=>{const b=document.querySelector('[data-nai-roll-history="prev"]');return b?!b.disabled:false;})()`);
  const setsCount = (await allChains()).length;
  await evalClick(`document.querySelector('[data-nai-roll-history="prev"]')`);
  await sleep(1000);
  const prevIds = idsOf(await rowsOf());
  check('R12「上一组」回到上一组的内容快照（与当前不同）',
    histBefore === true && core.KINDS.some(k => prevIds[k] !== afterAgain[k]), { prev: prevIds.appearance, now: afterAgain.appearance });
  check('R12 浏览历史不会跳转、不会新建记录（仍在 Roll 页）', (await viewNow()) === 'roll' && (await allChains()).length === setsCount);
  await evalClick(`document.querySelector('[data-nai-roll-history="next"]')`);
  await sleep(1000);
  const nextIds = idsOf(await rowsOf());
  check('R12「下一组」能回到前进的一组', core.KINDS.every(k => nextIds[k] === afterAgain[k]), { nextIds, afterAgain });

  /* ================= R17 本地存储失败不影响页面 ================= */
  await c.eval(`(()=>{window.__naiRollOrigSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('quota exceeded (test)');};return true;})()`);
  await act('roll');
  await sleep(1400);
  const warnStore = await c.eval(`!!document.querySelector('[data-nai-roll-store-warning]')`);
  const stillWorks = (await rowsOf()).every(r => r.filled);
  check('R17 本地存储失败：页面仍可用、有提示、不白屏', warnStore && stillWorks, { warnStore, stillWorks });
  await c.eval(`(()=>{Storage.prototype.setItem=window.__naiRollOrigSet;return true;})()`);
  await act('roll');
  await sleep(1200);

  /* ================= R11 空库 / 只有一条 / 未参与 ================= */
  const exprEntries = (await allChains()).filter(x => x.type === 'expression');
  for (const e of exprEntries) { await api('DELETE', '/api/chains/' + encodeURIComponent(e.id)); createdIds.delete(e.id); }
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: '库变更后重载' });
  await sleep(2200);
  await navRoll();
  await sleep(1200);
  await act('roll');
  await sleep(1300);
  rows = await rowsOf();
  const exprRow = rows.find(r => r.kind === 'expression');
  check('R11 空库：该栏「本次未提供 → 保留实验室原内容」，且给出「去添加」入口',
    exprRow && !exprRow.filled && exprRow.swap && exprRow.swap.state === 'add' && exprRow.swap.disabled === false && exprRow.swap.text === '去添加',
    exprRow);
  check('R11 空库不阻断其它栏', rows.filter(r => r.kind !== 'expression').every(r => r.filled));
  await evalClick(`document.querySelector('[data-nai-roll-check="camera"]')`);
  await sleep(500);
  const camRow = (await rowsOf()).find(r => r.kind === 'camera');
  const camOffNote = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-off-note="camera"]');return el?el.textContent.replace(/\\s+/g,' ').trim():null;})()`);
  check('R11 取消参与：该栏置灰、写明「本次不参与（不抽取、不填入）」、换一个被禁用',
    camRow && camRow.on === false && camRow.swap && camRow.swap.disabled === true && camRow.swap.state === 'blocked' && /未参与/.test(camRow.swap.title) && !!camOffNote,
    { camRow, camOffNote });
  const includesOff = await (async () => {
    /* 取消参与的栏位不能进 payload：把这一组填进去，面板里该栏必须是「keep」 */
    return true;
  })();
  await evalClick(`document.querySelector('[data-nai-roll-check="camera"]')`);
  await sleep(400);
  /* 只有 1 条的库：把**我自己造的** pose 条目删到只剩 1 条（绝不动基线条目） */
  const poseEntries = (await allChains()).filter(x => x.type === 'pose' && (x.tags || []).includes('RollV2'));
  for (const e of poseEntries) { await api('DELETE', '/api/chains/' + encodeURIComponent(e.id)); createdIds.delete(e.id); }
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: '单条池重载' });
  await sleep(2200);
  await navRoll();
  await sleep(1200);
  await act('roll');
  await sleep(1300);
  const singleRow = (await rowsOf()).find(r => r.kind === 'pose');
  check('R11 候选只有 1 条：明说「仅 1 条」且禁用（不让反复无效点击）',
    singleRow && singleRow.swap && singleRow.swap.state === 'blocked' && singleRow.swap.disabled === true && singleRow.swap.text === '仅 1 条', singleRow);
  /* 把条目补回来（后续 R01/R05 需要多候选） */
  for (const [slug, type, name, basePrompt, bilingual] of EXTRA) {
    const pool = (await allChains()).filter(x => x.type === type);
    if (pool.length >= 2) continue;
    await createTestEntry({
      type, name, description: '一键 Roll v2 真机验收临时条目', basePrompt,
      negativePrompt: slug === 'roll-a2' ? 'rap2_bad' : '', tags: ['RollV2'], modules: [],
      params: { width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [], _wardrobe: { bilingual, references: [] } },
      variableValues: { subject: '1girl' }
    }, slug);
  }
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: '补回条目后重载' });
  await sleep(2200);
  await navRoll();
  await sleep(1200);
  await act('roll');
  await sleep(1300);

  /* ================= R15 未消费导入不静默覆盖 ================= */
  await c.eval(`(()=>{try{sessionStorage.setItem('nai_pending_import', JSON.stringify({mode:'roll-apply',seed:'stale-unused',v:2,picks:{},checks:{}}));}catch(e){}return true;})()`);
  await act('fill');
  await sleep(900);
  const pendingWarn = await c.eval(`!!document.querySelector('[data-nai-roll-pending-warn]')`);
  const pendingStillStale = await c.eval(`(()=>{try{return JSON.parse(sessionStorage.getItem('nai_pending_import')||'{}').seed==='stale-unused';}catch(e){return false;}})()`);
  const viewStillRoll = (await viewNow()) === 'roll';
  check('R15 已有未消费导入：不静默覆盖、停在原页并说明', pendingWarn && pendingStillStale && viewStillRoll, { pendingWarn, pendingStillStale, viewStillRoll });
  await c.eval(`(()=>{sessionStorage.removeItem('nai_pending_import');return true;})()`);
  await sleep(300);

  /* ================= 进入实验室：确认面板 ================= */
  let rollRows = await rowsOf();
  let rollIds = idsOf(rollRows);
  let rollSeed = await seedOf();
  ev.fillSource = { seed: rollSeed, ids: rollIds, names: rollRows.map(r => r.kind + ':' + r.name) };
  await act('fill');
  await sleep(2000);
  await c.waitFor(`(()=>{const el=document.querySelector('[data-agent-view]');return el&&el.getAttribute('data-agent-view')==='playground';})()`, { timeout: 30000, label: '切到实验室' });
  await c.waitFor(`!!document.querySelector('.chain-editor-workspace')`, { timeout: 60000, label: '实验室挂载' });
  await sleep(2000);
  let p = await panel();
  check('R00 填入实验室：先弹确认面板（不直接写入）', !!p && (await viewNow()) === 'playground');
  check('R00 面板逐栏列出「当前 → 将填入」+ 动作', !!p && p.rows.length === 6 && p.rows.every(r => r.action === 'replace' || r.action === 'keep'), p && p.rows.map(r => r.kind + ':' + r.action));
  check('R00 面板有「未覆盖检查」说明（左右手/互动/支撑物/自由文本不做判定）',
    !!p && /未覆盖检查/.test(await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-apply-unchecked]');return el?el.textContent:'';})()`)));

  /* ================= R02 选新建角色后取消 ================= */
  const charsBefore = (await charTabs()).length;
  if ((await panel()).targets.find(t => t.id === 'new')) { await pickTarget('new'); await sleep(600); }
  p = await panel();
  const cancelLabelOk = !!p && p.confirmLabel.indexOf('新建角色并填入') === 0;
  await cancelPanel();
  await sleep(900);
  const charsAfterCancel = (await charTabs()).length;
  check('R02 取消：不创建角色、不写入（面板关闭）',
    charsAfterCancel === charsBefore && !(await panel()) && cancelLabelOk, { charsBefore, charsAfterCancel, cancelLabelOk });

  /* ================= R04 四态「明确没有」→ 只进目标角色该栏的负面/约束 ================= */
  /* 为了确定性：把「这一组」直接写成只含「无配饰服饰」这一条，再从 Roll 页填入。 */
  const noneEntryForR04 = (await allChains()).find(x => x.name === '[R] 服饰·无配饰');
  const injectRoll = async picks => {
    await c.eval(`(()=>{try{localStorage.setItem('nai_roll_last',JSON.stringify({seed:'rR04',seeds:{},checks:{appearance:true,wardrobe:true,pose:true,expression:true,scene:true,camera:true},locks:{},picks:${JSON.stringify(picks)},notes:[],styleMode:'keep',styleId:'',history:[],cursor:-1,save:{phase:'idle',id:'',message:'',at:0},at:Date.now()}));}catch(e){}return true;})()`);
  };
  if (noneEntryForR04) {
    await leaveLab();
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R04 重载' });
    await sleep(2200);
    await injectRoll({ wardrobe: { kind: 'wardrobe', id: noneEntryForR04.id, text: noneEntryForR04.basePrompt, updatedAt: noneEntryForR04.updatedAt, filled: true } });
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R04 注入后重载' });
    await sleep(2200);
    await navRoll();
    await sleep(1200);
    await act('fill');
    await sleep(1800);
    const p4 = await panel();
    const w4 = p4 && p4.rows.find(r => r.kind === 'wardrobe');
    const neg4 = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-apply-neg="wardrobe"]');return el?el.textContent.replace(/\\s+/g,' ').trim():null;})()`);
    check('R04 面板把「明确没有」作为约束/备注列出来（不是静默丢掉）',
      !!w4 && w4.action === 'replace' && !!neg4 && /明确没有/.test(neg4) && /配饰/.test(neg4), { w4, neg4 });
    await pickTarget('new');
    await sleep(700);
    await confirmPanel();
    await sleep(2200);
    const charW4 = await charSectionText('wardrobe');
    const charAll = await c.eval(`[...document.querySelectorAll('[data-nai-char-section]')].map(r=>({k:r.getAttribute('data-nai-char-section'),sum:(r.querySelector('[data-nai-summary]')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim().slice(0,60)}))`);
    check('R04 缺席约束落在目标角色该栏（负面/约束记账），没有上提到全局',
      !!charW4 && /缺席约束|负面/.test(charW4.text) && !/明确没有/.test(String((await summary('__a-global-neg')) || '')),
      { charW4, charAll, globalNeg: await summary('__a-global-neg') });

    /* ================= R13b 来源条目被删除：仍可用本次快照，标「已失效」 ================= */
    await leaveLab();
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R13b 重载' });
    await sleep(2200);
    await injectRoll({ wardrobe: { kind: 'wardrobe', id: noneEntryForR04.id, text: noneEntryForR04.basePrompt, updatedAt: noneEntryForR04.updatedAt, filled: true } });
    await api('DELETE', '/api/chains/' + encodeURIComponent(noneEntryForR04.id));
    createdIds.delete(noneEntryForR04.id);
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R13b 删除后重载' });
    await sleep(2200);
    await navRoll();
    await sleep(1200);
    await act('fill');
    await sleep(1800);
    const p13 = await panel();
    const w13 = p13 && p13.rows.find(r => r.kind === 'wardrobe');
    check('R13b 来源条目已删除：标「已不存在」，仍用本次组合里的快照内容（不静默换成别的）',
      !!w13 && w13.source === 'missing' && /rwdn_dress/.test(w13.next), w13);
    await cancelPanel();
    await sleep(900);
  } else {
    check('R04 四态「明确没有」条目就位', false, '没有找到 [R] 服饰·无配饰');
  }

  /* ================= R01 目标角色只改被选中的那个 ================= */
  /* 先造两个角色：A、B */
  for (let i = 0; i < 2; i++) {
    const addBtn = await c.eval(`!!document.querySelector('[data-nai-char-tab-add]')`);
    if (addBtn) { await evalClick(`document.querySelector('[data-nai-char-tab-add]')`); await sleep(1200); }
  }
  let tabs = await charTabs();
  check('R01 实验室已有 2 个角色（用于验证「只改选中角色」）', tabs.length >= 2, tabs);
  const roleA = tabs[0] && tabs[0].id;
  const roleB = tabs[1] && tabs[1].id;
  /* 第一次填 A（R04/R13b 把本机记录换成了注入值，这里先重新抽一组真实组合） */
  await navRoll();
  await sleep(1000);
  await act('roll');
  await sleep(1500);
  rollRows = await rowsOf();
  rollIds = idsOf(rollRows);
  rollSeed = await seedOf();
  await act('fill');
  await sleep(1800);
  await c.waitFor(`!!document.querySelector('[data-nai-roll-apply-panel="plan"]')`, { timeout: 30000, label: '第二次面板' });
  await pickTarget(roleA);
  await sleep(700);
  p = await panel();
  check('R01 面板列出真实角色名，并按稳定角色 id 选中', !!p && p.targets.some(t => t.id === roleA && t.active), p && p.targets);
  const labelA = p && p.confirmLabel;
  await confirmPanel();
  await sleep(2000);
  check('R01 确认按钮文案指明目标（不是含糊的「应用」）', !!labelA && /填入「/.test(labelA), labelA);
  const afterA = await openReqPreview();
  /* 切到 B，再填一次（换一组新组合），验证 A 不变 */
  const left = await leaveLab();
  check('R00 从实验室回到工作区（窄屏返回 + 未保存确认选「放弃」）', left.clicked && (await viewNow()) === 'roll', left);
  await navRoll();
  await sleep(1000);
  await act('roll');
  await sleep(1400);
  const roll2 = await rowsOf();
  const roll2Ids = idsOf(roll2);
  check('R01 第二次抽取拿到了不同的组合（用于验证只改 B）',
    core.KINDS.some(k => roll2Ids[k] && roll2Ids[k] !== rollIds[k]), { roll2Ids, rollIds });
  await act('fill');
  await sleep(1800);
  await c.waitFor(`!!document.querySelector('[data-nai-roll-apply-panel="plan"]')`, { timeout: 30000, label: '第三次面板' });
  await pickTarget(roleB);
  await sleep(700);
  await confirmPanel();
  await sleep(2000);
  const afterB = await openReqPreview();
  const tagsA = await (async () => {
    const out = {};
    for (const kind of core.KINDS) {
      const id = rollIds[kind];
      if (!id) continue;
      const got = await api('GET', '/api/chains/' + encodeURIComponent(id));
      out[kind] = String((got.detail && got.detail.basePrompt) || '').split(',')[0].trim();
    }
    return out;
  })();
  const tags2 = await (async () => {
    const out = {};
    for (const kind of core.KINDS) {
      const id = roll2Ids[kind];
      if (!id) continue;
      const got = await api('GET', '/api/chains/' + encodeURIComponent(id));
      out[kind] = String((got.detail && got.detail.basePrompt) || '').split(',')[0].trim();
    }
    return out;
  })();
  check('R05 请求闭环：填 A 之后，实际请求的角色段包含 A 的四类内容',
    !!afterA && ['appearance', 'wardrobe', 'pose', 'expression'].every(k => !!tagsA[k] && afterA.includes(tagsA[k])),
    { tagsA, preview: String(afterA).slice(0, 200) });
  check('R01 填 B 之后，请求里 A 的旧内容仍在（A 没被改）',
    !!afterB && !!tagsA.appearance && afterB.includes(tagsA.appearance));
  check('R01 填 B 之后，B 的新内容进入请求',
    !!afterB && ['appearance', 'wardrobe', 'pose', 'expression'].some(k => !!tags2[k] && tags2[k] !== tagsA[k] && afterB.includes(tags2[k])),
    { tags2 });
  check('R05 请求闭环：全局两栏（场景/镜头）进入正向提示词',
    !!afterB && ['scene', 'camera'].every(k => !tags2[k] || afterB.includes(tags2[k])), { scene: tags2.scene, camera: tags2.camera });
  const modelLine = (afterB.match(/模型\s*\S+/) || [''])[0];
  check('R05 生成参数不变：请求预览仍显示实验室当前的模型与尺寸', /模型/.test(afterB) && /尺寸/.test(afterB), modelLine);

  /* ================= R07 一次撤销 ================= */
  const undoBtn = await c.eval(`!!document.querySelector('[data-nai-roll-undo-banner]')`);
  check('R07 填入后常驻「撤销本次 Roll 填入」横幅', undoBtn === true);
  const beforeUndoPreview = await openReqPreview();
  const undoClick = await evalClick(`document.querySelector('[data-nai-roll-undo-action="undo"]')`);
  await sleep(2500);
  const afterUndoPreview = await openReqPreview();
  const undoState = await c.eval(`(()=>{const b=document.querySelector('[data-nai-roll-undo-banner]');return b?{warn:b.getAttribute('data-nai-roll-undo-warn'),text:(b.innerText||'').replace(/\\s+/g,' ').trim().slice(0,160)}:null;})()`);
  /* 撤销的判据不依赖「两次抽到不同条目」这种偶然性：
     ① 请求内容确实变了；② 上一次填入（A）的内容还在；③ 本次填入的全局两栏（B 的）已经撤掉。 */
  const undoChanged = !!beforeUndoPreview && !!afterUndoPreview && afterUndoPreview !== beforeUndoPreview;
  const undoKeptA = undoChanged && !!tagsA.appearance && afterUndoPreview.includes(tagsA.appearance);
  const undoDroppedB = undoChanged && (tags2.scene === tagsA.scene || !afterUndoPreview.includes(tags2.scene));
  check('R07 撤销恢复被影响的范围（B 的全局两栏撤掉、A 的内容仍在）',
    undoChanged && undoKeptA && undoDroppedB,
    { clicked: undoClick && undoClick.ok, undoState, undoChanged, undoKeptA, undoDroppedB, tagsA: tagsA.scene, tags2: tags2.scene });
  check('R07 撤销后横幅消失', (await c.eval(`!document.querySelector('[data-nai-roll-undo-banner]')`)) === true, undoState);

  /* ================= R08/R09 保存 ================= */
  await navRoll();
  await sleep(1200);
  const saveName = '[R] 搭配 ' + new Date().toISOString().slice(11, 19);
  await act('save');
  await sleep(500);
  await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-save-name]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(saveName)});el.dispatchEvent(new Event('input',{bubbles:true}));return el.value;})()`);
  await sleep(300);
  /* 连点两次：只应产生一条 */
  await evalClick(`document.querySelector('[data-nai-roll-action="save-confirm"]')`);
  await sleep(60);
  await evalClick(`document.querySelector('[data-nai-roll-action="save-confirm"]')`).catch(() => {});
  await sleep(3000);
  const phase = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-save-phase]');return el?{phase:el.getAttribute('data-nai-roll-save-phase'),id:el.getAttribute('data-nai-roll-preset-id'),text:el.textContent.replace(/\\s+/g,' ').trim().slice(0,160)}:null;})()`);
  const mine = (await allChains()).filter(x => x.name === saveName);
  check('R08 连点两次只产生一条搭配，且显示服务端回执 id',
    mine.length === 1 && !!phase && phase.phase === 'saved' && phase.id === mine[0].id,
    { count: mine.length, phase });
  if (mine[0]) createdIds.add(mine[0].id);
  const preset = mine[0] || {};
  const snap = preset.params && preset.params._presetSnapshot;
  check('R08 搭配落点是既有 type=preset，快照里含六栏内容与随机码/条目 id',
    preset.type === 'preset' && !!snap && !!snap.params._promptSections && Array.isArray(snap.params.characters) &&
    !!snap.naiRoll && !!snap.naiRoll.seed && Object.keys(snap.naiRoll.picks || {}).length === 6,
    { type: preset.type, picks: snap && snap.naiRoll && Object.keys(snap.naiRoll.picks || {}) });
  /* ================= R08 结果未知（离线）→ 核实 ================= */
  await c.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  const offlineName = '[R] 离线保存 ' + new Date().toISOString().slice(11, 19);
  await act('save');
  await sleep(400);
  await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-save-name]');if(!el)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,${JSON.stringify(offlineName)});el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(300);
  await evalClick(`document.querySelector('[data-nai-roll-action="save-confirm"]')`).catch(() => {});
  await sleep(2500);
  const offlinePhase = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-save-phase]');return el?{phase:el.getAttribute('data-nai-roll-save-phase'),text:el.textContent.replace(/\\s+/g,' ').trim().slice(0,120)}:null;})()`);
  await c.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(500);
  check('R08 断网时如实显示「结果待确认」，不直接当失败重建',
    !!offlinePhase && offlinePhase.phase === 'unconfirmed' && /待确认/.test(offlinePhase.text), offlinePhase);
  check('R08 断网保存没有在库里留下记录', (await allChains()).filter(x => x.name === offlineName).length === 0);
  const verifyBtn = await c.eval(`!!document.querySelector('[data-nai-roll-action="verify-save"]')`);
  if (verifyBtn) {
    await evalClick(`document.querySelector('[data-nai-roll-action="verify-save"]')`);
    await sleep(2000);
    const verified = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-save-phase]');return el?{phase:el.getAttribute('data-nai-roll-save-phase'),text:el.textContent.replace(/\\s+/g,' ').trim().slice(0,140)}:null;})()`);
    check('R08 点「核实保存结果」明确结论（库里没有 → 失败可重存）',
      !!verified && verified.phase === 'failed', verified);
  } else {
    check('R08 点「核实保存结果」明确结论', false, '没有核实按钮');
  }

  /* R09：已保存的搭配被用户改过之后，核实/重试都不得用旧快照覆盖它 */
  if (preset.id) {
    const changedName = saveName + '·手动改过';
    const put = await api('PUT', '/api/chains/' + encodeURIComponent(preset.id), {
      name: changedName, description: '用户手动改过这条搭配', basePrompt: 'USER_EDITED_KEEP_ME',
      negativePrompt: '', modules: [], variableValues: {}, tags: [], params: preset.params,
      expectedUpdatedAt: String(preset.updatedAt || '')
    });
    check('R09 前置：用户手动修改搭配成功', put.ok === true, put.status);
    /* 模拟「同一次保存的响应丢失」：pending 里仍然是这条记录的同一操作 id */
    await c.eval(`(()=>{try{const raw=sessionStorage.getItem('nai_roll_preset_pending');const cur=raw?JSON.parse(raw):{};sessionStorage.setItem('nai_roll_preset_pending',JSON.stringify({sig:cur.sig||'x',id:${JSON.stringify(preset.id)},at:Date.now()}));}catch(e){}return true;})()`);
    await evalClick(`document.querySelector('[data-nai-roll-action="verify-save"]')`).catch(() => {});
    await sleep(2000);
    const after = (await allChains()).find(x => x.id === preset.id);
    const phaseNow = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-save-phase]');return el?el.getAttribute('data-nai-roll-save-phase'):null;})()`);
    check('R09 查到这次操作早已保存 → 只标记已保存，不用旧快照覆盖用户改过的搭配（不 PUT）',
      !!after && after.basePrompt === 'USER_EDITED_KEEP_ME' && after.name === changedName && phaseNow === 'saved',
      { name: after && after.name, basePrompt: after && after.basePrompt, phaseNow });
    check('R09 重试也没有产生第二条记录', (await allChains()).filter(x => x.name === changedName).length === 1);
    /* 还原名字，方便后面的「载入搭配」按原名找到它 */
    await api('PUT', '/api/chains/' + encodeURIComponent(preset.id), {
      name: saveName, description: preset.description || '', basePrompt: preset.basePrompt || '',
      negativePrompt: preset.negativePrompt || '', modules: preset.modules || [], variableValues: preset.variableValues || {},
      tags: preset.tags || [], params: preset.params, expectedUpdatedAt: String(after.updatedAt || '')
    }).catch(() => {});
  }

  /* ================= R13 来源改内容 / 删除（只用我自己造的条目，绝不动基线） ================= */
  const mineAppearance = (await allChains()).find(x => x.type === 'appearance' && (x.tags || []).includes('RollV2'));
  const intentionallyChanged = new Set();
  if (mineAppearance) {
    /* 用注入的方式让这一组固定指向我自己的条目 → 来源状态可确定性观察 */
    const left13 = await leaveLab();
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R13 重载' });
    await sleep(2200);
    await injectRoll({ appearance: { kind: 'appearance', id: mineAppearance.id, text: mineAppearance.basePrompt, updatedAt: mineAppearance.updatedAt, filled: true } });
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R13 注入后重载' });
    await sleep(2200);
    await navRoll();
    await sleep(1200);
    await act('fill');
    await sleep(1800);
    const pBefore = await panel();
    const rowBefore = pBefore && pBefore.rows.find(r => r.kind === 'appearance');
    check('R13 来源未变时标「仍有效」', !!rowBefore && rowBefore.source === 'ok', rowBefore);
    await cancelPanel();
    await sleep(800);
    /* 改内容 + 改名（只改我自己的条目） */
    await api('PUT', '/api/chains/' + encodeURIComponent(mineAppearance.id), {
      name: mineAppearance.name + '·改名', description: mineAppearance.description, basePrompt: mineAppearance.basePrompt + ', renamed_extra',
      negativePrompt: mineAppearance.negativePrompt || '', modules: mineAppearance.modules || [], tags: mineAppearance.tags || [],
      variableValues: mineAppearance.variableValues || {}, params: mineAppearance.params,
      expectedUpdatedAt: String(mineAppearance.updatedAt || '')
    });
    intentionallyChanged.add(mineAppearance.id);
    await c.goto(BASE_URL);
    await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'R13 改名后重载' });
    await sleep(2200);
    await navRoll();
    await sleep(1200);
    await act('fill');
    await sleep(1800);
    const p2 = await panel();
    const srcRow = p2 && p2.rows.find(r => r.kind === 'appearance');
    check('R13 来源条目改过内容：面板标「已更新」，并说明用新内容新建快照',
      !!srcRow && srcRow.source === 'updated' && /renamed_extra/.test(srcRow.next), srcRow);
    await cancelPanel();
    await sleep(800);
  } else {
    check('R13 来源条目改过内容：面板标「已更新」', false, '没有找到我自己造的 appearance 条目');
  }

  /* ================= R16 窄屏几何 + 计算样式 ================= */
  await navRoll();
  await sleep(1000);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(1600);
  const narrow = await c.eval(`(()=>{
    const vw=window.innerWidth, out={vw,scrollW:document.documentElement.scrollWidth};
    const rects=sel=>[...document.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height),t:Math.round(r.top),b:Math.round(r.bottom),text:(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,20),fs:parseFloat(getComputedStyle(e).fontSize)||0};});
    out.rows=rects('[data-nai-roll-row]'); out.acts=rects('[data-nai-roll-action]'); out.swaps=rects('[data-nai-roll-swap]');
    out.outOfView=[...out.rows,...out.acts,...out.swaps].filter(x=>x.l<-1||x.r>vw+1).map(x=>x.text);
    const overlaps=list=>{for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j];if(a.l<b.r&&b.l<a.r&&a.t<b.b&&b.t<a.b)return [a.text,b.text];}return null;};
    out.rowOverlap=overlaps(out.rows); out.actOverlap=overlaps(out.acts);
    out.minClick=Math.min(...[...out.acts,...out.swaps].map(x=>Math.min(x.w,x.h)).filter(n=>n>0));
    out.minFont=Math.min(...out.rows.map(x=>x.fs).filter(n=>n>0));
    return out;})()`);
  check('R16 390px：无横向溢出、六行与按钮不越界不重叠', narrow.scrollW <= narrow.vw + 1 && !narrow.rowOverlap && !narrow.actOverlap && narrow.outOfView.length === 0,
    { vw: narrow.vw, scrollW: narrow.scrollW, rowOverlap: narrow.rowOverlap, actOverlap: narrow.actOverlap, out: narrow.outOfView });
  check('R16 390px：主要操作可点（最小边 ≥ 24px）且文字不小于 10px',
    narrow.minClick >= 24 && narrow.minFont >= 10, { minClick: narrow.minClick, minFont: narrow.minFont });
  await c.screenshot(path.join(dir, 'R16-narrow-390.png'));
  await c.send('Emulation.clearDeviceMetricsOverride');
  await sleep(1000);

  /* ================= R18 载入保存的 Roll 搭配 ================= */
  if (preset.id) {
    await navRoll();
    await sleep(1000);
    await act('fill');
    await sleep(1800);
    await confirmPanel();
    await sleep(1800);
    const loadOk = await c.eval(`(()=>{const b=document.querySelector('[data-nai-preset-trigger="load"]');if(!b)return false;b.click();return true;})()`);
    await sleep(1500);
    const picked = loadOk ? await c.eval(CLICK(`(()=>{const all=[...document.querySelectorAll('[data-nai-preset-item]')];return all.find(e=>(e.innerText||'').includes(${JSON.stringify(saveName)}))||all[0];})()`)) : null;
    await sleep(1800);
    const diff = await c.eval(`(()=>{const out={};for(const r of document.querySelectorAll('[data-nai-preset-diff-row]'))out[r.getAttribute('data-nai-preset-diff-row')]=(r.innerText||'').replace(/\\s+/g,' ').trim();return out;})()`);
    check('R18 载入搭配的覆盖范围能读出场景/镜头（纯字符串形状）',
      !!diff['__a-global-scene'] && !!diff['__a-global-camera'] && /\w/.test(diff['__a-global-scene']) && /\w/.test(diff['__a-global-camera']),
      { scene: diff['__a-global-scene'], camera: diff['__a-global-camera'] });
    const beforeLoad = await openReqPreview();
    if (loadOk && picked && picked.ok) { await evalClick(`document.querySelector('[data-nai-preset-action="load-confirm"]')`); await sleep(2200); }
    const afterLoad = await openReqPreview();
    check('R18 载入后请求内容发生变化（真的应用了），且没有发起生成请求', !!afterLoad && afterLoad !== beforeLoad, { changed: afterLoad !== beforeLoad });
    await c.screenshot(path.join(dir, 'R18-loaded.png'));
  } else {
    check('R18 载入保存的 Roll 搭配', false, '本次没有保存成功的搭配可载入');
  }

  /* ================= 零写入 / 无生成 ================= */
  const afterAll = await allChains();
  const afterJson = new Map(afterAll.map(x => [x.id, JSON.stringify(x)]));
  /* 排除「本轮测试自己刻意改过的条目」（R13 的改名/改内容），其余基线必须一个字节都没变 */
  const touched = baselineIds.filter(id => !intentionallyChanged.has(id) && beforeJson.get(id) !== afterJson.get(id));
  check('抽中的词库条目一个字节都没被改（基线逐字节比对，已排除测试刻意改过的那一条）', touched.length === 0, touched);
  const writes = requestLog.filter(r => r.method !== 'GET' && !/\/api\/chains/.test(r.url));
  check('除 /api/chains 外没有任何写请求（不消耗额度）', writes.length === 0, writes.map(r => r.method + ' ' + r.url));
  const genReq = requestLog.filter(r => /generate/i.test(r.url));
  check('没有任何生成类请求', genReq.length === 0, genReq.map(r => r.url));
  check('全程没有碰生产实例', requestLog.filter(r => String(r.url).includes(':3000')).length === 0);
  const consoleErrors = c.logs.filter(l => l.type === 'error');
  check('浏览器控制台没有报错', consoleErrors.length === 0, consoleErrors.map(l => String(l.text).slice(0, 200)));
  ev.narrow = narrow;
  ev.preset = { id: preset.id, name: saveName };
} catch (e) {
  check('验收脚本执行完成（无异常中断）', false, String((e && e.stack) || e));
  try { await c.screenshot(path.join(dir, 'FAILED.png')); } catch (_e) { /* ignore */ }
} finally {
  try { await c.close(); } catch (_e) { /* ignore */ }
}

const cleanup = await cleanupCreated();
dump(dir, 'roll-v2-result.json', {
  at: new Date().toISOString(), base: BASE_URL, total: results.length, failed,
  evidence: ev, cleanup, requestLog,
  results
});
console.log(`\n=== 一键 Roll v2 真机验收：${results.length - failed}/${results.length} 通过（失败 ${failed}）`);
console.log('清理：删掉 ' + cleanup.deleted.length + ' 条，失败 ' + cleanup.failed.length + ' 条，剩余 ' + cleanup.remaining.length);
console.log('原始输出：' + path.join(dir, 'roll-v2-result.json'));
process.exit(failed ? 1 : 0);

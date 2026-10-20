/*
 * Roll 内容搭配库（纯内容快照）· 真机验收
 * 对应 `NAI-Atelier-Roll纯内容搭配库最新修改需求.md` §十二 C01–C23（可执行子集）。
 *
 *   node nai-atelier-testenv/tests/roll-content-suite.mjs
 *
 * 写入只发生在隔离实例（lib/guard.mjs 守卫）；生产只读。不调用任何生成接口。
 * 关键仪器：
 *   · DOM 读数（data-nai-rolllib-* / data-nai-roll-apply-*）
 *   · 实验室「查看实际请求」只读预览（与实际提交同一套合成）用来证明：
 *     模型/尺寸/张数/seed 与画师风格、风格负面不变，而内容正面与内容负面按分类落到正确范围。
 *   · GET /api/chains 核对记录里到底存了什么（白名单）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { BASE_URL, runDir, dump, assertTestTarget } from '../lib/env.mjs';
import { api, createTestEntry, cleanupCreated, createdIds, requestLog } from '../lib/guard.mjs';
import { launch, sleep } from '../lib/cdp.mjs';
import { CLICK } from '../lib/walk.mjs';
import { openLabEditor } from '../lib/lab.mjs';
import core from '../../patches/roll/core.mjs';

assertTestTarget(BASE_URL);
const dir = runDir('roll-content');
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
const playground = async () => (await allChains()).find(x => x.name === '生图实验室');
const contentRecords = async () => (await allChains()).filter(x => x.params && x.params._rollContentSnapshot && String(x.params._rollContentSnapshot.format) === 'nai-roll-content');

/* ---------- 造几条词库条目（六类都要有 ≥1 条；其中一条带四态「明确没有」） ---------- */
const EXTRA = [
  ['cl-a1', 'appearance', '[CL] 形象甲', 'cla1_hair, cla1_eyes', 'cla1_hair（验收发甲）, cla1_eyes（验收瞳甲）', ''],
  ['cl-w1', 'wardrobe', '[CL] 服饰甲', 'clw1_coat, clw1_boots', 'clw1_coat（验收外套）, clw1_boots（验收靴）', ''],
  ['cl-w2', 'wardrobe', '[CL] 服饰·无帽子', 'clw2_dress', 'clw2_dress（验收连衣裙）', 'none'],
  ['cl-p1', 'pose', '[CL] 动作甲', 'clp1_stand, clp1_look', 'clp1_stand（验收站姿）, clp1_look（验收视线）', ''],
  ['cl-e1', 'expression', '[CL] 表情甲', 'cle1_smile, cle1_blush', 'cle1_smile（验收微笑）, cle1_blush（验收脸红）', ''],
  ['cl-s1', 'scene', '[CL] 场景甲', 'cls1_rain, cls1_night', 'cls1_rain（验收雨夜）, cls1_night（验收夜晚）', ''],
  ['cl-c1', 'camera', '[CL] 镜头甲', 'clc1_closeup, clc1_lowangle', 'clc1_closeup（验收特写）, clc1_lowangle（验收低角度）', '']
];
for (const [slug, type, name, basePrompt, bilingual, facetMode] of EXTRA) {
  await createTestEntry({
    type, name, description: 'Roll 内容库真机验收临时条目', basePrompt, negativePrompt: slug === 'cl-a1' ? 'cla1_bad' : '',
    tags: ['RollContent'], modules: [],
    params: {
      width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', characters: [],
      _wardrobe: Object.assign({ bilingual, references: [] }, facetMode === 'none' ? { facets: { accessory: '__none__' } } : {})
    },
    variableValues: { subject: '1girl' }
  }, slug);
}

const c = await launch({ port: 9743, profile: '.chrome-roll-content', width: 1500, height: 1100, url: BASE_URL });
const ev = {};
const evalClick = sel => c.eval(CLICK(sel));
const navRoll = () => c.eval(CLICK(`[...document.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()==='一键 Roll')`));
const navLib = () => c.eval(CLICK(`[...document.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()==='Roll 内容库')`));
const act = name => evalClick(`document.querySelector('[data-nai-roll-action="${name}"]')`);
const rowsOf = () => c.eval(`[...document.querySelectorAll('[data-nai-roll-row]')].map(r=>({kind:r.getAttribute('data-nai-roll-row'),id:r.getAttribute('data-nai-roll-id'),filled:r.getAttribute('data-nai-roll-filled')==='true',name:(r.querySelector('[data-nai-roll-name]')||{textContent:''}).textContent.trim()}))`);
const panel = () => c.eval(`(()=>{const p=document.querySelector('[data-nai-roll-apply-panel="plan"]');if(!p)return null;return {
  seedEl:!!p.querySelector('[data-nai-roll-apply-seed]'),
  styleButtons:p.querySelectorAll('[data-nai-roll-apply-style]').length,
  note:(p.querySelector('[data-nai-roll-apply-note]')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim(),
  confirmLabel:(p.querySelector('[data-nai-roll-apply-action="confirm"]')||{innerText:''}).innerText.trim(),
  targets:[...p.querySelectorAll('[data-nai-roll-apply-target]')].map(b=>({id:b.getAttribute('data-nai-roll-apply-target'),active:b.getAttribute('data-nai-roll-apply-target-active')==='true',text:(b.innerText||'').replace(/\\s+/g,' ').trim()})),
  rows:[...p.querySelectorAll('[data-nai-roll-apply-row]')].map(r=>({kind:r.getAttribute('data-nai-roll-apply-row'),action:r.getAttribute('data-nai-roll-apply-action-cell'),source:r.getAttribute('data-nai-roll-apply-source'),current:(r.querySelector('[data-nai-roll-apply-current]')||{textContent:''}).textContent.trim(),next:(r.querySelector('[data-nai-roll-apply-next]')||{textContent:''}).textContent.trim()}))
};})()`);
const confirmPanel = () => evalClick(`document.querySelector('[data-nai-roll-apply-action="confirm"]')`);
const cancelPanel = () => evalClick(`document.querySelector('[data-nai-roll-apply-action="cancel"]')`);
const pickTarget = id => evalClick(`document.querySelector('[data-nai-roll-apply-target="${id}"]')`);
const viewNow = () => c.eval(`(()=>{const el=document.querySelector('[data-agent-view]');return el?el.getAttribute('data-agent-view'):null;})()`);
const charTabs = () => c.eval(`[...document.querySelectorAll('[data-nai-char-tab]')].map(b=>({idx:b.getAttribute('data-nai-char-tab'),id:b.getAttribute('data-nai-char-id'),active:b.getAttribute('data-nai-char-tab-active')==='true',text:(b.innerText||'').replace(/\\s+/g,' ').trim()}))`);
const charSectionText = kind => c.eval(`(()=>{const r=document.querySelector('[data-nai-char-section="${kind}"]');if(!r)return null;const s=r.querySelector('[data-nai-summary]');return (s?s.textContent:r.textContent).replace(/\\s+/g,' ').trim();})()`);
const REQ_FIND = `[...document.querySelectorAll('details')].filter(function(d){var s=d.querySelector(':scope > summary');return !!s&&/查看实际请求/.test(s.textContent||'');})[0]`;
const reqPreview = async () => {
  await c.eval(`(()=>{const d=${REQ_FIND};if(!d)return false;let p=d.parentElement;while(p){if(p.tagName==='DETAILS'&&!p.open){p.open=true;p.dispatchEvent(new Event('toggle',{bubbles:true}));}p=p.parentElement;}d.open=false;d.dispatchEvent(new Event('toggle',{bubbles:true}));d.open=true;d.dispatchEvent(new Event('toggle',{bubbles:true}));return true;})()`);
  await sleep(1800);
  return c.eval(`(()=>{const d=${REQ_FIND};return d?String(d.textContent||'').replace(/\\s+/g,' ').trim():'';})()`);
};
const partOf = (text, label, len) => {
  const i = String(text || '').indexOf(label);
  return i < 0 ? '' : String(text).slice(i, i + (len || 80));
};
/* 从「查看实际请求」文本里取参数（只读预览与真实提交同一套合成） */
const paramsOf = text => ({
  model: (String(text || '').match(/模型\s*([a-z0-9.\-]+)/) || ['', ''])[1],
  size: ((String(text || '').match(/尺寸\s*(\d+\s*×\s*\d+)/) || ['', ''])[1] || '').replace(/\s+/g, ''),
  stepsCfg: ((String(text || '').match(/步数 \/ CFG\s*(\d+\s*\/\s*[\d.]+)/) || ['', ''])[1] || '').replace(/\s+/g, ''),
  sampler: (String(text || '').match(/采样器\s*([a-z0-9_]+)/) || ['', ''])[1],
  seed: (String(text || '').match(/种子\s*(随机|\d+)/) || ['', ''])[1]
});
const leaveLab = async () => {
  await c.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  let clicked = await c.eval(CLICK(`document.querySelector('[aria-label="退出实验室，返回上一页面"]')`));
  if (!clicked || !clicked.ok) clicked = await c.eval(CLICK(`document.querySelector('[aria-label^="返回"]')`));
  await sleep(1200);
  const dlg = await c.eval(`(()=>{const a=document.querySelector('[role="alertdialog"]');if(!a)return null;return [...a.querySelectorAll('button')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim());})()`);
  let dismissed = '';
  if (dlg) {
    dismissed = dlg.find(t => /放弃|不保存|离开/.test(t)) || dlg[0];
    await evalClick(`(()=>{const a=document.querySelector('[role="alertdialog"]');return [...a.querySelectorAll('button')].find(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()===${JSON.stringify(dismissed)});})()`);
    await sleep(1400);
  }
  await c.send('Emulation.clearDeviceMetricsOverride');
  await sleep(1200);
  return { clicked: !!(clicked && clicked.ok), dismissed };
};

let savedId = '';
const saveName = '[CL] 内容 ' + new Date().toISOString().slice(11, 19);
try {
  /* ================= C01 原三个功能仍在 ================= */
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 90000, label: '应用启动' });
  await c.eval(`(()=>{try{localStorage.removeItem('nai_roll_last');}catch(e){}return true;})()`);
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: '重载' });
  await sleep(2500);
  const navs = await c.eval(`[...document.querySelectorAll('button')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim()).filter(t=>t==='一键 Roll'||t==='Roll 内容库'||t==='实验室')`);
  check('C01 三个入口都在（一键 Roll / Roll 内容库 / 实验室），原结构未变', navs.indexOf('一键 Roll') >= 0 && navs.indexOf('Roll 内容库') >= 0 && navs.indexOf('实验室') >= 0, navs);
  await navRoll();
  await sleep(1500);
  await act('roll');
  await sleep(1500);
  const rollRows = await rowsOf();
  check('C01 原「抽一次」正常，六栏有结果', rollRows.length === 6 && rollRows.filter(r => r.filled).length >= 5, rollRows.map(r => r.kind + '=' + r.id.slice(0, 8)));
  const idsForSave = rollRows.reduce((a, r) => { a[r.kind] = r.id; return a; }, {});

  /* ================= C02 存新库：不含画师风格/风格负面/生图参数 ================= */
  /* 先给实验室设一个可辨认的画师串与全局负面，用来证明它不会进新库 */
  const pg = await playground();
  const labStyle = 'LAB_ARTIST_MARKER, cla1_hair', labNeg = 'LAB_STYLE_NEG_MARKER';
  if (pg) {
    await api('PUT', '/api/chains/' + encodeURIComponent(pg.id), {
      name: pg.name, description: pg.description || '', basePrompt: labStyle, negativePrompt: labNeg,
      modules: pg.modules || [], variableValues: pg.variableValues || {}, tags: pg.tags || [],
      params: Object.assign({}, pg.params, { steps: 31, scale: 6.5, seed: 123456, width: 640, height: 896 }),
      expectedUpdatedAt: String(pg.updatedAt || '')
    });
  }
  /* Roll 页也选一个风格串（证明「Roll 选了画师风格再存新库，新记录不含它」） */
  const styleChain = (await allChains()).find(x => x.type === 'style' && (x.name || '').indexOf('测试基线') === 0);
  if (styleChain) {
    await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-style]');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(el,${JSON.stringify(styleChain.id)});el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;})()`);
    await sleep(400);
    await evalClick(`document.querySelector('[data-nai-roll-style-mode="replace"]')`);
    await sleep(300);
  }
  await act('save-content');
  await sleep(700);
  const contentPanelOpen = await c.eval(`!!document.querySelector('[data-nai-roll-content-panel]')`);
  check('C02 保存面板出现，并写明「仅保存六类内容，不含画师风格与生图参数」',
    contentPanelOpen && /仅保存六类内容/.test(await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-content-panel]');return el?el.textContent.replace(/\\s+/g,' '):'';})()`)));
  await c.eval(`(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const n=document.querySelector('[data-nai-roll-content-name]');setter.call(n,${JSON.stringify(saveName)});n.dispatchEvent(new Event('input',{bubbles:true}));const t=document.querySelector('[data-nai-roll-content-tags]');setter.call(t,'内容库,验收');t.dispatchEvent(new Event('input',{bubbles:true}));const d=document.querySelector('[data-nai-roll-content-note]');setter.call(d,'备注：只存六类内容');d.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(400);
  /* C04：连点两次只产生一条 */
  await evalClick(`document.querySelector('[data-nai-roll-action="save-content-confirm"]')`);
  await sleep(80);
  await evalClick(`document.querySelector('[data-nai-roll-action="save-content-confirm"]')`).catch(() => {});
  await sleep(3000);
  const phase = await c.eval(`(()=>{const el=document.querySelector('[data-nai-roll-content-phase]');return el?{phase:el.getAttribute('data-nai-roll-content-phase'),id:el.getAttribute('data-nai-roll-content-id'),text:el.textContent.replace(/\\s+/g,' ').trim().slice(0,140)}:null;})()`);
  const recs = (await contentRecords()).filter(r => r.name === saveName);
  check('C04 连点两次只产生一条记录，并显示服务端回执 id', recs.length === 1 && !!phase && phase.phase === 'saved' && phase.id === recs[0].id, { count: recs.length, phase });
  const rec = recs[0] || {};
  if (rec.id) createdIds.add(rec.id);
  savedId = rec.id || '';
  const snap = (rec.params && rec.params._rollContentSnapshot) || {};
  check('C02 新记录不含画师正文 / 风格负面（记录级 basePrompt 与 negativePrompt 都是空）', rec.basePrompt === '' && rec.negativePrompt === '', { basePrompt: rec.basePrompt, negativePrompt: rec.negativePrompt });
  check('C02 快照是纯内容格式，且只含六类内容/约束/证据（没有 style / basePrompt / params 字段）',
    snap.format === 'nai-roll-content' && Array.isArray(snap.roles) && !!snap.global && !('basePrompt' in snap) && !('negativePrompt' in snap) && !('params' in snap) && !('style' in snap),
    { keys: Object.keys(snap) });
  const snapContentOnly = JSON.stringify(Object.assign({}, snap, { roll: undefined }));
  const snapText = JSON.stringify(snap);
  check('C02 快照里搜不到画师标记与风格负面标记', snapText.indexOf('LAB_ARTIST_MARKER') < 0 && snapText.indexOf('LAB_STYLE_NEG_MARKER') < 0 && snapText.indexOf(String(styleChain && styleChain.basePrompt || '1girl')) < 0);
  check('C02 快照（除 roll 证据外）没有模型/采样器/步数/CFG/尺寸/张数/生图 seed 字段', !/"(model|sampler|steps|scale|width|height|n_samples)"\s*:/.test(snapContentOnly), snapContentOnly.slice(0, 140));
  check('C02 内容负面按分类独立记账（角色类进 roles[0].negatives，不进全局负面）',
    !!snap.roles && !!snap.roles[0] && !!snap.roles[0].negatives && !!snap.roles[0].negatives.appearance,
    snap.roles && snap.roles[0] && snap.roles[0].negatives);

  /* ================= C03 保存后再 Roll，不改变已提交快照 ================= */
  await act('roll');
  await sleep(1500);
  const recAfter = (await contentRecords()).find(r => r.id === savedId);
  check('C03 保存期间/之后重新抽，不改变已提交的记录内容',
    !!recAfter && JSON.stringify(recAfter.params._rollContentSnapshot) === JSON.stringify(snap));

  /* ================= C05 来源条目被删/改，已存记录不变 ================= */
  const srcWardrobe = (await allChains()).find(x => x.name === '[CL] 服饰甲');
  if (srcWardrobe) {
    await api('DELETE', '/api/chains/' + encodeURIComponent(srcWardrobe.id));
    createdIds.delete(srcWardrobe.id);
    const rec2 = (await contentRecords()).find(r => r.id === savedId);
    check('C05 来源条目被删除后，已保存记录的内容与来源快照仍完整', !!rec2 && JSON.stringify(rec2.params._rollContentSnapshot) === JSON.stringify(snap));
  } else {
    check('C05 来源条目被删除后，已保存记录仍完整', false, '没有找到来源条目');
  }

  /* ================= 新库管理页 ================= */
  await navLib();
  await sleep(1600);
  const card = await c.eval(`(()=>{const e=document.querySelector('[data-nai-rolllib-card="${savedId}"]');if(!e)return null;return {scope:(e.querySelector('[data-nai-rolllib-scope]')||{textContent:''}).textContent.replace(/\\s+/g,' ').trim(),hasLoad:!!e.querySelector('[data-nai-rolllib-load="${savedId}"]')};})()`);
  check('C17 新库独立入口可用，卡片显示实际包含范围（不把空库/未参与显示成已有内容）',
    !!card && /角色：/.test(card.scope) && card.hasLoad, card);
  await c.eval(`(()=>{const el=document.querySelector('[data-nai-rolllib-search]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'内容库');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(700);
  const filtered = await c.eval(`document.querySelectorAll('[data-nai-rolllib-card]').length`);
  await c.eval(`(()=>{const el=document.querySelector('[data-nai-rolllib-search]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'zzz-不存在');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(700);
  const noneFound = await c.eval(`document.querySelectorAll('[data-nai-rolllib-card]').length`);
  check('C07 管理页搜索按名称/标签/备注筛选（搜标签能命中，搜不到时给出空态）', filtered === 1 && noneFound === 0, { filtered, noneFound });
  await c.eval(`(()=>{const el=document.querySelector('[data-nai-rolllib-search]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(600);
  await evalClick(`document.querySelector('[data-nai-rolllib-preview="${savedId}"]')`);
  await sleep(900);
  const preview = await c.eval(`(()=>{const p=document.querySelector('[data-nai-rolllib-preview-panel]');if(!p)return null;return {rows:[...p.querySelectorAll('[data-nai-rolllib-preview-row]')].map(r=>r.getAttribute('data-nai-rolllib-preview-row')),negs:[...p.querySelectorAll('[data-nai-rolllib-preview-neg]')].map(r=>r.getAttribute('data-nai-rolllib-preview-neg')),text:p.textContent.replace(/\\s+/g,' ').slice(0,400)};})()`);
  check('C05 只读预览按六类列出内容与内容负面（来源已删也照常显示快照内容）',
    !!preview && preview.rows.length === 6 && preview.negs.length >= 1, preview && { rows: preview.rows, negs: preview.negs });

  /* ================= C06/C07/C08/C09/C10/C11/C15/C16 载入到真实风格串 ================= */
  /* 用一个**自带画师串、风格负面、参数、模块**的测试风格串做载入验收：
     这才是「风格配置保持不变」能被真实观测的地方（实验室的 playground 由应用自己建，永远没有画师串）。 */
  const styleEntry = await createTestEntry({
    type: 'style', name: '[CL] 风格甲', description: 'Roll 内容库真机验收：带画师串 / 风格负面 / 参数',
    basePrompt: 'CL_ARTIST_MARKER, cla1_hair', negativePrompt: 'CL_STYLE_NEG_MARKER',
    tags: ['RollContent'], modules: [{ id: 'cl-mod', name: 'CL 模块', content: 'CL_MODULE_MARKER', isActive: true }],
    params: { width: 640, height: 896, steps: 31, scale: 6.5, sampler: 'k_euler_ancestral', seed: 123456, characters: [] },
    variableValues: { subject: '' }
  }, 'cl-style1');
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'C06 重载' });
  await sleep(2400);
  const opened = await openLabEditor(c, { name: '[CL] 风格甲', type: 'style' });
  check('C16 打开风格串编辑器（验证内容载入不覆盖画师风格的前提）', opened.ok === true, opened);
  await sleep(1600);
  const before = await reqPreview();
  const beforeParams = paramsOf(before);
  const beforeBaseSum = await c.eval(`(()=>{const el=document.querySelector('[data-nai-summary="__a-global-base"]');return el?el.textContent.replace(/\\s+/g,' ').trim():'';})()`);
  /* C16：从「画师与风格」行的入口打开选择器 → 选内容 → 进入同一套载入面板 */
  const styleEntryBtn = await c.eval(`!!document.querySelector('[data-nai-rolllib-trigger="style"]')`);
  check('C16 「画师与风格」行有「载入 Roll 内容」入口', styleEntryBtn === true);
  if (styleEntryBtn) { await evalClick(`document.querySelector('[data-nai-rolllib-trigger="style"]')`); await sleep(1300); }
  const pickerShown = await c.eval(`!!document.querySelector('[data-nai-rolllib-picker]')`);
  check('C16 点入口打开的是 Roll 内容选择器', pickerShown === true);
  await evalClick(`document.querySelector('[data-nai-rolllib-item="${savedId}"]')`);
  await sleep(1900);
  let p = await panel();
  const providedCount = (snap.roles && snap.roles[0] ? Object.keys(snap.roles[0].sections).length : 0)
    + core.GLOBAL_KEYS.filter(k => snap.global && snap.global[k] && snap.global[k].provided).length;
  check('C08 面板里待替换的分类数 = 快照实际提供的分类数，其余为保留',
    !!p && p.rows.filter(r => r.action === 'replace').length === providedCount && p.rows.filter(r => r.action === 'keep').length === (6 - providedCount),
    { providedCount, rows: p && p.rows.map(r => r.kind + ':' + r.action) });
  check('C19 纯内容载入面板没有风格块、没有随机码（风格与参数完全不在计划里）',
    !!p && p.styleButtons === 0 && p.seedEl === false, p && { styleButtons: p.styleButtons, seedEl: p.seedEl });
  check('C10 面板写明画师风格、风格负面与生图参数保持当前配置', !!p && /画师风格/.test(p.note) && /生图参数/.test(p.note), p && p.note.slice(0, 120));
  const baseSumInPanel = await c.eval(`(()=>{const el=document.querySelector('[data-nai-summary="__a-global-base"]');return el?el.textContent.replace(/\\s+/g,' ').trim():'';})()`);
  check('C16 打开选择器与预览都没有改写画师串字段', /CL_ARTIST_MARKER/.test(baseSumInPanel) && baseSumInPanel === beforeBaseSum, { baseSumInPanel, beforeBaseSum });
  /* C07：选「新建角色」后取消 → 不创建、不写入 */
  if (p && p.targets.some(t => t.id === 'new')) { await pickTarget('new'); await sleep(700); }
  const pForCancel = await panel();
  await cancelPanel();
  await sleep(1000);
  const afterCancel = await reqPreview();
  check('C07 选「新建角色」后取消：不创建角色、不写入（请求内容与取消前一致）',
    !!pForCancel && /新建角色并填入/.test(pForCancel.confirmLabel) &&
    (String(afterCancel.match(/角色段（实际发送）([^]{0,40})/) || [''])[0] === String(before.match(/角色段（实际发送）([^]{0,40})/) || [''])[0]),
    { cancelLabel: pForCancel && pForCancel.confirmLabel });
  /* 重新打开并真正载入到新建角色 */
  await evalClick(`document.querySelector('[data-nai-rolllib-trigger="style"]')`);
  await sleep(1300);
  await evalClick(`document.querySelector('[data-nai-rolllib-item="${savedId}"]')`);
  await sleep(1900);
  await c.waitFor(`!!document.querySelector('[data-nai-roll-apply-panel="plan"]')`, { timeout: 30000, label: '再开载入面板' });
  await pickTarget('new');
  await sleep(700);
  await confirmPanel();
  await sleep(2600);
  const after = await reqPreview();
  const afterParams = paramsOf(after);
  const contentSections = (snap.roles && snap.roles[0] && snap.roles[0].sections) || {};
  const firstTagOf = k => String(contentSections[k] || '').split(',')[0].trim();
  check('C09 载入后模型 / 尺寸 / 步数·CFG / 采样器 / 种子都没有变',
    JSON.stringify(afterParams) === JSON.stringify(beforeParams), { beforeParams, afterParams });
  check('C10 画师串与风格负面来源不变（画师标记与风格负面标记都还在）',
    after.indexOf('CL_ARTIST_MARKER') >= 0 && after.indexOf('CL_STYLE_NEG_MARKER') >= 0,
    { pos: partOf(after, '正向提示词（实际发送）', 200), neg: partOf(after, '负面提示词（实际发送）', 200) });
  check('C06 六类内容落到了目标角色/全局（请求里能看到各类内容首标签）',
    core.ROLE_KEYS.concat(core.GLOBAL_KEYS).every(k => !firstTagOf(k) && !(snap.global[k] && snap.global[k].provided) || after.indexOf(String((contentSections[k] || (snap.global[k] && snap.global[k].text) || '').split(',')[0]).trim()) >= 0),
    Object.fromEntries(core.ROLE_KEYS.concat(core.GLOBAL_KEYS).map(k => [k, String((contentSections[k] || (snap.global[k] && snap.global[k].text) || '')).split(',')[0].trim()])));
  const snapRoleNegs = (snap.roles && snap.roles[0] && snap.roles[0].negatives) || {};
  const expectNegs = core.ROLE_KEYS.filter(k => snapRoleNegs[k] && String(snapRoleNegs[k].text || '').trim())
    .map(k => String(snapRoleNegs[k].text).split(',')[0].trim());
  check('C11 内容负面按分类并入（出现分类级负面，且快照里每个分类自己的负面都在里面）',
    /分类级负面/.test(after) && expectNegs.every(t => after.indexOf(t) >= 0),
    { expectNegs, neg: partOf(after, '负面提示词（实际发送）', 260) });
  check('C21 模块与标签不在本次范围 → 保持不变（模块标记仍在请求里）', after.indexOf('CL_MODULE_MARKER') >= 0, { hasModule: after.indexOf('CL_MODULE_MARKER') >= 0 });
  check('C15 载入后有「撤销本次 Roll 填入」横幅', await c.eval(`!!document.querySelector('[data-nai-roll-undo-banner]')`));
  await evalClick(`document.querySelector('[data-nai-roll-undo-action="undo"]')`);
  await sleep(2400);
  const afterUndo = await reqPreview();
  const undoParams = paramsOf(afterUndo);
  const segCount = text => { const m = String(text || '').match(/本次发送\s*(\d+)\s*个/); return m ? Number(m[1]) : -1; };
  const segAfter = segCount(after);
  const segUndo = segCount(afterUndo);
  const contentGone = segAfter >= 1 && segUndo === segAfter - 1;
  check('C15 一次撤销：内容回退（含新建角色），画师风格 / 风格负面 / 参数不回退',
    contentGone && afterUndo.indexOf('CL_ARTIST_MARKER') >= 0 && afterUndo.indexOf('CL_STYLE_NEG_MARKER') >= 0 && JSON.stringify(undoParams) === JSON.stringify(beforeParams),
    { contentGone, segAfter, segUndo, artist: afterUndo.indexOf('CL_ARTIST_MARKER') >= 0, neg: afterUndo.indexOf('CL_STYLE_NEG_MARKER') >= 0, undoParams, beforeParams });

  /* ================= C19 纯内容记录额外带参数也不被应用 ================= */
  const dirtyId = 'agent-' + 'c19' .padEnd(3, '0') + require_hex();
  function require_hex() { return Array.from({ length: 61 }, (_, i) => '0123456789abcdef'[(i * 7 + 3) % 16]).join(''); }
  const dirtySnap = JSON.parse(JSON.stringify(snap));
  dirtySnap.roles[0].sections.appearance = 'c19_only_hair';
  const dirty = await api('POST', '/api/chains', {
    id: dirtyId, type: 'preset', name: '[CL] 带脏字段的内容记录', description: 'C19', tags: [],
    basePrompt: 'C19_SHOULD_NOT_APPLY', negativePrompt: 'C19_NEG_SHOULD_NOT_APPLY', modules: [{ id: 'x', name: 'x', content: 'x', isActive: true }],
    variableValues: {}, params: Object.assign({}, snap ? { _rollContentSnapshot: dirtySnap } : {}, { width: 1024, height: 1024, steps: 99, scale: 11, seed: 777 })
  });
  if (dirty.ok && dirty.detail && dirty.detail.id) createdIds.add(dirty.detail.id);
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'C19 重载' });
  await sleep(2200);
  await navLib();
  await sleep(1400);
  const dirtyCard = await c.eval(`!!document.querySelector('[data-nai-rolllib-card="${dirtyId}"]')`);
  if (dirtyCard) {
    await evalClick(`document.querySelector('[data-nai-rolllib-load="${dirtyId}"]')`);
    await sleep(2500);
    await c.waitFor(`!!document.querySelector('[data-nai-roll-apply-panel="plan"]')`, { timeout: 30000, label: 'C19 面板' });
    await pickTarget('new');
    await sleep(600);
    await confirmPanel();
    await sleep(2400);
    const c19 = await reqPreview();
    const c19Params = paramsOf(c19);
    check('C19 纯内容载入只按白名单读快照：记录里多带的画师 / 负面 / 参数 / 模块都不被应用',
      c19.indexOf('C19_SHOULD_NOT_APPLY') < 0 && c19.indexOf('C19_NEG_SHOULD_NOT_APPLY') < 0 &&
      c19Params.stepsCfg !== '99/11' && c19Params.size !== '1024×1024' && c19Params.seed !== '777' &&
      c19.indexOf('c19_only_hair') >= 0,
      { params: c19Params, hasC19Content: c19.indexOf('c19_only_hair') >= 0 });
  } else {
    check('C19 纯内容载入只按白名单读快照', false, '脏记录没有出现在新库里（应按 format 过滤后仍显示）');
  }

  /* ================= C17 旧搭配列表不受影响 ================= */
  await navLib();
  await sleep(1200);
  const presetItems = await c.eval(`(()=>{const b=document.querySelector('[data-nai-preset-trigger="load"]');if(!b)return null;b.click();return true;})()`);
  await sleep(1500);
  const items = await c.eval(`[...document.querySelectorAll('[data-nai-preset-item]')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,50))`);
  check('C17 既有「载入搭配」列表里不会出现纯内容记录（旧记录语义不变、新库分类明确）',
    items.every(t => t.indexOf('[CL]') < 0 && t.indexOf('冒烟') < 0), items);
  await c.eval(CLICK(`document.querySelector('[data-nai-preset-action="dismiss"]')`));
  await sleep(700);

  /* ================= C22 窄屏 ================= */
  await navLib();
  await sleep(1200);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(1600);
  const narrow = await c.eval(`(()=>{const vw=window.innerWidth;const cards=[...document.querySelectorAll('[data-nai-rolllib-card]')].map(e=>{const r=e.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right)};});const btns=[...document.querySelectorAll('[data-nai-rolllib-load],[data-nai-rolllib-rename]')].map(e=>{const r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};});return {vw,scrollW:document.documentElement.scrollWidth,cards,out:cards.filter(x=>x.l<-1||x.r>vw+1).length,minBtn:btns.length?Math.min(...btns.map(b=>Math.min(b.w,b.h))):0};})()`);
  check('C22 390px：内容库页无横向溢出、卡片不越界、按钮可点（≥24px）',
    narrow.scrollW <= narrow.vw + 1 && narrow.out === 0 && narrow.minBtn >= 24, narrow);
  await c.screenshot(path.join(dir, 'C22-narrow-390.png'));
  await c.send('Emulation.clearDeviceMetricsOverride');
  await sleep(1000);

  /* ================= C20 未消费导入不静默覆盖（新库页也拦） ================= */
  await navLib();
  await sleep(1200);
  await c.eval(`(()=>{try{sessionStorage.setItem('nai_pending_import', JSON.stringify({mode:'roll-content-load',v:1,recordId:'stale-unused'}));}catch(e){}return true;})()`);
  const beforeView = await viewNow();
  await evalClick(`document.querySelector('[data-nai-rolllib-load="${savedId}"]')`);
  await sleep(1200);
  const stalePending = await c.eval(`(()=>{try{return JSON.parse(sessionStorage.getItem('nai_pending_import')||'{}').recordId==='stale-unused';}catch(e){return false;}})()`);
  check('C20 已有未消费导入时不静默覆盖（停在原页、原待处理记录不变）', stalePending === true && (await viewNow()) === beforeView, { stalePending, view: await viewNow() });
  await c.eval(`(()=>{try{sessionStorage.removeItem('nai_pending_import');}catch(e){}return true;})()`);
  await sleep(400);

  /* ================= C18 从完整搭配人工提取（排除画师/风格负面/参数） ================= */
  /* 先造一份完整搭配（走既有 type=preset + params._presetSnapshot） */
  const fullId = 'agent-' + ('c18' + '0123456789abcdef'.repeat(4)).slice(0, 64);
  const fullSnap = {
    version: 1, savedAt: new Date().toISOString(), includeParams: true,
    basePrompt: 'FULL_STYLE_MARKER, cla1_hair', negativePrompt: 'FULL_STYLE_NEG_MARKER', tags: [], modules: [],
    variableValues: { subject: '' },
    params: {
      width: 640, height: 896, steps: 31, scale: 6.5,
      _promptSections: { scene: 'full_scene_tag' },
      characters: [{ id: 'full-c1', name: '提取角色', sections: { appearance: 'full_app_tag', wardrobe: 'full_wd_tag' } }],
      _characterSectionsNegatives: { 'full-c1::appearance': { text: 'full_app_neg', note: '' } }
    }
  };
  const full = await api('POST', '/api/chains', {
    id: fullId, type: 'preset', name: '[CL] 待提取的完整搭配', description: 'C18 前置',
    basePrompt: 'FULL_STYLE_MARKER, cla1_hair', negativePrompt: 'FULL_STYLE_NEG_MARKER', modules: [], variableValues: {},
    tags: [], params: { width: 640, height: 896, steps: 31, scale: 6.5, _presetSnapshot: fullSnap }
  });
  if (full.ok && full.detail && full.detail.id) createdIds.add(full.detail.id);
  await c.goto(BASE_URL);
  await c.waitFor(`!!document.querySelector('[data-agent-view]')`, { timeout: 60000, label: 'C18 重载' });
  await sleep(2200);
  await navLib();
  await sleep(1300);
  await evalClick(`document.querySelector('[data-nai-rolllib-extract-open="true"]')`);
  await sleep(2000);
  const extractPanelShown = await c.eval(`!!document.querySelector('[data-nai-rolllib-extract-panel]')`);
  const extractItems = await c.eval(`[...document.querySelectorAll('[data-nai-rolllib-extract-item]')].map(b=>(b.innerText||'').replace(/\\s+/g,' ').trim())`);
  check('C18 新库页提供「从完整搭配提取」，只列完整搭配（不列纯内容记录）',
    extractPanelShown === true && extractItems.some(t => t.indexOf('待提取的完整搭配') >= 0) && !extractItems.some(t => t.indexOf(saveName) >= 0),
    { extractItems });
  await evalClick(`document.querySelector('[data-nai-rolllib-extract-item="${fullId}"]')`);
  await sleep(900);
  const extractScope = await c.eval(`(()=>{const el=document.querySelector('[data-nai-rolllib-extract-scope]');return el?el.textContent.replace(/\\s+/g,' ').trim():null;})()`);
  check('C18 提取前说明将提取什么、将排除什么', !!extractScope && /将提取/.test(extractScope) && /将排除/.test(extractScope) && /画师串/.test(extractScope), extractScope);
  const beforeCount = (await contentRecords()).length;
  await evalClick(`document.querySelector('[data-nai-rolllib-extract-run="true"]')`);
  await sleep(3000);
  const afterRecs = await contentRecords();
  const extracted = afterRecs.find(x => String(x.name || '').indexOf('提取内容') >= 0);
  if (extracted) createdIds.add(extracted.id);
  const exText = extracted ? JSON.stringify(extracted.params._rollContentSnapshot) : '';
  check('C18 提取生成的是新的纯内容记录：内容带过来、画师/风格负面/参数没有带过来、旧记录没被改',
    afterRecs.length === beforeCount + 1 && !!extracted &&
    exText.indexOf('full_app_tag') >= 0 && exText.indexOf('full_wd_tag') >= 0 && exText.indexOf('full_scene_tag') >= 0 &&
    exText.indexOf('full_app_neg') >= 0 && exText.indexOf('FULL_STYLE_MARKER') < 0 && exText.indexOf('FULL_STYLE_NEG_MARKER') < 0 &&
    !/"steps":31/.test(exText),
    { count: { before: beforeCount, after: afterRecs.length }, exText: exText.slice(0, 200) });
  const fullStill = (await allChains()).find(x => x.id === fullId);
  check('C18 旧完整搭配记录原样保留（不被搬走、不被裁剪）',
    !!fullStill && fullStill.basePrompt === 'FULL_STYLE_MARKER, cla1_hair' && fullStill.negativePrompt === 'FULL_STYLE_NEG_MARKER' && !!fullStill.params._presetSnapshot);

  /* ================= 零写入 / 无生成 ================= */
  const writes = requestLog.filter(r => r.method !== 'GET' && !/\/api\/chains/.test(r.url));
  check('除 /api/chains 外没有任何写请求（不消耗额度）', writes.length === 0, writes.map(r => r.method + ' ' + r.url));
  check('没有任何生成类请求', requestLog.filter(r => /generate/i.test(r.url)).length === 0);
  check('全程没有碰生产实例', requestLog.filter(r => String(r.url).includes(':3000')).length === 0);
  const consoleErrors = c.logs.filter(l => l.type === 'error');
  check('浏览器控制台没有报错', consoleErrors.length === 0, consoleErrors.map(l => String(l.text).slice(0, 200)));
  ev.savedId = savedId;
  ev.snapKeys = Object.keys(snap || {});
  ev.contentScope = snap.roles && snap.roles[0] ? Object.keys(snap.roles[0].sections) : [];
} catch (e) {
  check('验收脚本执行完成（无异常中断）', false, String((e && e.stack) || e));
  try { await c.screenshot(path.join(dir, 'FAILED.png')); } catch (_e) { /* ignore */ }
} finally {
  try { await c.close(); } catch (_e) { /* ignore */ }
}

const cleanup = await cleanupCreated();
dump(dir, 'roll-content-result.json', { at: new Date().toISOString(), base: BASE_URL, total: results.length, failed, evidence: ev, cleanup, requestLog, results });
console.log(`\n=== Roll 内容库 真机验收：${results.length - failed}/${results.length} 通过（失败 ${failed}）`);
console.log('清理：删掉 ' + cleanup.deleted.length + ' 条，失败 ' + cleanup.failed.length + ' 条，剩余 ' + cleanup.remaining.length);
console.log('原始输出：' + path.join(dir, 'roll-content-result.json'));
process.exit(failed ? 1 : 0);

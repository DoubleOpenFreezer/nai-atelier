/*
 * 一键 Roll · 纯逻辑核单元测试（v2，不接浏览器、不接数据库、不发请求）
 *
 *   node nai-atelier-testenv/tests/roll-core-suite.mjs
 *
 * 它同时校验三件事：
 *   ① 纯函数本身的行为（六库各抽 1 条 / 勾选 / 固定 / 空库 / 同随机码复现 / 单栏换一个 / 四态约束派生）；
 *   ② v2 算法约定（每栏独立随机流 → 固定某栏不影响其它栏；算法版本进证据）；
 *   ③ 线上 bundle 里注入的那份 core 与本文件 import 的 core **逐字节相同**
 *      —— 保证「测过的那份」就是「线上跑的那份」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDir, dump } from '../lib/env.mjs';
import core from '../../patches/roll/core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME = process.env.NAI_RUNTIME || 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const INDEX = path.join(RUNTIME, 'dist', 'assets', 'index-Dm65S2yO.js');
const CORE_FILE = path.join(HERE, '..', '..', 'patches', 'roll', 'core.mjs');
const BEGIN = '/* __NAI_ROLL_CORE_BEGIN__ */';
const END = '/* __NAI_ROLL_CORE_END__ */';

const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  :: ' + JSON.stringify(detail)}`);
}
function sliceCore(text) {
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < 0 || b < a) return null;
  return text.slice(a, b + END.length);
}

/* ---------------- 合成词库（六库 + 干扰类型） ---------------- */
/* 中英对照 / 四态的真实落点是 params._wardrobe.{bilingual,facets}（与生产条目一致）。 */
const mk = (type, id, name, basePrompt, bilingual, tags, extra) => ({
  type, id, name, basePrompt, tags,
  negativePrompt: (extra && extra.negativePrompt) || '',
  updatedAt: (extra && extra.updatedAt) || 1700000000000,
  params: { _wardrobe: Object.assign({ bilingual, references: [] }, extra && extra.facets ? { facets: extra.facets } : {}) }
});
const chains = [
  mk('style', 'style-1', '赛博串', 'cyberpunk, neon', '', ['a']),
  mk('preset', 'preset-1', '某搭配', 'x', '', []),
  mk('recording', 'rec-1', '干扰条目', 'y', '', []),
  mk('appearance', 'a-3', '金发少女', 'blonde_hair, long_hair, blue_eyes', 'blonde_hair（金发）, long_hair（长发）, blue_eyes（蓝瞳）', ['appearance'], { negativePrompt: 'bald' }),
  mk('appearance', 'a-1', '黑发少女', 'black_hair, short_hair', 'black_hair（黑发）, short_hair（短发）', []),
  mk('appearance', 'a-2', '银发少女', 'silver_hair, red_eyes', 'silver_hair（银发）, red_eyes（红瞳）', []),
  mk('wardrobe', 'w-1', '白裙', 'white_dress, straw_hat', 'white_dress（白色连衣裙）, straw_hat（草帽）', []),
  mk('wardrobe', 'w-2', '哥特', 'black_coat, boots', 'black_coat（黑色外套）, boots（靴子）', []),
  mk('pose', 'p-1', '站立', 'standing, looking_at_viewer', 'standing（站姿）, looking_at_viewer（看向镜头）', []),
  mk('pose', 'p-2', '坐姿', 'sitting, on_chair', 'sitting（坐姿）, on_chair（坐在椅子上）', []),
  mk('expression', 'e-1', '微笑', 'smile, closed_eyes', 'smile（微笑）, closed_eyes（闭眼）', []),
  mk('camera', 'c-1', '半身低角度', 'upper_body, from_below, depth_of_field', 'upper_body（半身）, from_below（低角度仰拍）, depth_of_field（浅景深）', []),
  mk('camera', 'c-2', '三分法', 'rule_of_thirds, wide_shot', '', []),
  /* 场景库故意留空 → 覆盖「某库为空」的真实边界（生产里表情/镜头库就是 0 条） */
];
/* 只有一条候选的库（单栏「换一个」的边界） */
const chainsSingle = chains.concat([mk('scene', 's-1', '唯一场景', 'indoor, night', 'indoor（室内）, night（夜晚）', [])]);

const ALL_ON = core.KINDS.reduce((acc, k) => { acc[k] = true; return acc; }, {});
const bySeed = (seed, extra) => core.draw(Object.assign({ chains, checks: ALL_ON, locked: {}, seed }, extra || {}));

/* ---------------- ① 池子 ---------------- */
{
  const pools = core.poolsOf(chains);
  check('六库都被识别，且只按 type 过滤（style/preset/recording 不进任何池）',
    Object.keys(pools).length === 6 &&
    core.KINDS.every(k => pools[k].every(c => c.type === k)) &&
    pools.appearance.length === 3 && pools.wardrobe.length === 2 && pools.pose.length === 2 &&
    pools.expression.length === 1 && pools.camera.length === 2 && pools.scene.length === 0,
    core.KINDS.map(k => k + '=' + pools[k].length).join(','));

  const shuffled = [chains[6], chains[3], chains[5], chains[4], chains[7], chains[8], chains[9], chains[10], chains[11], chains[12], chains[0], chains[1], chains[2]];
  const same = core.draw({ chains: shuffled, checks: ALL_ON, locked: {}, seed: 'fixed-seed-1' });
  const base = core.draw({ chains, checks: ALL_ON, locked: {}, seed: 'fixed-seed-1' });
  check('抽取结果与接口返回顺序无关（池子按 id 排序）',
    core.KINDS.every(k => base.picks[k].id === same.picks[k].id),
    core.KINDS.map(k => base.picks[k].id + '/' + same.picks[k].id).join(' '));
}

/* ---------------- ② 六库各抽 1 条 + 复现 ---------------- */
{
  const one = bySeed('seed-A');
  const two = bySeed('seed-A');
  const three = bySeed('seed-B');
  check('六栏都有结果行（不漏栏、不多栏）', core.KINDS.every(k => one.picks[k] && one.picks[k].kind === k));
  check('同一个随机码 → 同一个结果（可复现）',
    core.KINDS.every(k => one.picks[k].id === two.picks[k].id) &&
    JSON.stringify(core.evidenceOf(one)) === JSON.stringify(core.evidenceOf(two)));
  const diffCount = core.KINDS.filter(k => one.picks[k].id !== three.picks[k].id).length;
  check('不同随机码 → 结果会变（至少 1 栏不同）', diffCount >= 1, { diffCount });
  check('抽中的条目一定来自对应库的池子',
    core.KINDS.every(k => {
      const pool = core.poolOf(chains, k);
      const row = one.picks[k];
      return row.id === '' ? pool.length === 0 : pool.some(c => c.id === row.id);
    }));
  check('随机码与算法版本都进了记录', one.seed === 'seed-A' && one.algo === 'nai-roll-2' && core.evidenceOf(one).algo === 'nai-roll-2');
  check('记录里含抽中条目 id（可复现凭据）',
    core.KINDS.every(k => one.picks[k].id === '' || core.evidenceOf(one).picks[k].id === one.picks[k].id));
}

/* ---------------- ③ v2 算法：每栏独立随机流 ---------------- */
{
  const a = bySeed('seed-stream');
  const lockAppearance = a.picks.appearance.id;
  const b = core.draw({ chains, checks: ALL_ON, locked: { appearance: lockAppearance }, seed: 'seed-stream' });
  check('固定某一栏不会改变其它栏的结果（v2 每栏独立随机流的直接后果）',
    ['wardrobe', 'pose', 'expression', 'camera'].every(k => a.picks[k].id === b.picks[k].id),
    { appearance: [a.picks.appearance.id, b.picks.appearance.id], wardrobe: [a.picks.wardrobe.id, b.picks.wardrobe.id] });
  const c = core.draw({ chains, checks: Object.assign({}, ALL_ON, { pose: false }), locked: {}, seed: 'seed-stream' });
  check('取消某一栏的参与也不会改变其它栏的结果',
    ['appearance', 'wardrobe', 'expression', 'camera'].every(k => a.picks[k].id === c.picks[k].id));
  check('证据里每栏都带自己的随机流与候选池指纹',
    core.KINDS.every(k => typeof core.evidenceOf(Object.assign({ chains }, a)).seeds[k] === 'string' && /^[0-9a-f]{8}$/.test(core.evidenceOf(Object.assign({ chains }, a)).pools[k].fingerprint)),
    core.evidenceOf(Object.assign({ chains }, a)).pools);
  const renamed = chains.map(x => (x.id === 'a-1' ? Object.assign({}, x, { name: '黑发少女·改名' }) : x));
  check('池指纹对「改名」敏感（同随机码也不该当作同样的池）',
    core.evidenceOf({ chains: renamed, seed: 's' }).pools.appearance.fingerprint !== core.evidenceOf({ chains, seed: 's' }).pools.appearance.fingerprint);
}

/* ---------------- ④ 空库边界（生产真实场景） ---------------- */
{
  const one = bySeed('seed-empty');
  check('场景库 0 条 → 该栏留空 + 说明原因 + 不抛错',
    one.picks.scene.id === '' && one.picks.scene.reason === 'empty' &&
    one.picks.scene.poolSize === 0 && /0 条/.test(one.picks.scene.reasonText));
  check('空库不影响其它五栏照常抽出', core.KINDS.filter(k => k !== 'scene').every(k => !!one.picks[k].id));
  check('空库会回报一条 note（不静默）', one.notes.some(n => n.kind === 'scene' && n.code === 'pool_empty'));
  const allEmpty = core.draw({ chains: [], checks: ALL_ON, locked: {}, seed: 's' });
  check('全部库为空也不抛错，六栏都留空',
    core.KINDS.every(k => allEmpty.picks[k].id === '' && allEmpty.picks[k].reason === 'empty'));
  const noChains = core.draw({ chains: null, checks: null, locked: null });
  check('入参缺失（null）也不抛错', !!noChains && core.KINDS.every(k => noChains.picks[k].id === ''));
}

/* ---------------- ⑤ 勾选 ---------------- */
{
  const checks = Object.assign({}, ALL_ON, { camera: false, scene: false });
  const one = core.draw({ chains, checks, locked: {}, seed: 'seed-check' });
  check('取消勾选的库该栏留空 + 说明「本次未参与」',
    one.picks.camera.id === '' && one.picks.camera.reason === 'unchecked' &&
    one.picks.scene.reason === 'unchecked' && /未参与/.test(one.picks.camera.reasonText));
  check('取消勾选不影响其余四栏抽出', ['appearance', 'wardrobe', 'pose', 'expression'].every(k => !!one.picks[k].id));
  const allOff = core.draw({ chains, checks: core.KINDS.reduce((a, k) => { a[k] = false; return a; }, {}), locked: {}, seed: 'seed-check' });
  check('全部取消勾选 → 六栏都留空，不抛错', core.KINDS.every(k => allOff.picks[k].id === ''));
}

/* ---------------- ⑥ 固定（锁定） ---------------- */
{
  const first = bySeed('seed-lock');
  const locked = { appearance: first.picks.appearance.id, wardrobe: first.picks.wardrobe.id };
  const second = core.draw({ chains, checks: ALL_ON, locked, seed: 'seed-lock-2' });
  check('固定的项在重抽里原样保留（reason = 固定保留）',
    second.picks.appearance.id === first.picks.appearance.id &&
    second.picks.wardrobe.id === first.picks.wardrobe.id &&
    second.picks.appearance.reason === 'locked' && second.picks.appearance.locked === true);
  check('未固定的库真的换掉了（至少 1 栏变化）',
    ['pose', 'expression', 'camera'].some(k => second.picks[k].id !== first.picks[k].id),
    ['pose', 'expression', 'camera'].map(k => first.picks[k].id + '->' + second.picks[k].id));
  const stale = core.draw({ chains, checks: ALL_ON, locked: { appearance: 'gone-id' }, seed: 'seed-lock' });
  check('固定项已不在词库 → 重抽 + 回报 note（不是静默）',
    stale.picks.appearance.id !== '' && stale.picks.appearance.locked === false &&
    stale.notes.some(n => n.kind === 'appearance' && n.code === 'lock_missing'));
  check('固定不存在的 id 不会崩（空库 + 固定也不崩）',
    !!core.draw({ chains: [], checks: ALL_ON, locked: { camera: 'x' }, seed: 's' }));
}

/* ---------------- ⑦ 单栏「换一个」（P1 §6.1） ---------------- */
{
  const base = bySeed('seed-one');
  const pool2 = core.poolOf(chains, 'appearance').length;
  const r1 = core.rerollOne({ chains, checks: ALL_ON, picks: base.picks, locked: {} }, 'appearance', 'one-seed-1');
  check('「换一个」只返回该栏的新条目，且一定与当前不同（候选 >1，排除当前项）',
    r1.ok && r1.row.kind === 'appearance' && r1.row.id !== base.picks.appearance.id && pool2 > 1,
    { from: base.picks.appearance.id, to: r1.row.id, pool2 });
  const r2 = core.rerollOne({ chains, checks: ALL_ON, picks: Object.assign({}, base.picks, { appearance: r1.row }), locked: {} }, 'appearance', 'one-seed-2');
  check('再换一次仍然换掉上一个（每次排除当前项，不靠重试）',
    r2.ok && r2.row.id !== r1.row.id, { first: base.picks.appearance.id, r1: r1.row.id, r2: r2.row.id });
  const basePose = base.picks.pose.id;
  const pr1 = core.rerollOne({ chains, checks: ALL_ON, picks: base.picks, locked: {} }, 'pose', 'pose-a');
  const pr2 = core.rerollOne({ chains, checks: ALL_ON, picks: Object.assign({}, base.picks, { pose: pr1.row }), locked: {} }, 'pose', 'pose-b');
  check('两候选池：换一个必定换成另一条（确定性，不需要「重试到变化」）',
    pr1.ok && pr1.row.id !== basePose && pr2.ok && pr2.row.id === basePose,
    { base: basePose, first: pr1.row.id, second: pr2.row.id });
  const lockedNow = core.rerollOne({ chains, checks: ALL_ON, picks: base.picks, locked: { appearance: base.picks.appearance.id } }, 'appearance', 'one-seed-3');
  check('固定栏的「换一个」被拒（不能背地绕过固定）', !lockedNow.ok && lockedNow.code === 'locked' && /固定/.test(lockedNow.message), lockedNow.message);
  const single = core.rerollOne({ chains: chainsSingle, checks: ALL_ON, picks: bySeed('s2').picks, locked: {} }, 'scene', 'one-seed-4');
  check('候选只有 1 条 → 明确说「只有 1 条候选」，不让用户反复无效点击', !single.ok && single.code === 'single' && /只有 1 条/.test(single.message), single.message);
  const empty = core.rerollOne({ chains, checks: ALL_ON, picks: base.picks, locked: {} }, 'scene', 'one-seed-5');
  check('空库的「换一个」给出「去添加」的理由', !empty.ok && empty.code === 'empty' && /先去添加/.test(empty.message), empty.message);
  const off = core.rerollOne({ chains, checks: Object.assign({}, ALL_ON, { pose: false }), picks: base.picks, locked: {} }, 'pose', 'one-seed-6');
  check('未参与栏的「换一个」被拒并说明先勾选', !off.ok && off.code === 'unchecked' && /未参与/.test(off.message), off.message);
  check('未知分类被拒（不猜）', !core.rerollOne({ chains, checks: ALL_ON, picks: base.picks, locked: {} }, 'nope', 'x').ok);
  check('「换一个」不改变其它五栏（返回里只有该栏）',
    Object.keys(r1).filter(k => k === 'row').length === 1 && r1.row.kind === 'appearance');
}

/* ---------------- ⑧ 复现（同随机码 + 记录里的 id） ---------------- */
{
  const first = bySeed('seed-replay');
  const again = core.replay({ chains, checks: ALL_ON }, first);
  check('replay：条目都还在 → 逐栏原样还原（reason = 按上次记录还原）',
    core.KINDS.every(k => again.picks[k].id === first.picks[k].id) &&
    core.KINDS.every(k => again.picks[k].reason === (first.picks[k].id ? 'replay' : first.picks[k].reason)) &&
    again.restored >= 1 && again.redrawn === 0,
    { restored: again.restored, redrawn: again.redrawn });

  const shrunk = chains.filter(c => c.id !== first.picks.appearance.id);
  const drifted = core.replay({ chains: shrunk, checks: ALL_ON }, first);
  check('replay：条目被删 → 该栏重抽 + 回报 note',
    drifted.picks.appearance.id !== '' &&
    drifted.notes.some(n => n.kind === 'appearance' && n.code === 'entry_missing') &&
    drifted.redrawn >= 1);
  check('replay：同一个随机码仍然确定（重放两次结果一致）',
    JSON.stringify(core.evidenceOf(core.replay({ chains: shrunk, checks: ALL_ON }, first))) ===
    JSON.stringify(core.evidenceOf(drifted)));
  const legacy = { seed: 'legacy-seed', picks: first.picks, locked: {} };
  check('旧记录（没有 algo / 没有每栏随机流）仍能按 id 还原，并被标成 nai-roll-1',
    core.KINDS.every(k => core.replay({ chains, checks: ALL_ON }, legacy).picks[k].id === first.picks[k].id) &&
    core.replay({ chains, checks: ALL_ON }, legacy).algo === 'nai-roll-1');
}

/* ---------------- ⑨ 四态 / 约束派生（需求 §四） ---------------- */
{
  const rich = mk('wardrobe', 'w-x', '带四态', 'black_coat, boots', 'black_coat（黑色外套）', [], {
    facets: { accessory: '__none__', hair: '__auto__', material: { value: 'lace' }, mystery_key: 'nonsense' }
  });
  const c = core.constraintsOf(rich);
  check('四态：「明确没有」被识别为缺席约束（不猜、不编）',
    c.absent.length === 1 && c.absent[0].key === 'accessory' && c.absent[0].label === '配饰' && c.absent[0].known === true, c.absent);
  check('四态：「自动搭配」与具体值分开记，值原样保留（结构化取值也取得出来）',
    c.auto.length === 1 && c.auto[0].key === 'hair' &&
    c.values.some(v => v.key === 'material' && v.value === 'lace' && v.legacyShape === true && v.known === true),
    { auto: c.auto, values: c.values });
  check('四态：读不懂的键标「结构待确认」并要求复核，不静默丢弃',
    c.unknown.includes('mystery_key') && c.needsReview === true && /结构待确认/.test(c.notes), { unknown: c.unknown, notes: c.notes });
  check('四态：notes 里写明缺席约束与自动搭配（给用户看）',
    /明确没有/.test(c.notes) && /自动搭配/.test(c.notes), c.notes);
  check('四态：原文副本原样保留（缺席/自动的哨兵值不被改写）',
    JSON.stringify(c.facets.accessory) === '"__none__"' && JSON.stringify(c.facets.material) === '{"value":"lace"}', c.facets);
  const plain = core.constraintsOf(chains.find(x => x.id === 'a-1'));
  check('没有四态的旧条目 → 不编造、不需要复核', plain.absent.length === 0 && plain.values.length === 0 && plain.needsReview === false && plain.notes === '');
  const legacyShape = core.constraintsOf({ params: { _wardrobe: { facets: { kind: 'specified', color: 'auto', material: { value: 'lace' }, length: 'none' } } } });
  check('旧形状四态：原文原样保留（不补写、不重分类），只把读不懂的键标待确认',
    legacyShape.values.length >= 2 && legacyShape.needsReview === true &&
    JSON.stringify(legacyShape.facets.material) === '{"value":"lace"}' &&
    legacyShape.unknown.includes('kind') && !legacyShape.absent.length, legacyShape);
  const row = core.rowOf(rich, 'wardrobe', 'ok', false, 1);
  check('结果行带负面与约束说明（P0「完整传递约束」的输入）',
    row.negative === '' && row.text === 'black_coat, boots' && /明确没有/.test(row.constraintNotes));
  const negRow = core.rowOf(chains.find(x => x.id === 'a-3'), 'appearance', 'ok', false, 3);
  check('结果行带条目自己的负面提示词', negRow.negative === 'bald', negRow.negative);
}

/* ---------------- ⑩ 只读：绝不改写词库条目 ---------------- */
{
  const before = JSON.stringify(chains);
  const frozen = chains.map(c => Object.freeze(Object.assign({}, c, { params: Object.freeze(c.params) })));
  let threw = null;
  try {
    const one = core.draw({ chains: frozen, checks: ALL_ON, locked: { appearance: 'a-1' }, seed: 'seed-ro' });
    core.replay({ chains: frozen, checks: ALL_ON }, one);
    core.rerollOne({ chains: frozen, checks: ALL_ON, picks: one.picks, locked: {} }, 'appearance', 'x');
    core.toSections(one.picks);
    core.describe(one);
    core.evidenceOf(one);
    core.constraintsOf(frozen[3]);
    core.snapshotOf(one.picks.appearance);
  } catch (e) { threw = String((e && e.message) || e); }
  check('抽中的条目只读：结果行是派生副本，冻结输入也能跑，且输入 JSON 未变',
    threw === null && JSON.stringify(chains) === before, threw);
  const one = bySeed('seed-ro2');
  check('结果行不是词库条目对象本身',
    core.KINDS.every(k => !one.picks[k].id || one.picks[k] !== chains.find(c => c.id === one.picks[k].id)));
  const zh = core.summaryOf(chains.find(c => c.id === 'a-3'));
  const en = core.summaryOf(chains.find(c => c.id === 'c-2'));
  check('摘要规则：有中文用中文、没中文用英文并标 englishOnly',
    zh.englishOnly === false && /金发/.test(zh.text) && en.englishOnly === true && /rule_of_thirds/.test(en.text),
    { zh, en });
  const snap = core.snapshotOf(one.picks.appearance);
  check('条目快照（R13）：id/名字/正文/负面/更新时刻都在，改名改内容也不影响已存快照',
    !!snap.entryId && !!snap.name && !!snap.text && snap.updatedAt === 1700000000000, snap);
}

/* ---------------- ⑪ 填入实验室的落点 ---------------- */
{
  const one = bySeed('seed-sec');
  const sec = core.toSections(one.picks);
  check('场景环境 / 镜头画面 → 全局两栏；四个角色类 → 角色栏位',
    typeof sec.global === 'object' && typeof sec.character === 'object' &&
    Object.keys(sec.global).every(k => k === 'scene' || k === 'camera') &&
    Object.keys(sec.character).every(k => ['appearance', 'wardrobe', 'pose', 'expression'].includes(k)),
    { global: Object.keys(sec.global), character: Object.keys(sec.character) });
  check('空库 / 未勾选的栏位不会被写进落点（不覆盖实验室里原有的内容）',
    sec.global.scene === undefined && sec.written.indexOf('scene') < 0);
  check('落点里只有本次真的抽到内容的栏位，且内容是英文提示词',
    sec.written.every(k => one.picks[k].filled && (sec.global[k] === one.picks[k].text || sec.character[k] === one.picks[k].text)),
    sec.written);
  const desc = core.describe(one);
  check('describe 六栏齐全且能一眼看出空栏原因', /场景：/.test(desc) && /0 条/.test(desc), desc);
  check('samePicks：逐栏 id 全等才算「同一组」',
    core.samePicks(one.picks, one.picks) === true &&
    core.samePicks(one.picks, Object.assign({}, one.picks, { pose: one.picks.wardrobe })) === false);
}

/* ---------------- ⑫ Roll 内容搭配库（纯内容快照 · 白名单） ---------------- */
{
  const rec = {
    seed: 'content-seed', seeds: { appearance: 'x1' }, checks: { appearance: true, wardrobe: true, pose: false, expression: true, scene: true, camera: false },
    locks: { wardrobe: 'w-1' },
    picks: {
      appearance: { kind: 'appearance', id: 'a-3', filled: true, name: '金发少女', text: 'blonde_hair, blue_eyes', negative: 'bald', constraintNotes: '', meta: { source: 'library', entryId: 'a-3', entryName: '金发少女', entryBilingual: 'blonde_hair（金发）' } },
      wardrobe: { kind: 'wardrobe', id: 'w-1', filled: true, name: '白裙', text: 'white_dress', negative: '', constraintNotes: '明确没有：配饰（条目声明的缺席约束）', meta: null },
      pose: { kind: 'pose', id: '', filled: false, name: '', text: '', negative: '', constraintNotes: '' },
      expression: { kind: 'expression', id: 'e-1', filled: true, name: '微笑', text: 'smile', negative: '', constraintNotes: '' },
      scene: { kind: 'scene', id: 's-1', filled: true, name: '雨夜', text: 'rain, night', negative: 'indoor', constraintNotes: '', meta: null },
      camera: { kind: 'camera', id: '', filled: false, name: '', text: '', negative: '', constraintNotes: '' }
    }
  };
  const snap = core.contentSnapshotOf(rec, '2026-10-18T00:00:00.000Z');
  check('内容快照：格式/版本/时间/算法/证据都在', !!snap && snap.format === 'nai-roll-content' && snap.version === 1 && snap.savedAt === '2026-10-18T00:00:00.000Z' && snap.algo === 'nai-roll-2' && !!snap.roll && typeof snap.roll.seed === 'string', snap && Object.keys(snap));
  check('内容快照：只有 roles / global / roll，没有画师串 / 风格负面 / 参数', !!snap && !('basePrompt' in snap) && !('negativePrompt' in snap) && !('params' in snap) && !('style' in snap) && !('modules' in snap));
  const only = JSON.stringify(Object.assign({}, snap, { roll: undefined }));
  check('内容快照里没有模型/采样器/步数/CFG/尺寸/张数字段', !/"(model|sampler|steps|scale|width|height|n_samples)"/.test(only), only.slice(0, 140));
  const role0 = snap.roles[0];
  check('角色内容与内容负面按分类独立记账', !!role0 && !!role0.sections.appearance && !!role0.negatives.appearance, role0 && { sections: Object.keys(role0.sections), negatives: Object.keys(role0.negatives) });
  check('全局内容单独记账（scene 有内容 → provided=true）', snap.global.scene && snap.global.scene.provided === true && !!snap.global.scene.text);
  /* 白名单读取：多带的字段不被读进来 */
  const dirty = JSON.parse(JSON.stringify(snap));
  dirty.basePrompt = 'DIRTY_ARTIST'; dirty.negativePrompt = 'DIRTY_NEG'; dirty.params = { steps: 99, seed: 777 }; dirty.style = { id: 'x' };
  dirty.roles[0].sections.camera = 'should_not_exist'; dirty.global.camera = { provided: true, text: 'DIRTY_CAMERA' };
  const read = core.contentRead(dirty);
  check('白名单读取：多余字段（画师/负面/参数/未知分类）都不进入载入计划',
    read.ok === true && !JSON.stringify(read).includes('DIRTY_ARTIST') && !JSON.stringify(read).includes('DIRTY_NEG') && !JSON.stringify(read).includes('99'),
    Object.keys(read));
  check('白名单读取：角色只认四类、全局只认两类（未知键不出现）',
    !read.roles[0].sections.camera && read.global.camera.provided === true && !!read.global.camera.text);
  check('白名单读取：未提供的分类保留 provided=false（不猜、不清空）',
    core.ROLE_KEYS.filter(k => !read.roles[0].provided[k]).every(k => read.roles[0].sections[k] === undefined));
  check('白名单读取：格式不对的记录拒绝按纯内容载入', core.contentRead({ format: 'other', roles: [] }).ok === false);
  check('白名单读取：结构版本不同时给提示但仍按已知字段读', (() => { const v = JSON.parse(JSON.stringify(snap)); v.version = 9; const r = core.contentRead(v); return r.ok === true && r.warnings.some(w => /结构版本/.test(w)); })());
  check('空内容快照返回 null（阻止创建空记录）', core.contentSnapshotOf({ picks: {}, checks: {} }, '') === null);
  check('isContentRecord 只认纯内容记录（完整搭配 / 普通词库条目都不算）',
    core.isContentRecord({ params: { _rollContentSnapshot: snap } }) === true &&
    core.isContentRecord({ params: { _presetSnapshot: { version: 1 } } }) === false &&
    core.isContentRecord({ params: {} }) === false);
  const scope = core.contentScopeOf(core.contentRead(snap));
  check('卡片范围摘要列出实际提供的分类', /角色：/.test(scope.label) && scope.roleKinds.length >= 1, scope);
  /* 从旧完整搭配提取：只取内容，排除风格与参数 */
  const legacySnap = {
    basePrompt: 'STYLE_ONLY', negativePrompt: 'STYLE_NEG', version: 1,
    params: { width: 640, steps: 31, _promptSections: { scene: 'legacy_scene' }, characters: [{ id: 'c1', name: 'A', sections: { appearance: 'app_only' } }], _characterSectionsNegatives: { 'c1::appearance': { text: 'app_neg', note: '' } } }
  };
  const extracted = core.contentFromPresetSnapshot(legacySnap, 'x');
  const exText = JSON.stringify(Object.assign({}, extracted, { extracted: undefined }));
  check('从旧完整搭配人工提取：只取六类内容与其负面，排除画师串与参数',
    !!extracted && exText.indexOf('app_only') >= 0 && exText.indexOf('app_neg') >= 0 && exText.indexOf('legacy_scene') >= 0 &&
    exText.indexOf('STYLE_ONLY') < 0 && exText.indexOf('STYLE_NEG') < 0 && !/"steps"/.test(exText), exText.slice(0, 160));
  const frozenSnap = Object.freeze({ format: 'nai-roll-content', version: 1, roles: Object.freeze([Object.freeze({ provided: { appearance: true }, sections: Object.freeze({ appearance: 'x' }), negatives: {}, meta: {} })]), global: Object.freeze({ scene: Object.freeze({ provided: false }), camera: Object.freeze({ provided: false }) }) });
  let threw2 = null;
  try { core.contentRead(frozenSnap); core.contentScopeOf(core.contentRead(frozenSnap)); } catch (e) { threw2 = String((e && e.message) || e); }
  check('只读：冻结的快照也能读，且不修改入参', threw2 === null && frozenSnap.roles[0].sections.appearance === 'x', threw2);
}

/* ---------------- ⑬ 线上那份 core 与本文件同一份 ---------------- */
{
  let same = false;
  let detail = null;
  try {
    const shipped = sliceCore(fs.readFileSync(INDEX, 'utf8'));
    const local = sliceCore(fs.readFileSync(CORE_FILE, 'utf8'));
    same = !!shipped && shipped === local;
    detail = { shippedLen: shipped ? shipped.length : 0, localLen: local ? local.length : 0 };
  } catch (e) { detail = String((e && e.message) || e); }
  check('线上 bundle 内注入的 core 与 patches/roll/core.mjs 逐字节一致', same, detail);
}

const dir = runDir('roll-core-suite');
dump(dir, 'roll-core-suite.json', {
  at: new Date().toISOString(),
  total: results.length,
  failed,
  results: results.map(r => ({ name: r.name, ok: r.ok, detail: r.detail }))
});
console.log(`\n=== 一键 Roll 纯逻辑核：${results.length - failed}/${results.length} 通过（失败 ${failed}）`);
console.log('原始输出：' + path.join(dir, 'roll-core-suite.json'));
process.exit(failed ? 1 : 0);

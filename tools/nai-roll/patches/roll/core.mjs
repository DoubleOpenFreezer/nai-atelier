/*
 * 一键 Roll · 纯逻辑核（v2）
 * ---------------------------------------------------------------------------
 * 这里是「一键 Roll」的全部随机 / 池子 / 摘要 / 条目约束派生逻辑：
 * **不碰 DOM、不碰 React、不发请求、不写任何存储、没有副作用**。
 * 因此它可以被 node 直接 import 做单元测试（见 tests/roll-core-suite.mjs）。
 *
 * patches/apply-roll.mjs 会把 `__NAI_ROLL_CORE_BEGIN__` 与 `__NAI_ROLL_CORE_END__`
 * 之间的**原文逐字节**注入 dist 的 index 主 bundle，并在自检里比对
 * 「注入的文本 === 本文件同一区间的文本」，所以「跑测试的那份」与「线上跑的那份」
 * 不可能各改一处而不被发现。
 *
 * v2 相对 v1 的三处算法变化（都记进证据，见 ALGO）：
 *   1) 每一栏派生**独立随机流**（seed + '#' + kind）→「某栏被锁定/跳过」不再改变
 *      其它栏的结果；v1 是顺序消耗同一个流。
 *   2) 记录里带 `algo`；旧记录（无 algo）按 'nai-roll-1' 解释，且只做「按 id 还原」。
 *   3) 「再抽」支持**排除当前条目**（avoid），候选不足时如实保留并说明，不做无限重试。
 *
 * 边界（需求点名的）：某库为空 / 取消勾选 / 锁定项已不在词库 → 留空或重抽 + 说明原因，
 * 不抛错、不卡住、不静默。
 *
 * 明确不做：不直接出图（只产出组合）、不新建表 / 接口、不改写词库条目
 * （抽中的条目对象只被读取；本模块返回的是**派生出来的纯数据副本**）。
 */

/* __NAI_ROLL_CORE_BEGIN__ */
const __naiRollCore = (() => {
  /* 算法版本：同 seed 复现必须连算法版本一起限定。 */
  const ALGO = 'nai-roll-2';
  const LEGACY_ALGO = 'nai-roll-1';
  /* 六个库 + 界面顺序。type 常量沿用旧标识，不新增、不改名： */
  const KINDS = ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera'];
  const META = {
    appearance: { short: '形象', title: '人物形象', scope: 'character' },
    wardrobe: { short: '服饰', title: '服饰穿搭', scope: 'character' },
    pose: { short: '动作', title: '动作互动', scope: 'character' },
    expression: { short: '表情', title: '表情状态', scope: 'character' },
    scene: { short: '场景', title: '场景环境', scope: 'global' },
    camera: { short: '镜头', title: '镜头画面', scope: 'global' }
  };
  const REASON = {
    ok: '抽中',
    locked: '固定保留',
    replay: '按上次记录还原',
    unchecked: '本次未参与（该栏留空）',
    empty: '该库当前 0 条，该栏留空',
    single: '候选只有 1 条，无法换'
  };
  /* 四态哨兵（与 WardrobeLibrary.js 的 FACET_* 字面量一致，不另造） */
  const FACET_AUTO = '__auto__';
  const FACET_NONE = '__none__';
  const FACET_AUTO_LABEL = '自动搭配';
  const FACET_NONE_LABEL = '明确没有';
  /* 四态属性 → 中文标签。取自 WardrobeLibrary.js 六份配置的 facetLabels（104 项，抽取脚本一次性同步，不 import） */
  const FACET_LABELS = {
    accessory: '配饰', accessory_color: '配饰颜色', activity: '活动', age: '年龄阶段', angle: '俯仰角', arms: '手臂／手部',
    background_crowd: '背景人群', bangs: '刘海', blush: '脸红', body: '体型', bottom: '下装', bottom_color: '下装颜色',
    breasts: '胸部·大小', breasts_shape: '胸部·形态', brow: '眉部', clarity: '清晰度', composition: '构图', cut: '版型',
    direction: '方位（拍摄方向）', dof: '景深', effect: '成像效果', emotion: '情绪基调', env_event: '环境元素与事件', expression: '可见表情',
    expression_combo: '组合表情', eye_glow: '发光瞳', eye_left: '瞳色·左眼', eye_right: '瞳色·右眼', eye_tone: '瞳色构成', eyes: '瞳色',
    eyes_shape: '眼型', eyes_state: '眼睛状态（含眯眼／半睁眼）', facing: '身体朝向', facing_ref: '朝向参照', focus: '对焦对象', footwear: '鞋子',
    footwear_color: '鞋子颜色', gaze: '视线目标', gender: '穿着对象', gesture: '单人手势', hair: '发色', hair_cut: '发型·剪裁',
    hair_detail: '发型·细节', hair_length: '发型·长度', hair_second: '发色·副色', hair_texture: '发型·发质', hair_tone: '发色构成',
    hair_updo: '发型·扎发方式', head: '头部方向', height: '身高', hold: '手持物', hold_hand: '持握手（左右手）', interaction: '人与人互动',
    layering: '穿着层次', legs: '腿部动作', legwear: '袜饰', legwear_color: '袜饰颜色', length: '长度', light: '光源',
    light_dir: '光源方向', light_intensity: '光源强度', light_softness: '光源软硬', material: '材质', mood: '环境氛围', motion: '运动趋势',
    mouth: '嘴部', occasion: '场合（选衣条件）', onesie: '连体装／连衣裙', onesie_color: '连体装颜色', outer: '外套', outer_color: '外套颜色',
    outfit_scope: '生成范围', palette: '全图配色（旧·抽象色调）', pattern: '纹样', perspective: '透视', posture: '基础姿态',
    presentation: '外观呈现', props: '陈设与环境元素', roll: '画面倾斜', season: '季节（选衣条件）', season_signs: '季节标志物', shot: '景别（取景范围）',
    skin: '肤色', sleeve: '袖型', spot: '地点与室内外', style: '风格', subject: '角色数量（全局）', subject_gender: '性别组成',
    support: '接触／支撑物', sweat: '汗水', target: '作用角色', tears: '眼泪', temp_body: '身体与衣物的临时状态', temp_hair: '头发临时状态',
    tilt: '身体倾斜', time: '时间', top: '上装', top_color: '上装颜色', traits: '固有特征', translucency: '材质·透光', viewpoint: '视点',
    waist: '腰线', wear_state: '穿着状态', weather: '天气'
  };
  const facetLabel = key => FACET_LABELS[String(key)] || String(key);
  const clip = (value, max) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const limit = Number(max) > 0 ? Number(max) : 96;
    return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
  };
  const isObj = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const listOf = value => {
    if (value == null) return [];
    if (Array.isArray(value)) return value.map(x => String(x == null ? '' : x).trim()).filter(Boolean);
    const text = String(value).trim();
    return text ? [text] : [];
  };
  const splitTags = value => String(value == null ? '' : value).split(/[,，]/).map(x => String(x).trim()).filter(Boolean);
  const probeTag = value => String(value == null ? '' : value).trim().toLowerCase().replace(/[_\s]+/g, ' ');
  /* 去重合并（与实验室 negMerge 同一口径：按归一化 tag 去重、逗号连接） */
  const joinTags = (...lists) => {
    const out = [];
    const seen = new Set();
    for (const list of lists) {
      for (const tag of splitTags(list)) {
        const probe = probeTag(tag);
        if (!probe || seen.has(probe)) continue;
        seen.add(probe);
        out.push(tag);
      }
    }
    return out.join(', ');
  };

  /* ---- 词库条目读取（只读派生，绝不改写条目） ---- */
  const metaOf = chain => (chain && isObj(chain.params) && isObj(chain.params._wardrobe) ? chain.params._wardrobe : {});
  const idOf = chain => String((chain && chain.id) || '');
  const nameOf = chain => {
    const name = String((chain && chain.name) || '').trim();
    return name || '（未命名条目）';
  };
  /* 英文提示词 = 词库条目的 basePrompt（与库卡片、卡片摘要同一来源）。 */
  const textOf = chain => String((chain && chain.basePrompt) || '').replace(/\s+/g, ' ').trim();
  const negativeOf = chain => String((chain && chain.negativePrompt) || '').replace(/\s+/g, ' ').trim();
  const bilingualOf = chain => String(metaOf(chain).bilingual || '');
  const tagsOf = chain => (Array.isArray(chain && chain.tags) ? chain.tags : []).map(t => String(t || '').trim()).filter(Boolean);
  const descriptionOf = chain => String((chain && chain.description) || '');
  const previewOf = chain => String((chain && chain.previewImage) || '');
  const updatedAtOf = chain => {
    const at = Number(chain && chain.updatedAt);
    return Number.isFinite(at) && at > 0 ? at : null;
  };
  const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
  /* 中英对照里挑出中文（与 WardrobeLibrary 卡片摘要同一套规则，不另造一套）。 */
  const chineseOf = bilingual => String(bilingual == null ? '' : bilingual).split(/[,，]/).map(part => {
    const text = String(part).trim();
    if (!text) return '';
    const matched = text.match(/[（(]([^）)]*)[）)]\s*$/);
    if (matched) return CJK.test(matched[1]) ? String(matched[1]).trim() : '';
    return !/[a-z]/i.test(text) && CJK.test(text) ? text : '';
  }).filter(Boolean);
  /* 摘要：优先中文说明，其次中英对照里的中文，最后回落英文标签。 */
  const summaryOf = chain => {
    const chinese = chineseOf(bilingualOf(chain));
    if (chinese.length) return { text: clip(chinese.join('、'), 96), englishOnly: false };
    const english = String(bilingualOf(chain) || textOf(chain)).split(/[,，]/).map(p => p.trim()).filter(Boolean);
    if (!english.length) return { text: '', englishOnly: false };
    return { text: clip(english.slice(0, 6).join('、'), 96), englishOnly: true };
  };

  /* ---- 四态 → 约束/备注（不猜不编：只搬运条目已声明的状态） ----
   * 返回 { facets（原文副本，绝不回写）, absent[]（明确没有）, auto[]（自动搭配）, values[]（具体值）,
   *        unknown[]（读不懂的键或形状）, notes（中文说明）, needsReview }
   * 关键：**只读取**条目字段；读不懂的键/形状标 unknown，不猜成「不指定」，也不补写四态。
   */
  const constraintsOf = chain => {
    const raw = metaOf(chain).facets;
    const absent = [];
    const auto = [];
    const values = [];
    const unknown = [];
    const facets = {};
    if (isObj(raw)) {
      for (const key of Object.keys(raw)) {
        const value = raw[key];
        const known = Object.prototype.hasOwnProperty.call(FACET_LABELS, key);
        const label = facetLabel(key);
        /* 原文照抄（数组/对象浅拷贝一份），保证「旧结构原样保留」 */
        facets[key] = Array.isArray(value) ? value.slice() : (isObj(value) ? Object.assign({}, value) : value);
        const items = Array.isArray(value) ? value : [value];
        let classified = 0;
        for (const item of items) {
          if (item == null) continue;
          if (isObj(item)) {
            /* 旧形状：{value:'lace'} 这类结构化取值 —— 取出 value，但仍标记为旧结构 */
            const inner = String(item.value == null ? '' : item.value).trim();
            if (inner === FACET_NONE) { absent.push({ key, label, known }); classified++; continue; }
            if (inner === FACET_AUTO) { auto.push({ key, label, known }); classified++; continue; }
            if (inner) { values.push({ key, label, known, value: inner, legacyShape: true }); classified++; continue; }
            unknown.push(key);
            continue;
          }
          const text = String(item).trim();
          if (!text) continue;
          if (text === FACET_NONE) { absent.push({ key, label, known }); classified++; continue; }
          if (text === FACET_AUTO) { auto.push({ key, label, known }); classified++; continue; }
          values.push({ key, label, known, value: text });
          classified++;
        }
        if (!known || (!classified && items.length)) unknown.push(key);
      }
    }
    const unknownKeys = [...new Set(unknown)];
    const notes = [];
    if (absent.length) notes.push('明确没有：' + absent.map(a => (a.known ? a.label : a.key)).join('、') + '（条目声明的缺席约束）');
    if (auto.length) notes.push('自动搭配：' + auto.map(a => (a.known ? a.label : a.key)).join('、') + '（未指定具体值）');
    if (unknownKeys.length) notes.push('结构待确认：' + unknownKeys.join('、') + '（这条目的四态键或形状不在已知表里，原文原样保留，不猜测、不回写）');
    return {
      facets,
      absent,
      auto,
      values,
      unknown: unknownKeys,
      notes: notes.join('；'),
      needsReview: unknownKeys.length > 0
    };
  };

  /* ---- 池子 ---- */
  /* 按 type 取池；按 id 排序 → 抽取结果与接口返回顺序无关（可复现的前提）。 */
  const poolOf = (chains, kind) => {
    const list = Array.isArray(chains) ? chains : [];
    const out = [];
    for (const chain of list) {
      if (!chain || String(chain.type || '') !== String(kind)) continue;
      if (!idOf(chain)) continue;
      out.push(chain);
    }
    out.sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
    return out;
  };
  const poolsOf = chains => {
    const out = {};
    for (const kind of KINDS) out[kind] = poolOf(chains, kind);
    return out;
  };
  /* 候选池指纹：池变化（新增/删除/改名/改内容）时能一眼看出「同随机码也不该给同样结果」 */
  const shortHash = text => {
    let hash = 5381;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) hash = ((hash * 33) ^ s.charCodeAt(i)) >>> 0;
    return hash.toString(16).padStart(8, '0');
  };
  const poolFingerprint = pool => {
    const rows = (Array.isArray(pool) ? pool : []).map(c => [
      idOf(c), updatedAtOf(c) || 0, nameOf(c), shortHash(textOf(c)), shortHash(negativeOf(c))
    ].join(':'));
    return shortHash(rows.join('|'));
  };

  /* ---- 可复现的随机数：seed 字符串 → FNV-1a → mulberry32 ---- */
  const normalizeSeed = seed => {
    const text = String(seed == null ? '' : seed).trim();
    return text || 'r0';
  };
  const hashSeed = seed => {
    const text = normalizeSeed(seed);
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  };
  const rngOf = seed => {
    let a = hashSeed(seed);
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const pickIndex = (rng, size) => {
    const n = Number(size) || 0;
    if (n <= 0) return -1;
    const raw = Math.floor(rng() * n);
    return raw < 0 ? 0 : raw > n - 1 ? n - 1 : raw;
  };

  /* ---- 结果行（纯数据副本；不含条目对象本身，避免被顺手改到词库） ---- */
  const rowOf = (chain, kind, reason, locked, poolSize) => {
    const summary = chain ? summaryOf(chain) : { text: '', englishOnly: false };
    const constraints = chain ? constraintsOf(chain) : { facets: {}, absent: [], auto: [], values: [], unknown: [], notes: '', needsReview: false };
    return {
      kind,
      scope: META[kind].scope,
      label: META[kind].short,
      title: META[kind].title,
      id: chain ? idOf(chain) : '',
      name: chain ? nameOf(chain) : '',
      text: chain ? textOf(chain) : '',
      negative: chain ? negativeOf(chain) : '',
      bilingual: chain ? bilingualOf(chain) : '',
      description: chain ? descriptionOf(chain) : '',
      previewImage: chain ? previewOf(chain) : '',
      updatedAt: chain ? updatedAtOf(chain) : null,
      tags: chain ? tagsOf(chain).slice(0, 8) : [],
      summary: summary.text,
      summaryEnglishOnly: !!summary.englishOnly,
      constraints,
      constraintNotes: constraints.notes,
      reason,
      reasonText: REASON[reason] || reason,
      locked: !!locked,
      poolSize: Number(poolSize) || 0,
      filled: !!(chain && (textOf(chain) || negativeOf(chain))),
      at: chain ? textOf(chain) : ''
    };
  };

  /* ---- 单栏抽取（所有路径共用；只在这里消耗随机数） ----
   * avoid = 要排除的条目 id（「再抽避开当前项」用它；候选不足时不排除，避免无限重试）
   * perKindSeed 是该栏自己的随机流种子（v2：每栏独立，互不影响）
   */
  const drawOne = (chains, kind, perKindSeed, avoid) => {
    const pool = poolOf(chains, kind);
    if (!pool.length) return { row: rowOf(null, kind, 'empty', false, 0), note: 'pool_empty' };
    const skip = avoid ? pool.filter(c => idOf(c) !== String(avoid)) : [];
    const usable = skip.length ? skip : pool;
    const rng = rngOf(normalizeSeed(perKindSeed) + '#' + kind);
    const row = rowOf(usable[pickIndex(rng, usable.length)], kind, 'ok', false, pool.length);
    return { row, note: avoid && !skip.length ? 'avoid_short' : '' };
  };

  /* ---- 主抽取：六库各抽 1 条 ----
   * input = { chains, checks, locked, seed, avoid }
   *   avoid = { [kind]: id } → 「再抽未固定项」时排除当前条目（候选不足则自动不排除，不做无限重试）
   * 每栏用独立随机流 → 固定/跳过某栏不影响其它栏（v2 算法）
   */
  const draw = input => {
    const opt = input && typeof input === 'object' ? input : {};
    const chains = Array.isArray(opt.chains) ? opt.chains : [];
    const checks = opt.checks && typeof opt.checks === 'object' ? opt.checks : {};
    const locked = opt.locked && typeof opt.locked === 'object' ? opt.locked : {};
    const avoid = opt.avoid && typeof opt.avoid === 'object' ? opt.avoid : {};
    const seed = normalizeSeed(opt.seed);
    const picks = {};
    const seeds = {};
    const notes = [];
    for (const kind of KINDS) {
      const pool = poolOf(chains, kind);
      seeds[kind] = seed;
      if (checks[kind] === false) {
        picks[kind] = rowOf(null, kind, 'unchecked', false, pool.length);
        continue;
      }
      if (!pool.length) {
        picks[kind] = rowOf(null, kind, 'empty', false, 0);
        notes.push({ kind, code: 'pool_empty', message: META[kind].title + '库当前 0 条，该栏留空（不是错误）。' });
        continue;
      }
      const lockId = locked[kind] == null || locked[kind] === '' ? '' : String(locked[kind]);
      if (lockId) {
        const held = pool.find(chain => idOf(chain) === lockId);
        if (held) {
          picks[kind] = rowOf(held, kind, 'locked', true, pool.length);
          continue;
        }
        notes.push({ kind, code: 'lock_missing', message: META[kind].title + '的固定项已不在词库里，该栏改为重抽。' });
      }
      const avoidId = avoid[kind] == null ? '' : String(avoid[kind]);
      const out = drawOne(chains, kind, seed, avoidId);
      picks[kind] = out.row;
      if (out.note === 'avoid_short') {
        notes.push({ kind, code: 'avoid_short', message: META[kind].title + '只有当前这一条可换，已保留（不是失败）。' });
      }
    }
    return { algo: ALGO, seed, seeds, picks, notes, locked: Object.assign({}, locked), checks: Object.assign({}, checks) };
  };

  /* ---- 单栏重抽（「换一个」）----
   * 只动这一栏：排除当前条目（候选 >1 时），候选只有 1 条时**不换**并说明原因。
   * nextSeed 由调用方生成（核保持纯函数：不读时间、不读随机源）。
   */
  const rerollOne = (input, kind, nextSeed) => {
    const opt = input && typeof input === 'object' ? input : {};
    const chains = Array.isArray(opt.chains) ? opt.chains : [];
    const checks = opt.checks && typeof opt.checks === 'object' ? opt.checks : {};
    const picks = opt.picks && typeof opt.picks === 'object' ? opt.picks : {};
    const locked = opt.locked && typeof opt.locked === 'object' ? opt.locked : {};
    const key = KINDS.indexOf(kind) >= 0 ? kind : '';
    if (!key) return { ok: false, code: 'unknown_kind', message: '未知分类' };
    if (checks[key] === false) return { ok: false, code: 'unchecked', message: META[key].title + '本次未参与，先勾选再换' };
    const lockId = locked[key] == null || locked[key] === '' ? '' : String(locked[key]);
    const current = picks[key] && picks[key].id ? String(picks[key].id) : '';
    if (lockId && lockId === current) return { ok: false, code: 'locked', message: META[key].title + '已固定，先解除固定再换' };
    const pool = poolOf(chains, key);
    if (!pool.length) return { ok: false, code: 'empty', message: META[key].title + '库当前 0 条，先去添加条目' };
    if (pool.length <= 1) return { ok: false, code: 'single', message: META[key].title + '只有 1 条候选，暂无其他可选' };
    const seed = normalizeSeed(nextSeed);
    const out = drawOne(chains, key, seed, current);
    return { ok: true, seed, row: out.row, note: out.note, message: '已为' + META[key].title + '换了一条' };
  };

  /* ---- 复现：按记录里的 seed + 条目 id 还原 ----
   * 条目还在 → 原样还原（reason = replay）；条目没了 → 用**该栏自己的**随机流重抽并回报 note。
   * 旧记录（无 algo / v1 顺序流）只走「按 id 还原」这条：不重放随机，避免算法差异被说成还原。
   */
  const replay = (input, record) => {
    const opt = input && typeof input === 'object' ? input : {};
    const chains = Array.isArray(opt.chains) ? opt.chains : [];
    const checks = opt.checks && typeof opt.checks === 'object' ? opt.checks : {};
    const prev = (record && record.picks) || {};
    const seedsIn = (record && record.seeds && typeof record.seeds === 'object') ? record.seeds : {};
    const seed = normalizeSeed((record && record.seed) || opt.seed);
    const picks = {};
    const seeds = {};
    const notes = [];
    let restored = 0;
    let redrawn = 0;
    for (const kind of KINDS) {
      const pool = poolOf(chains, kind);
      seeds[kind] = normalizeSeed(seedsIn[kind] || seed);
      if (checks[kind] === false) {
        picks[kind] = rowOf(null, kind, 'unchecked', false, pool.length);
        continue;
      }
      if (!pool.length) {
        picks[kind] = rowOf(null, kind, 'empty', false, 0);
        notes.push({ kind, code: 'pool_empty', message: META[kind].title + '库当前 0 条，该栏留空（不是错误）。' });
        continue;
      }
      const before = prev[kind] || null;
      const hit = before && before.id ? pool.find(chain => idOf(chain) === String(before.id)) : null;
      if (hit) {
        picks[kind] = rowOf(hit, kind, 'replay', !!before.locked, pool.length);
        restored++;
        continue;
      }
      if (before && before.id) {
        notes.push({ kind, code: 'entry_missing', message: META[kind].title + '上次用的条目已不在词库里，该栏按同一个随机码重抽。' });
      }
      picks[kind] = drawOne(chains, kind, seeds[kind], '').row;
      redrawn++;
    }
    return { algo: (record && record.algo) || LEGACY_ALGO, seed, seeds, picks, notes, restored, redrawn, locked: Object.assign({}, (record && record.locked) || {}), checks: Object.assign({}, checks) };
  };

  /* ---- 给 UI / 存为搭配 / 填入实验室 用的派生视图（全部只读派生） ---- */
  /* 六栏 → 实验室落点：全局两栏进 params._promptSections，角色四栏进角色 sections */
  const toSections = picks => {
    const global = {};
    const character = {};
    const written = [];
    const rows = [];
    for (const kind of KINDS) {
      const row = picks && picks[kind];
      if (!row || !row.filled) continue;
      if (META[kind].scope === 'global') global[kind] = row.text;
      else character[kind] = row.text;
      written.push(kind);
      rows.push(row);
    }
    return { global, character, written, rows };
  };
  /* 可读的一行摘要（给 toast / 证据用） */
  const describe = record => KINDS.map(kind => {
    const row = record && record.picks && record.picks[kind];
    if (!row) return META[kind].short + '：—';
    return META[kind].short + '：' + (row.filled ? row.name + '「' + clip(row.summary || row.text, 40) + '」' : '（' + row.reasonText + '）');
  }).join(' ｜ ');
  /* 是否「和上一次同一组」（逐栏 id 全等） */
  const samePicks = (a, b) => KINDS.every(kind => String((a && a[kind] && a[kind].id) || '') === String((b && b[kind] && b[kind].id) || ''));
  /* 技术证据：算法版本 + 随机码 + 每栏随机流 + 参与 + 固定 + 每栏条目 id/池指纹（需求 §7 的「证据」） */
  const evidenceOf = record => {
    const chains = Array.isArray(record && record.chains) ? record.chains : null;
    return {
      algo: String((record && record.algo) || ALGO),
      seed: String((record && record.seed) || ''),
      seeds: Object.assign({}, (record && record.seeds) || {}),
      at: Number((record && record.at) || 0) || null,
      checks: Object.assign({}, (record && record.checks) || {}),
      locked: Object.assign({}, (record && (record.locked || record.locks)) || {}),
      pools: KINDS.reduce((acc, kind) => {
        const pool = chains ? poolOf(chains, kind) : null;
        acc[kind] = { size: pool ? pool.length : ((record && record.picks && record.picks[kind] && record.picks[kind].poolSize) || 0), fingerprint: pool ? poolFingerprint(pool) : '' };
        return acc;
      }, {}),
      picks: KINDS.reduce((acc, kind) => {
        const row = record && record.picks && record.picks[kind];
        acc[kind] = row ? {
          id: row.id, name: row.name, reason: row.reason, locked: !!row.locked,
          textHash: (() => { let h = 5381; const t = String(row.text || ''); for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(16).padStart(8, '0'); })()
        } : null;
        return acc;
      }, {})
    };
  };
  /* 保存搭配用的「条目快照」（R13：条目以后改名/改内容/被删，快照仍在） */
  const snapshotOf = row => ({
    kind: row.kind, entryId: row.id, name: row.name, text: row.text, negative: row.negative,
    bilingual: row.bilingual, description: row.description, updatedAt: row.updatedAt,
    tags: (row.tags || []).slice(), summary: row.summary,
    constraints: row.constraints ? {
      facets: Object.assign({}, row.constraints.facets),
      absent: (row.constraints.absent || []).map(x => ({ key: x.key, label: x.label, known: !!x.known })),
      auto: (row.constraints.auto || []).map(x => ({ key: x.key, label: x.label, known: !!x.known })),
      unknown: (row.constraints.unknown || []).slice()
    } : null,
    constraintNotes: row.constraintNotes || ''
  });

  /* =====================================================================
   * Roll 内容搭配库（纯内容快照）—— 白名单构造与读取
   * ---------------------------------------------------------------------
   * 只保存六类内容 + 它们自己的负面/缺席约束/备注/来源，**绝不**保存：
   *   画师串、风格配套全局负面、用户手填全局负面、模型/采样器/步数/CFG/尺寸/张数/生图 seed、
   *   图生图与重绘参数、任何凭据。
   * 做法是**白名单**：只从已知字段里取，不复制整份 params 再删已知字段（需求 §3.2 明确要求）。
   * ===================================================================== */
  const CONTENT_FORMAT = 'nai-roll-content';
  const CONTENT_VERSION = 1;
  const ROLE_KEYS = ['appearance', 'wardrobe', 'pose', 'expression'];
  const GLOBAL_KEYS = ['scene', 'camera'];
  /* 每个分类的「内容负面」白名单：只留文本/备注/来源/模式，不留任何参数 */
  const contentNegOf = neg => {
    if (!neg || typeof neg !== 'object') return null;
    const text = String(neg.text == null ? '' : neg.text).trim();
    const note = String(neg.note == null ? '' : neg.note).trim();
    if (!text && !note) return null;
    return { text, note, source: String(neg.source == null ? '' : neg.source).trim() };
  };
  /* 来源快照 meta 的白名单（与统一编辑面板的 meta 同形，但只留能公开的字段） */
  const contentMetaOf = meta => {
    if (!meta || typeof meta !== 'object') return null;
    const out = {};
    const textKeys = ['source', 'entryId', 'entryType', 'entryName', 'entryBasePrompt', 'entryBilingual', 'entryDescription', 'entryPreviewImage'];
    for (const k of textKeys) if (meta[k] != null) out[k] = String(meta[k]);
    if (Number.isFinite(Number(meta.entryUpdatedAt)) && Number(meta.entryUpdatedAt) > 0) out.entryUpdatedAt = Number(meta.entryUpdatedAt);
    if (Array.isArray(meta.entryTags)) out.entryTags = meta.entryTags.map(t => String(t || '').trim()).filter(Boolean).slice(0, 24);
    if (meta.entryFacets && typeof meta.entryFacets === 'object') out.entryFacets = JSON.parse(JSON.stringify(meta.entryFacets));
    if (meta.entryConstraints && typeof meta.entryConstraints === 'object') out.entryConstraints = JSON.parse(JSON.stringify(meta.entryConstraints));
    out.needsReview = !!meta.needsReview;
    return Object.keys(out).length ? out : null;
  };
  /* 从「一键 Roll 的一次结果」构造纯内容快照（白名单；不含风格与参数） */
  const contentSnapshotOf = (record, savedAt) => {
    const picks = (record && record.picks) || {};
    const checks = (record && record.checks) || {};
    const roles = [];
    const global = {};
    const provided = {};
    const sections = {};
    const negatives = {};
    const meta = {};
    let any = false;
    for (const kind of ROLE_KEYS) {
      const row = picks[kind];
      const on = checks[kind] !== false;
      if (!on || !row || !row.filled) { provided[kind] = false; continue; }
      const text = String(row.text || '').trim();
      if (!text) { provided[kind] = false; continue; }
      provided[kind] = true;
      sections[kind] = text;
      const neg = contentNegOf({
        text: row.negative || '',
        note: row.constraintNotes || (row.constraints && row.constraints.notes) || '',
        source: row.name || ''
      });
      if (neg) negatives[kind] = neg;
      const m = contentMetaOf(row.meta || null);
      if (m) meta[kind] = m;
      any = true;
    }
    if (any) roles.push({ key: 'role-1', name: '角色 1', provided, sections, negatives, meta });
    for (const kind of GLOBAL_KEYS) {
      const row = picks[kind];
      const on = checks[kind] !== false;
      if (!on || !row || !row.filled) { global[kind] = { provided: false }; continue; }
      const text = String(row.text || '').trim();
      if (!text) { global[kind] = { provided: false }; continue; }
      const neg = contentNegOf({
        text: row.negative || '',
        note: row.constraintNotes || (row.constraints && row.constraints.notes) || '',
        source: row.name || ''
      });
      global[kind] = { provided: true, text, negative: neg || null, meta: contentMetaOf(row.meta || null) || null };
      any = true;
    }
    if (!any) return null;
    const evidence = record && record.roll ? record.roll : {
      seed: String((record && record.seed) || ''),
      seeds: Object.assign({}, (record && record.seeds) || {}),
      checks: Object.assign({}, checks),
      locks: Object.assign({}, (record && record.locks) || {})
    };
    return {
      format: CONTENT_FORMAT,
      version: CONTENT_VERSION,
      savedAt: String(savedAt || ''),
      algo: ALGO,
      roll: {
        seed: String(evidence.seed || ''),
        seeds: Object.assign({}, evidence.seeds || {}),
        checks: Object.assign({}, evidence.checks || checks),
        locks: Object.assign({}, evidence.locks || {})
      },
      roles,
      global
    };
  };
  /* 白名单读取：只接受 format/version 正确的记录；字段缺失按「未提供」处理，不猜、不清空 */
  const contentRead = raw => {
    const warnings = [];
    if (!raw || typeof raw !== 'object') return { ok: false, reason: 'empty', warnings: ['记录里没有内容快照'] };
    const format = String(raw.format || '');
    if (format !== CONTENT_FORMAT) {
      return { ok: false, reason: 'not_content', warnings: ['这条记录不是纯内容格式（' + (format || '无标识') + '），不走纯内容载入'] };
    }
    const version = Number(raw.version) || 0;
    if (version !== CONTENT_VERSION) warnings.push('结构版本 ' + String(version) + ' 与当前载入器（' + String(CONTENT_VERSION) + '）不同：只按已知字段读取，未知字段不应用');
    const rolesIn = Array.isArray(raw.roles) ? raw.roles : [];
    const roles = rolesIn.map((r, i) => {
      const sections = {};
      const negatives = {};
      const meta = {};
      const provided = {};
      for (const kind of ROLE_KEYS) {
        const text = String((r && r.sections && r.sections[kind]) || '').trim();
        provided[kind] = !!(r && r.provided && r.provided[kind] === true && text);
        if (!provided[kind]) continue;
        sections[kind] = text;
        const neg = contentNegOf(r && r.negatives && r.negatives[kind]);
        if (neg) negatives[kind] = neg;
        const m = contentMetaOf(r && r.meta && r.meta[kind]);
        if (m) meta[kind] = m;
      }
      return { key: String((r && r.key) || ('role-' + String(i + 1))), name: String((r && r.name) || ('角色 ' + String(i + 1))), provided, sections, negatives, meta };
    }).filter(r => ROLE_KEYS.some(k => r.provided[k]));
    const global = {};
    for (const kind of GLOBAL_KEYS) {
      const g = raw.global && raw.global[kind];
      const text = String((g && g.text) || '').trim();
      const ok = !!(g && g.provided === true && text);
      global[kind] = ok ? { provided: true, text, negative: contentNegOf(g && g.negative), meta: contentMetaOf(g && g.meta) } : { provided: false };
    }
    const anyRole = roles.length > 0;
    const anyGlobal = GLOBAL_KEYS.some(k => global[k].provided);
    if (!anyRole && !anyGlobal) return { ok: false, reason: 'no_content', warnings: warnings.concat(['这条记录里没有可载入的六类内容']) };
    return {
      ok: true,
      format,
      version,
      savedAt: String(raw.savedAt || ''),
      algo: String(raw.algo || ''),
      roll: raw.roll && typeof raw.roll === 'object' ? {
        seed: String(raw.roll.seed || ''),
        seeds: Object.assign({}, raw.roll.seeds || {}),
        checks: Object.assign({}, raw.roll.checks || {}),
        locks: Object.assign({}, raw.roll.locks || {})
      } : null,
      roles,
      global,
      anyRole,
      anyGlobal,
      warnings
    };
  };
  const isContentRecord = chain => !!(chain && chain.params && typeof chain.params === 'object'
    && chain.params._rollContentSnapshot && typeof chain.params._rollContentSnapshot === 'object'
    && String(chain.params._rollContentSnapshot.format || '') === CONTENT_FORMAT);
  const contentOfChain = chain => (isContentRecord(chain) ? contentRead(chain.params._rollContentSnapshot) : { ok: false, reason: 'not_content', warnings: [] });
  /* 卡片/预览用：这条记录实际包含哪些分类（不把空库/未参与显示成已有内容） */
  const contentScopeOf = readData => {
    const out = { roleKinds: [], globalKinds: [], roleCount: 0, label: '' };
    if (!readData || !readData.ok) return out;
    out.roleCount = readData.roles.length;
    if (readData.roles[0]) out.roleKinds = ROLE_KEYS.filter(k => readData.roles[0].provided[k]);
    out.globalKinds = GLOBAL_KEYS.filter(k => readData.global[k] && readData.global[k].provided);
    const labelOf = k => (META[k] ? META[k].short : k);
    const parts = [];
    if (out.roleKinds.length) parts.push('角色：' + out.roleKinds.map(labelOf).join(' / '));
    if (out.globalKinds.length) parts.push('全局：' + out.globalKinds.map(labelOf).join(' / '));
    out.label = parts.join('；');
    return out;
  };
  /* 从旧「完整搭配」快照里提取六类内容（人工提取另存用；排除风格、风格负面与参数） */
  const contentFromPresetSnapshot = (snap, savedAt) => {
    if (!snap || typeof snap !== 'object') return null;
    const sp = (snap.params && typeof snap.params === 'object') ? snap.params : {};
    const sec = (sp._promptSections && typeof sp._promptSections === 'object') ? sp._promptSections : {};
    const secNeg = (sp._promptSectionsNegatives && typeof sp._promptSectionsNegatives === 'object') ? sp._promptSectionsNegatives : {};
    const chars = Array.isArray(sp.characters) ? sp.characters : [];
    const cneg = (sp._characterSectionsNegatives && typeof sp._characterSectionsNegatives === 'object') ? sp._characterSectionsNegatives : {};
    const cmeta = (sp._characterSectionsMeta && typeof sp._characterSectionsMeta === 'object') ? sp._characterSectionsMeta : {};
    const roles = [];
    for (const c of chars) {
      const id = String((c && c.id) || '');
      const s = (c && c.sections && typeof c.sections === 'object') ? c.sections : {};
      const provided = {};
      const sections = {};
      const negatives = {};
      const meta = {};
      let any = false;
      for (const kind of ROLE_KEYS) {
        const text = String(s[kind] || '').trim();
        provided[kind] = !!text;
        if (!text) continue;
        sections[kind] = text;
        const neg = contentNegOf(cneg[id + '::' + kind]);
        if (neg) negatives[kind] = neg;
        const m = contentMetaOf(cmeta[id + '::' + kind]);
        if (m) meta[kind] = m;
        any = true;
      }
      if (any) roles.push({ key: id || ('role-' + String(roles.length + 1)), name: String((c && c.name) || ('角色 ' + String(roles.length + 1))), provided, sections, negatives, meta });
    }
    const global = {};
    for (const kind of GLOBAL_KEYS) {
      const text = String(sec[kind] == null ? (kind === 'scene' ? (sec.extra || '') : '') : sec[kind]).trim();
      global[kind] = text ? { provided: true, text, negative: contentNegOf(secNeg[kind]), meta: null } : { provided: false };
    }
    const anyGlobal = GLOBAL_KEYS.some(k => global[k].provided);
    if (!roles.length && !anyGlobal) return null;
    return {
      format: CONTENT_FORMAT, version: CONTENT_VERSION, savedAt: String(savedAt || ''), algo: ALGO,
      roll: { seed: '', seeds: {}, checks: {}, locks: {}, extractedFrom: 'preset' },
      roles, global,
      extracted: {
        excluded: ['画师串（basePrompt）', '风格配套全局负面', '用户手填全局负面', '模型 / 采样器 / 步数 / CFG / 尺寸 / 张数 / 生图 seed'],
        mixedNegativeWarning: (() => {
          const legacyScan = [String((snap && snap.basePrompt) || ''), String((snap && snap.negativePrompt) || '')].filter(Boolean).length;
          return legacyScan > 0;
        })()
      }
    };
  };

  return {
    ALGO, LEGACY_ALGO, KINDS, META, REASON,
    CONTENT_FORMAT, CONTENT_VERSION, ROLE_KEYS, GLOBAL_KEYS,
    FACET_AUTO, FACET_NONE, FACET_AUTO_LABEL, FACET_NONE_LABEL, FACET_LABELS, facetLabel,
    clip, isObj, listOf, splitTags, probeTag, joinTags,
    metaOf, idOf, nameOf, textOf, negativeOf, bilingualOf, tagsOf, descriptionOf, previewOf, updatedAtOf,
    chineseOf, summaryOf, constraintsOf,
    poolOf, poolsOf, poolFingerprint,
    normalizeSeed, hashSeed, rngOf, pickIndex,
    rowOf, draw, drawOne, rerollOne, replay, toSections, describe, samePicks, evidenceOf, snapshotOf,
    contentNegOf, contentMetaOf, contentSnapshotOf, contentRead, isContentRecord, contentOfChain, contentScopeOf, contentFromPresetSnapshot
  };
})();
/* __NAI_ROLL_CORE_END__ */

export default __naiRollCore;

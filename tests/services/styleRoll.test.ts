import { describe, expect, it } from 'vitest';
import { candidateFixture, rollFixture, seededRandom } from '../fixtures/styleRoll';
import { formatRollStyle, manualRollVariant, mergeRollArtists, nextRollPair, parseRollArtists, rankRollCandidates, resolveRollArtists, rollCandidates, rollCandidateToChain, rollPairKey, rollSignature, scoreRollCandidates, validateRollExperiment, validateRollRules, validateRollTemplate } from '../../services/styleRoll';

describe('Roll 串画师与规则', () => {
  it('完整词库不受手填1000项限制，覆盖项按名称去重且锁定／排除优先', () => {
    const names = Array.from({ length: 1205 }, (_, index) => `catalog_${index}`);
    const overrides = [{ tag: 'CATALOG 0', weight: 2, locked: true, excluded: false }, { tag: 'catalog_1', weight: 1, locked: false, excluded: true }];
    const artists = resolveRollArtists([...names, 'CATALOG 2', 'invalid,tag'], overrides);
    expect(artists).toHaveLength(1205); expect(artists[0]).toEqual(overrides[0]); expect(artists[1]).toEqual(overrides[1]); expect(artists[2].tag).toBe('catalog_2');
    const e = rollFixture(); e.artists = artists;
    const candidate = rollCandidates(e, 1, { random: () => 0.999999 })[0];
    expect(candidate.genes[0]).toEqual({ tag: 'CATALOG 0', weight: 2 }); expect(candidate.genes.some(gene => gene.tag === 'catalog_1204')).toBe(true);
    expect(candidate.genes.some(gene => gene.tag === 'catalog_1')).toBe(false); expect(overrides).toHaveLength(2);
  });
  it('旧候选即使从词库移除也可保留画师精修，排除项仍生效', () => {
    const e = rollFixture(); e.artists = []; e.candidates = [candidateFixture('old', 'old-artist')];
    e.artists = resolveRollArtists([], [], e.candidates[0].genes);
    expect(manualRollVariant(e, e.candidates[0], [1.1]).genes).toEqual([{ tag: 'old-artist', weight: 1.1 }]);
    e.artists[0].excluded = true; expect(() => manualRollVariant(e, e.candidates[0], [1.2])).toThrow('抽取条件已变化');
  });
  it('支持裸 Tag、artist 前缀和数值权重，归一化去重但保留第一份名字', () => {
    expect(parseRollArtists('artist:alpha_name, 1.2::artist:beta ::\nALPHA NAME')).toEqual([
      { tag: 'alpha_name', weight: 1, locked: false, excluded: false }, { tag: 'beta', weight: 1.2, locked: false, excluded: false },
    ]);
    expect(mergeRollArtists([{ ...parseRollArtists('alpha')[0], locked: true }], parseRollArtists('ALPHA, beta'))).toHaveLength(2);
  });
  it.each(['-1::artist:alpha ::', '0::alpha::', '1.23::alpha::', '{artist:alpha}', '3.1::alpha::'])('拒绝无效权重与嵌套语法 %s', input => expect(() => parseRollArtists(input)).toThrow());
  it('固定 Seed 0 有效；不接受随机 Seed、重复占位或编辑模型', () => {
    const e = rollFixture(); expect(() => validateRollTemplate(e.template)).not.toThrow();
    for (const seed of [undefined, -1, NaN, 4294967296]) expect(() => validateRollTemplate({ ...e.template, params: { ...e.template.params, seed } })).toThrow();
    expect(() => validateRollTemplate({ ...e.template, prompt: '{style}, {style}' })).toThrow();
    expect(() => validateRollTemplate({ ...e.template, params: { ...e.template.params, model: 'nai-diffusion-4-5-full-inpainting' } })).toThrow();
  });
  it('空池草稿可保存，真正 Roll 才要求足够画师', () => {
    const e = rollFixture(); e.artists = []; expect(() => validateRollExperiment(e)).not.toThrow();
    expect(() => rollCandidates(e, 1)).toThrow('可用画师不足');
    e.artists = parseRollArtists('alpha, beta, gamma').map(artist => ({ ...artist, locked: true }));
    expect(() => validateRollRules(e.artists, { ...e.rules, minArtists: 1, maxArtists: 2 })).toThrow('锁定画师');
  });
});

describe('Roll、进化和精修', () => {
  it('保存替代PK作为偏好信号，优先保留原组合画师并留四分之一全新探索，锁定／排除和去重仍生效', () => {
    const e = rollFixture(); e.rules = { ...e.rules, minArtists: 4, maxArtists: 4 };
    e.candidates = [{ ...candidateFixture('saved'), savedChainId: 'chain', genes: ['alpha', 'beta', 'gamma', 'delta'].map(tag => ({ tag, weight: 1 })) }, { ...candidateFixture('archived', 'theta'), savedChainId: 'old-chain', archived: true }];
    e.artists[1].excluded = true; e.artists[4].locked = true; e.artists[4].weight = 1.3;
    const result = rollCandidates(e, 8, { mode: 'saved', random: seededRandom() });
    expect(result).toHaveLength(8); expect(result.filter(candidate => candidate.parents.includes('saved'))).toHaveLength(6); expect(result.filter(candidate => candidate.method === 'random')).toHaveLength(2);
    for (const candidate of result) {
      expect(candidate.genes).toHaveLength(4); expect(candidate.genes).toContainEqual({ tag: 'epsilon', weight: 1.3 }); expect(candidate.genes.some(gene => gene.tag === 'beta')).toBe(false);
      expect(candidate.parents).not.toContain('archived'); if (candidate.parents.length) expect(candidate.genes.some(gene => ['alpha', 'gamma', 'delta'].includes(gene.tag))).toBe(true);
    }
    expect(new Set(result.map(candidate => rollSignature(candidate.genes))).size).toBe(8); expect(e.votes).toEqual([]);
  });
  it('未保存、已归档或已不在可用词库内的组合不冒充偏好，自动退回完整词库随机抽取', () => {
    const e = rollFixture(); e.candidates = [candidateFixture('not-kept', 'alpha'), { ...candidateFixture('missing', 'removed'), savedChainId: 'gone' }];
    const result = rollCandidates(e, 4, { mode: 'saved', random: seededRandom() }); expect(result.every(candidate => candidate.method === 'random' && !candidate.parents.length)).toBe(true);
  });
  it('精确调整生成独立新变体并遵守锁定、排除及范围，原串保持不变', () => {
    const e = rollFixture(); const parent = { ...candidateFixture('manual-parent', 'alpha'), genes: [{ tag: 'alpha', weight: 1 }, { tag: 'beta', weight: 1 }] }; e.candidates = [parent];
    e.artists[0].locked = true; e.artists[0].weight = 1.2;
    const variant = manualRollVariant(e, parent, [0.1, 0.9]);
    expect(variant.genes).toEqual([{ tag: 'alpha', weight: 1.2 }, { tag: 'beta', weight: 0.9 }]); expect(variant.parents).toEqual([parent.id]);
    expect(parent.genes).toEqual([{ tag: 'alpha', weight: 1 }, { tag: 'beta', weight: 1 }]);
    expect(() => manualRollVariant(e, parent, [1, 1.41])).toThrow('一位小数');
    e.candidates.push(variant); expect(() => manualRollVariant(e, parent, [1.2, 0.9])).toThrow('已经存在');
    e.artists[1].excluded = true; expect(() => manualRollVariant(e, parent, [1.2, 1.1])).toThrow('抽取条件已变化');
  });
  it('批次去重、锁定原权重、排除生效，并满足全部数量和权重边界', () => {
    const e = rollFixture(); e.artists[0] = { ...e.artists[0], locked: true, weight: 2 }; e.artists[1].excluded = true;
    const random = seededRandom(); e.candidates = rollCandidates(e, 24, { random });
    e.candidates.push(...rollCandidates(e, 24, { random }));
    expect(new Set(e.candidates.map(candidate => rollSignature(candidate.genes))).size).toBe(48);
    for (const candidate of e.candidates) {
      expect(candidate.genes.length).toBeGreaterThanOrEqual(3); expect(candidate.genes.length).toBeLessThanOrEqual(6);
      expect(candidate.genes[0]).toEqual({ tag: 'alpha', weight: 2 }); expect(candidate.genes.some(gene => gene.tag === 'beta')).toBe(false);
      for (const gene of candidate.genes.slice(1)) { expect(gene.weight).toBeGreaterThanOrEqual(0.7); expect(gene.weight).toBeLessThanOrEqual(1.4); }
    }
    expect(() => validateRollExperiment(e)).not.toThrow();
  });
  it('可行组合不足时有界返回部分结果，完全重复时明确失败', () => {
    const e = rollFixture(); e.artists = parseRollArtists('alpha'); e.rules = { minArtists: 1, maxArtists: 1, minWeight: 1, maxWeight: 1 };
    e.candidates = rollCandidates(e, 24); expect(e.candidates).toHaveLength(1);
    expect(() => rollCandidates(e, 1)).toThrow('没有新的组合');
  });
  it('进化只从已评价的非归档高分候选取父母，保留三种探索方式与谱系', () => {
    const e = rollFixture(), random = seededRandom(); e.candidates = rollCandidates(e, 10, { random });
    e.votes = e.candidates.slice(1).map((candidate, index) => ({ id: `vote-${index}`, left: e.candidates[0].id, right: candidate.id, leftImage: 'image-parent', rightImage: `image-${index}`, result: 'left' as const, createdAt: index }));
    e.candidates[1].archived = true;
    const children = rollCandidates(e, 24, { mode: 'evolve', random });
    expect(new Set(children.map(candidate => candidate.method))).toEqual(new Set(['random', 'mutate', 'crossover']));
    const top = rankRollCandidates(e).filter(candidate => !candidate.archived).slice(0, 3).map(candidate => candidate.id);
    for (const candidate of children) for (const parent of candidate.parents) expect(top).toContain(parent);
    expect(() => validateRollExperiment({ ...e, candidates: [...e.candidates, ...children] })).not.toThrow();
  });
  it('精修保持画师集合与锁定值，至少一处变化；排除父代画师后要求先变异', () => {
    const e = rollFixture(), random = seededRandom(); e.artists[0].locked = true;
    e.candidates = rollCandidates(e, 1, { random }); const parent = e.candidates[0];
    const children = rollCandidates(e, 5, { mode: 'refine', parentId: parent.id, jitter: 0.1, random });
    for (const child of children) {
      expect(child.genes.map(gene => gene.tag)).toEqual(parent.genes.map(gene => gene.tag));
      expect(child.genes[0]).toEqual(parent.genes[0]); expect(rollSignature(child.genes)).not.toBe(rollSignature(parent.genes));
      child.genes.forEach((gene, index) => expect(Math.abs(gene.weight - parent.genes[index].weight)).toBeLessThanOrEqual(0.100001));
      expect(child.parents).toEqual([parent.id]); expect(child.generation).toBe(1);
    }
    e.artists.find(artist => artist.tag === parent.genes[1].tag)!.excluded = true;
    expect(() => rollCandidates(e, 1, { mode: 'refine', parentId: parent.id })).toThrow('抽取条件已变化');
  });
});

describe('相对评分、配对与保存', () => {
  it('胜负守恒、平局正确、撤销重放还原分数', () => {
    const e = rollFixture(); e.candidates = [candidateFixture('a'), candidateFixture('b')];
    const original = scoreRollCandidates(e);
    e.votes.push({ id: 'v1', left: 'a', right: 'b', leftImage: 'image-a', rightImage: 'image-b', result: 'left', createdAt: 1 });
    expect(scoreRollCandidates(e).get('a')).toEqual({ rating: 1016, matches: 1, wins: 1, draws: 0 });
    e.votes.push({ id: 'v2', left: 'a', right: 'b', leftImage: 'image-a', rightImage: 'image-b', result: 'draw', createdAt: 2 });
    const scores = scoreRollCandidates(e); expect(scores.get('a')!.rating + scores.get('b')!.rating).toBe(2000); expect(scores.get('a')!.draws).toBe(1);
    e.votes = []; expect(scoreRollCandidates(e)).toEqual(original);
  });
  it('只配已生成、未归档候选；跳过不改变分数，下一对优先未比较', () => {
    const e = rollFixture(); e.candidates = ['a', 'b', 'c', 'd'].map(id => candidateFixture(id)); e.candidates[3].archived = true;
    expect(nextRollPair(e, new Set(['a']))).toBeNull();
    const pair = nextRollPair(e, new Set(['a', 'b', 'c', 'd']))!; expect(pair).not.toContain('d');
    const skipped = new Set([rollPairKey(...pair)]); expect(rollPairKey(...nextRollPair(e, new Set(['a', 'b', 'c']), skipped)!)).not.toBe(rollPairKey(...pair));
    expect(e.votes).toEqual([]);
    e.votes.push({ id: 'v', left: pair[0], right: pair[1], leftImage: `image-${pair[0]}`, rightImage: `image-${pair[1]}`, result: 'left', createdAt: 1 });
    expect(nextRollPair(e, new Set(['a', 'b', 'c']))).toContain('c');
  });
  it('风格串保存保留完整配置和真实 Seed，独立深拷贝角色参数', () => {
    const e = rollFixture(); e.template.params.characters = [{ id: 'role', prompt: 'subject', negativePrompt: 'negative role', x: 0.5, y: 0.5 }];
    e.candidates = [candidateFixture('alpha')]; const saved = rollCandidateToChain(e, e.candidates[0], '/api/assets/synthetic.png');
    expect(saved.basePrompt).toBe(`${formatRollStyle(e.candidates[0].genes)}, synthetic subject`); expect(saved.params.seed).toBe(0);
    expect(saved.params.characters).toEqual(e.template.params.characters); expect(saved.params.characters).not.toBe(e.template.params.characters);
    expect(saved.modules).toEqual([]); expect(saved.variableValues).toEqual({ subject: '' }); expect(saved.tags).toEqual([]);
  });
});

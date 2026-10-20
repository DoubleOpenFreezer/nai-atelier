import { describe, expect, it } from 'vitest';
import { parsePromptTags, removePromptTag, tagDetails } from '../../services/promptTagFilter';

describe('候选逐标签筛选', () => {
  const prompt = 'blonde_hair, blue_eyes, (school_uniform:1.2), white_dress';
  const bilingual = 'blonde_hair（金发）, blue_eyes（蓝瞳）, school_uniform（校服）, white_dress（白裙）';

  it('解析出每个 Tag 与中文对照，带权重写法单独标记', () => {
    const tokens = parsePromptTags(prompt, bilingual);
    expect(tokens.map(token => token.tag)).toEqual(['blonde_hair', 'blue_eyes', 'school_uniform', 'white_dress']);
    expect(tokens[0].bilingual).toBe('金发');
    expect(tokens[2].weighted).toBe(true);
    expect(tokens[2].weight).toBe(1.2);
    expect(tokens[2].raw).toBe('(school_uniform:1.2)');
  });

  it('只删完整 Tag：删 hair 不会误伤 blonde_hair，删 blue_eyes 不碰其它', () => {
    const miss = removePromptTag(prompt, bilingual, 'hair');
    expect(miss.removed).toBe(false);
    expect(miss.reason).toBe('not-found');
    const hit = removePromptTag(prompt, bilingual, 'blue_eyes');
    expect(hit.removed).toBe(true);
    expect(hit.prompt).toBe('blonde_hair, (school_uniform:1.2), white_dress');
    expect(hit.bilingual).not.toContain('蓝瞳');
    expect(hit.bilingual).toContain('金发');
  });

  it('中英对照同步删除，剩余条目顺序与英文一致', () => {
    const hit = removePromptTag(prompt, bilingual, 'blonde_hair');
    expect(hit.prompt).toBe('blue_eyes, (school_uniform:1.2), white_dress');
    expect(hit.bilingual).toBe('blue_eyes（蓝瞳）, school_uniform（校服）, white_dress（白裙）');
  });

  it('带权重组默认不拆，显式允许时才删', () => {
    const blocked = removePromptTag(prompt, bilingual, 'school_uniform');
    expect(blocked.removed).toBe(false);
    expect(blocked.reason).toBe('weighted');
    const allowed = removePromptTag(prompt, bilingual, 'school_uniform', { allowWeighted: true });
    expect(allowed.prompt).toBe('blonde_hair, blue_eyes, white_dress');
  });

  it('也支持 1.2::tag:: 写法与纯中文候选', () => {
    const tokens = parsePromptTags('1.3::rain::, night', '1.3::rain::（雨）, night（夜）');
    expect(tokens[0].weighted).toBe(true);
    expect(tokens[0].weight).toBe(1.3);
    expect(tokens[1].bilingual).toBe('夜');
    expect(tagDetails('rain, night').map(token => token.tag)).toEqual(['rain', 'night']);
  });

  it('同名重复 Tag 一并删除（同一枚标签删两次无意义），未命中时原样返回', () => {
    const twice = 'smile, smile, wave';
    const hit = removePromptTag(twice, '', 'smile');
    expect(hit.removed).toBe(true);
    expect(hit.prompt).toBe('wave');
    expect(removePromptTag('', '', 'x').removed).toBe(false);
  });
});

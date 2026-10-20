import { describe, expect, it } from 'vitest';
import { classifyPromptTags, summarizePromptSources } from '../../services/promptProvenance';

describe('候选标签的来源标记', () => {
  const prompt = 'blonde_hair, blue_eyes, white_dress, smile';

  it('出现在需求或限定项里的算用户要求，其余算 AI 补全', () => {
    const tags = classifyPromptTags(prompt, { brief: '金发的少女，笑着', facets: { wardrobe: 'white_dress' } });
    expect(tags).toEqual([
      { tag: 'blonde_hair', source: 'ai' },
      { tag: 'blue_eyes', source: 'ai' },
      { tag: 'white_dress', source: 'user' },
      { tag: 'smile', source: 'ai' },
    ]);
  });

  it('需求里写英文时按归一化匹配（下划线/空格等价）', () => {
    const tags = classifyPromptTags('blonde hair, blue_eyes', { brief: 'blonde_hair, shy' });
    expect(tags[0].source).toBe('user');
    expect(tags[1].source).toBe('ai');
  });

  it('用户写 a、模型写 a_b 这种包含关系也算用户要求', () => {
    const tags = classifyPromptTags('white_dress, long_hair', { brief: 'white' });
    expect(tags[0].source).toBe('user');
    expect(tags[1].source).toBe('ai');
  });

  it('没有任何需求信息时全部标为未标注，不猜测', () => {
    const tags = classifyPromptTags(prompt);
    expect(tags.every(item => item.source === 'unmarked')).toBe(true);
    expect(summarizePromptSources(tags)).toEqual({ user: 0, ai: 0, unmarked: 4 });
  });

  it('汇总数量可用于界面显示', () => {
    const tags = classifyPromptTags(prompt, { brief: 'white_dress, smile' });
    expect(summarizePromptSources(tags)).toEqual({ user: 2, ai: 2, unmarked: 0 });
  });
});

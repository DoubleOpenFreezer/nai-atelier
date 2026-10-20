import { expect, it } from 'vitest';
import dictionary from '../../locales/messages.json';
import { PROMPT_LIBRARY_KINDS } from '../../components/promptLibraryConfig';

it('四类库的分类、生成条件和选项具有完整的四语译文，模板变量保持一致', () => {
  const keys = new Set<string>(['图片提示词库', '画师串', '人物', '服饰', '姿势', '补充',
    '使用当前创作助手模型生成提示词，模型服务可能收费；不消耗生图额度。',
    '过滤后内容过少，已保留原文，请检查。', '已过滤 {0} 个越界标签：{1}']);
  for (const config of Object.values(PROMPT_LIBRARY_KINDS)) {
    for (const value of Object.values(config)) if (typeof value === 'string' && /[\u4e00-\u9fff]/.test(value)) keys.add(value);
    for (const facet of config.facets) { keys.add(facet.label); facet.options.filter(Boolean).forEach(option => keys.add(option)); }
  }
  for (const key of keys) {
    const variants = (dictionary as Record<string, string[]>)[key];
    expect(variants, key).toHaveLength(4);
    for (const value of variants) {
      expect(value.trim(), key).not.toBe('');
      expect([...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort(), key)
        .toEqual([...key.matchAll(/\{\d+\}/g)].map(match => match[0]).sort());
    }
  }
});

// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { comparisonChain, comparisonReady, validateChainComparison } from '../../services/chainComparison';
import { applyComparisonAgent, comparisonAgentDraft, markComparisonRole } from '../../services/chainComparisonApi';
import { comparisonFixture } from '../fixtures/chainComparison';
import { parsePromptTags } from '../../services/tagTranslations';
it('原文快照不变，结构化角色替换，默认各自Seed和风格参数不变', () => {
  const record = comparisonFixture(), original = structuredClone(record.draft.entries[0].source);
  expect(comparisonReady(record.draft)).toBe(false);
  const first = comparisonChain(record.draft.entries[0], record.draft), second = comparisonChain(record.draft.entries[1], record.draft);
  expect(first.params.characters?.[0].prompt).toBe('new character'); expect(first.params.characters?.[0].negativePrompt).toBe('new negative');
  expect([first.params.seed, second.params.seed]).toEqual([42, 7]); expect([first.params.scale, second.params.scale]).toEqual([5, 6]);
  expect(record.draft.entries[0].source).toEqual(original);
});
it('同字段分别拆角色与风格，花括号/数值权重两侧都保留，助手移出内容可追溯', () => {
  const record = comparisonFixture(true), entry = record.draft.entries[0];
  for (const [id, target, kept, replaced] of [['base', '1girl', '{{artist:alpha}}, side view', '{{1girl}}'], ['module:light', 'blonde hair', '1.2::soft light::', '1.2::blonde hair::']]) {
    const field = entry.fields.find(value => value.id === id)!;
    const next = markComparisonRole(field, parsePromptTags(field.kept).find(token => token.lookupTag === target)!.id);
    expect(next.kept).toBe(kept); expect(next.replaced).toBe(replaced); expect(next.reviewed).toBe(false); expect(next.original).toBe(field.original);
  }
  const proposed = comparisonAgentDraft(record, entry); proposed.basePrompt = 'retained style'; proposed.params.scale = 30;
  const next = applyComparisonAgent(entry, proposed);
  expect(next.fields[0].kept).toBe('retained style'); expect(next.source.params.scale).toBe(5);
  expect(next.fields[0].replaced).toBe('{{artist:alpha, 1girl}}, side view');
});
it('旧独立对比存档仍按原边界读取，不覆盖坏字段或不完整轮次', () => {
  const record = comparisonFixture(true); expect(() => validateChainComparison(record)).not.toThrow();
  const invalid = structuredClone(record); invalid.draft.entries[0].fields[0].original = 'fake'; expect(() => validateChainComparison(invalid)).toThrow();
  record.draft.entries[0].fields[0].reviewed = false; record.rounds = [{ id: 'round', createdAt: 1, draft: record.draft }]; expect(() => validateChainComparison(record)).toThrow();
});

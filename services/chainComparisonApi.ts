import type { PromptAgentDraft } from '../types';
import { api } from './api';
import { parsePromptTags, removePromptTagTokens } from './tagTranslations';
import { comparisonChain, validateChainComparison,
  type ChainComparison, type ComparisonEntry, type ComparisonField } from './chainComparison';

export async function loadChainComparisons(): Promise<ChainComparison[]> {
  const { records } = await api.get('/chain-comparisons', { cache: 'no-store' });
  if (!Array.isArray(records)) throw new Error('对比记录读取失败，请保留资料并重试');
  records.forEach(validateChainComparison); return records;
}
export async function saveChainComparison(record: ChainComparison): Promise<ChainComparison> {
  validateChainComparison(record);
  const result = await api.put('/chain-comparisons', record);
  validateChainComparison(result.record); return result.record;
}
/** 递归保留两侧各自的权重包装，未选词不靠猜测删除。 */
export function markComparisonRole(field: ComparisonField, tokenId: string): ComparisonField {
  const tokens = parsePromptTags(field.kept), selected = tokens.filter(token => token.id === tokenId);
  if (!selected.length) return field;
  const removed = removePromptTagTokens(field.kept, tokens.filter(token => token.id !== tokenId));
  return { ...field, kept: removePromptTagTokens(field.kept, selected), replaced: [field.replaced, removed].filter(Boolean).join(', '), reviewed: false };
}

export function comparisonAgentDraft(record: ChainComparison, entry: ComparisonEntry): PromptAgentDraft {
  const chain = comparisonChain(entry, record.draft);
  return { basePrompt: chain.basePrompt, subjectPrompt: chain.variableValues?.subject || '', negativePrompt: chain.negativePrompt, modules: chain.modules, params: chain.params };
}
export function applyComparisonAgent(entry: ComparisonEntry, proposed: PromptAgentDraft): ComparisonEntry {
  return { ...entry, fields: entry.fields.map(field => {
    const kept = field.kind === 'base' ? proposed.basePrompt : field.kind === 'subject' ? proposed.subjectPrompt : field.kind === 'negative' ? proposed.negativePrompt
      : proposed.modules.find(module => module.id === field.moduleId)?.content ?? field.kept;
    if (kept === field.kept) return field;
    const remaining = new Map<string, number>();
    parsePromptTags(kept).forEach(token => remaining.set(token.lookupTag, (remaining.get(token.lookupTag) || 0) + 1));
    const original = parsePromptTags(field.kept);
    const removed = new Set(original.filter(token => {
      const count = remaining.get(token.lookupTag) || 0;
      if (count) { remaining.set(token.lookupTag, count - 1); return false; }
      return true;
    }).map(token => token.id));
    const replaced = removed.size ? removePromptTagTokens(field.kept, original.filter(token => !removed.has(token.id))) : '';
    return { ...field, kept, replaced: [field.replaced, replaced].filter(Boolean).join(', '), reviewed: false };
  }) };
}

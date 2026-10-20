/**
 * 提示词库选择器的**三种应用模式**与分类冲突提示（纯逻辑，供选择器与单测共用）。
 *
 *   replace      用条目内容替换当前栏位；
 *   append       追加到末尾（已存在的 Tag 不重复追加）；
 *   fill-missing 只在栏位**为空**时填入；已有内容就原样保留（对应本地的「补充未设置项」）。
 *
 * 分类冲突：从「服饰」库里挑条目填进「形象」栏属于跨类应用，
 * 不阻止，但必须给出提示 —— 由 kindConflictOf 返回，由界面显示。
 */

import { splitPromptSegments } from './promptTagFilter';

export type PromptApplyMode = 'replace' | 'append' | 'fill-missing';

export const PROMPT_APPLY_MODES: PromptApplyMode[] = ['replace', 'append', 'fill-missing'];

const splitTags = (value: string): string[] =>
  splitPromptSegments(value);

const probe = (value: string): string => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** 按归一化 Tag 去重合并：保持 first 的顺序，只补 second 里 first 没有的。 */
const mergeMissing = (first: string[], second: string[]): string[] => {
  const seen = new Set(first.map(probe));
  const out = [...first];
  for (const tag of second) {
    const key = probe(tag);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
};

/**
 * 按模式算出应用后的文本。
 * replace 直接返回新内容；append 去重追加；fill-missing 只补缺失 Tag。
 * 当前内容为空时三种模式结果一致（就是条目内容）。
 */
export const applyPromptText = (current: string, incoming: string, mode: PromptApplyMode): string => {
  const base = splitTags(current);
  const next = splitTags(incoming);
  if (!next.length) return base.join(', ');
  if (!base.length || mode === 'replace') return next.join(', ');
  if (mode === 'append') return mergeMissing(base, next).join(', ');
  /* fill-missing：只补「未设置」的栏位 —— 当前已有内容就原样保留，不并入新条目 */
  return base.join(', ');
};

/** 分类冲突：条目所属库与目标栏位所属库不一致时返回 true（跨类应用，需要提示）。 */
export const kindConflictOf = (entryKind: string, targetKind: string): boolean =>
  Boolean(entryKind) && Boolean(targetKind) && String(entryKind) !== String(targetKind);

/** 当前栏位里已经包含条目多少个 Tag（界面用来说明「会新增几项」）。 */
export const coveredTagCount = (current: string, incoming: string): number => {
  const have = new Set(splitTags(current).map(probe));
  return splitTags(incoming).filter(tag => have.has(probe(tag))).length;
};

/**
 * 候选标签的**来源标记**：用户要求 / AI 补全 / 未标注。
 *
 * 模型只返回一整条 prompt，不告诉我们每个 Tag 是谁写的。这里按可核对的信息反推：
 *   - 用户要求：Tag 出现在本次需求文本里，或等于 / 包含了用户勾选的限定项取值；
 *   - AI 补全  ：不在上面范围内，但确实出现在候选里；
 *   - 未标注  ：本次既没有需求文本也没有限定项，无从判断。
 * 反推是**保守**的：宁可标成 AI 补全，也不把没把握的东西说成用户要求。
 */

export type PromptTagSource = 'user' | 'ai' | 'unmarked';

export interface PromptTagWithSource {
  tag: string;
  source: PromptTagSource;
}

const splitTags = (value: string): string[] =>
  String(value || '').split(/[,，]/).map(part => part.trim()).filter(Boolean);

const probe = (value: string): string =>
  String(value || '').trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/^[()\[\]{}]+|[()\[\]{}]+$/g, '').trim();

export interface PromptProvenanceInput {
  brief?: string;
  /** 用户勾选/填写的限定项取值（可以带空值） */
  facets?: Record<string, unknown> | string[] | null;
}

const userTokens = (input: PromptProvenanceInput): string[] => {
  const tokens: string[] = [];
  for (const part of splitTags(String(input.brief || ''))) tokens.push(probe(part));
  const facets = input.facets;
  const values = Array.isArray(facets)
    ? facets
    : facets && typeof facets === 'object' ? Object.values(facets).flatMap(value => (Array.isArray(value) ? value : [value])) : [];
  for (const value of values) {
    const text = String(value == null ? '' : value).trim();
    if (!text) continue;
    tokens.push(probe(text));
  }
  return tokens.filter(Boolean);
};

/** 判断单个 Tag 是否来自用户（含「用户写了 a，模型写了 a_b」这种包含关系）。 */
const matchesUser = (tag: string, tokens: string[]): boolean => {
  const key = probe(tag);
  if (!key) return false;
  return tokens.some(token => token === key || key.includes(token) || token.includes(key));
};

/**
 * 给一条候选的每个 Tag 标注来源。
 * 没有任何需求信息时全部标为 unmarked（不猜测）。
 */
export const classifyPromptTags = (prompt: string, input: PromptProvenanceInput = {}): PromptTagWithSource[] => {
  const tags = splitTags(prompt);
  const tokens = userTokens(input);
  if (!tokens.length) return tags.map(tag => ({ tag, source: 'unmarked' as const }));
  return tags.map(tag => ({ tag, source: matchesUser(tag, tokens) ? 'user' as const : 'ai' as const }));
};

/** 统计各来源数量，界面用来显示「用户 3 / AI 2」。 */
export const summarizePromptSources = (tags: PromptTagWithSource[]) => {
  const counts = { user: 0, ai: 0, unmarked: 0 };
  for (const item of tags) counts[item.source] += 1;
  return counts;
};

/**
 * 稳定的操作标识：同一次「存为内容」重复触发（双击、网络重试）不应产生两条记录。
 *
 * 用内容本身派生标识（不读时间，不读随机源），因此：
 *   - 同一份数据重复调用得到同一个 id；
 *   - 字段顺序变化不影响结果（按 key 排序后再哈希）；
 *   - 内容变了就得到新 id —— 这正是「改了内容再存一次」该有的行为。
 */

/** FNV-1a 32 位，够短、够稳，避免引入依赖。 */
const hash32 = (text: string): string => {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/** 递归稳定序列化：对象按 key 排序，数组保持顺序。 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}';
};

/**
 * 生成操作标识。scope 用来隔离不同用途（例如 'content-roll'），
 * 同一 scope + 同一 payload 必然得到同一标识。
 */
export const stableOperationId = (scope: string, payload: unknown): string =>
  hash32(String(scope || '') + '|' + stableStringify(payload));

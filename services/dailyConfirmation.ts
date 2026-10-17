import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type ConfirmationChoice = 'confirm' | 'save';
const STORAGE_KEY = 'nai_daily_confirmations';
const CONNECTIONS_KEY = 'nai_confirmation_connections';

function readConnections(): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function rememberConfirmationConnections(entries: { key: string; id: string; gatewayUrl?: string }[]): void {
  const connections = readConnections();
  entries.forEach(entry => {
    if (!entry?.key || !entry.id) return;
    const key = confirmationIdentity('key', entry.key), connection = confirmationIdentity('connection', [entry.id, entry.gatewayUrl]);
    if (key && connection) connections[key] = connection;
  });
  try { localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections)); }
  catch { /* 摘要缓存不可写时不影响保管箱与本次操作。 */ }
}

/** 费用授权按 Key、已知接入、单价、张数与预算风险隔离，不把余额每次递减当成新授权。 */
export function confirmationCostScope(key: string, cost: number, count: number, remaining: number, context?: unknown): unknown {
  return [key, readConnections()[confirmationIdentity('key', key) || ''] ?? null, cost, count, remaining <= 0 ? 'empty' : cost * count > remaining ? 'insufficient' : 'within', context];
}

const localDay = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

/** 动态授权范围只保存摘要，不能把 Key、路径或助手载荷写进偏好。 */
export function confirmationIdentity(key: string, scope?: unknown): string | null {
  if (scope === undefined) return key;
  try {
    return `${key}:${bytesToHex(sha256(utf8ToBytes(JSON.stringify(scope))))}`;
  } catch { return null; }
}

function readChoices(now: Date): Record<string, ConfirmationChoice> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return value?.day === localDay(now) && value.choices && typeof value.choices === 'object' && !Array.isArray(value.choices) ? value.choices : {};
  } catch { return {}; }
}

export function readDailyConfirmation(identity: string | null, now = new Date()): ConfirmationChoice | null {
  if (!identity) return null;
  const choice = readChoices(now)[identity];
  return choice === 'confirm' || choice === 'save' ? choice : null;
}

export function rememberDailyConfirmation(identity: string | null, choice: ConfirmationChoice, now = new Date()): void {
  if (!identity) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: localDay(now), choices: { ...readChoices(now), [identity]: choice } })); }
  catch { /* 偏好存储不可用时仍正常完成本次确认。 */ }
}

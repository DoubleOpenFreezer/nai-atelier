/*
 * 独立测试环境 · 写入守卫（收尾 B）
 *
 * 所有测试脚本只允许通过这里发请求：
 *   - 写请求（POST/PUT/PATCH/DELETE）在发出之前必须先过 assertIsolatedEnv()，
 *     校验不过就直接抛错，请求根本不会离开进程；
 *   - 记录每一条由本次运行创建的精确 ID（cleanup 只按这些 ID 删，绝不按名称前缀批量删）。
 */
import { createHash } from 'node:crypto';
import { assertIsolatedEnv, BASE_URL } from './env.mjs';

export const createdIds = new Set();
export const requestLog = [];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** 惰性导入，避免测试脚本在 import 阶段就去连环境。 */
export const prod = { base: 'http://127.0.0.1:3000' };

export async function api(method, pathname, body, { target } = {}) {
  const base = (target || BASE_URL).replace(/\/+$/, '');
  if (WRITE_METHODS.has(method)) {
    await assertIsolatedEnv(base); // 不通过 → 抛错，写请求不会发出
  }
  const res = await fetch(base + pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let detail = null;
  try { detail = text ? JSON.parse(text) : null; } catch { detail = { raw: text.slice(0, 400) }; }
  requestLog.push({ at: new Date().toISOString(), method, url: base + pathname, status: res.status, bodySummary: body === undefined ? null : summarize(body) });
  return { status: res.status, ok: res.ok, detail };
}

function summarize(body) {
  if (!body || typeof body !== 'object') return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string' && v.length > 120) out[k] = v.slice(0, 120) + '…';
    else if (v && typeof v === 'object') out[k] = Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).join(',')}}`;
    else out[k] = v;
  }
  return out;
}

/** 创建一个测试条目并登记它的精确 ID，返回完整对象。 */
export async function createTestEntry(spec, slug) {
  const id = 'agent-' + createHash('sha256').update('nai-testenv:' + slug).digest('hex');
  const res = await api('POST', '/api/chains', { id, ...spec });
  if (!res.ok) throw new Error(`创建测试条目失败 ${slug}: ${res.status} ${JSON.stringify(res.detail)}`);
  createdIds.add(id);
  const got = await api('GET', `/api/chains/${encodeURIComponent(id)}`);
  return got.detail;
}

/** 只删除本次运行记录过的精确 ID。 */
export async function cleanupCreated({ dryRun = false } = {}) {
  const deleted = [];
  const failed = [];
  for (const id of [...createdIds]) {
    if (dryRun) { deleted.push({ id, dryRun: true }); continue; }
    const res = await api('DELETE', `/api/chains/${encodeURIComponent(id)}`);
    if (res.ok || res.status === 404) { deleted.push({ id, status: res.status }); createdIds.delete(id); }
    else failed.push({ id, status: res.status, detail: res.detail });
  }
  return { deleted, failed, remaining: [...createdIds] };
}

/** 只读探查生产实例：允许，但只允许 GET。 */
export async function prodRead(pathname) {
  const res = await fetch(prod.base + pathname, { cache: 'no-store' });
  return { status: res.status, detail: await res.json().catch(() => null) };
}

export function fingerprint(list) {
  const norm = (list || []).map(c => ({ id: c.id, name: c.name, updatedAt: c.updatedAt, type: c.type }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex');
}

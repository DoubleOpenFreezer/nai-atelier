import { validateChainComparison, type ChainComparison } from '../../services/chainComparison';
import { error, json, type RouteContext } from './types';
import { emptyRoleModeConfig, validateRoleModeConfig, validateRoleModeCopy, type RoleModeConfig, type RoleModeCopy } from '../../services/chainRoleModeModel';

async function handleRoleMode({ method, request, db, currentUser }: RouteContext): Promise<Response> {
  if (currentUser.role === 'guest') return error('访客无法访问对比记录', 403);
  const prefix = `chain_role_mode_v1:${currentUser.id}:`;
  if (method === 'GET') {
    const rows = await db.prepare('SELECT key, value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ key: string; value: string }>();
    try {
      let config = emptyRoleModeConfig(); const copies: RoleModeCopy[] = [];
      for (const row of rows.results) { const value: unknown = JSON.parse(row.value); if (row.key === prefix + 'config') { validateRoleModeConfig(value); config = value; } else { validateRoleModeCopy(value); copies.push(value); } }
      return json({ config, copies });
    } catch { return error('对比记录读取失败，请保留资料并重试', 500); }
  }
  if (method !== 'PUT') return error('Method not allowed', 405);
  const raw = await request.text(); if (raw.length > 1_000_000) return error('对比记录过大，请新建记录', 413);
  let kind: 'config' | 'copy', value: RoleModeConfig | RoleModeCopy;
  try { const body = JSON.parse(raw); kind = body.kind; if (kind === 'config') { validateRoleModeConfig(body.config); value = body.config; } else if (kind === 'copy') { validateRoleModeCopy(body.copy); value = body.copy; } else throw new Error(); }
  catch { return error('统一角色副本无效', 400); }
  const key = prefix + (kind === 'config' ? 'config' : `copy:${encodeURIComponent((value as RoleModeCopy).sourceId)}`);
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let previous: RoleModeConfig | RoleModeCopy | undefined;
  try { if (row) { const stored: unknown = JSON.parse(row.value); if (kind === 'config') validateRoleModeConfig(stored); else validateRoleModeCopy(stored); previous = stored as typeof previous; } }
  catch { return error('对比记录读取失败，请保留资料并重试', 500); }
  if ((previous?.revision ?? 0) !== value.revision) return error('对比记录已更新，请重新加载后继续', 409);
  if (kind === 'copy' && previous && JSON.stringify((previous as RoleModeCopy).source) !== JSON.stringify((value as RoleModeCopy).source)) return error('统一角色副本无效', 400);
  const saved = { ...value, revision: value.revision + 1 };
  const result = row ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? RETURNING key').bind(JSON.stringify(saved), key, row.value).first()
    : await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?) RETURNING key').bind(key, JSON.stringify(saved)).first();
  return result ? json({ [kind]: saved }) : error('对比记录已更新，请重新加载后继续', 409);
}

/** 仅保存独立副本和轮次，沿用私人settings及版本比较，不写原串或历史。 */
export async function handleChainComparisonRoute(context: RouteContext): Promise<Response | null> {
  const { path, method, request, db, currentUser } = context;
  if (path === '/api/chain-comparisons/role-mode') return handleRoleMode(context);
  if (path !== '/api/chain-comparisons') return null;
  if (currentUser.role === 'guest') return error('访客无法访问对比记录', 403);
  const prefix = `chain_comparison_v1:${currentUser.id}:`;
  if (method === 'GET') {
    const rows = await db.prepare('SELECT value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ value: string }>();
    try {
      const records = rows.results.map(row => { const value: unknown = JSON.parse(row.value); validateChainComparison(value); return value; });
      return json({ records: records.sort((a, b) => b.updatedAt - a.updatedAt) });
    } catch { return error('对比记录读取失败，请保留资料并重试', 500); }
  }
  if (method !== 'PUT') return error('Method not allowed', 405);
  const raw = await request.text();
  if (raw.length > 1_000_000) return error('对比记录过大，请新建记录', 413);
  let record: ChainComparison;
  try { const value: unknown = JSON.parse(raw); validateChainComparison(value); record = value; }
  catch { return error('对比记录无效', 400); }
  const key = prefix + record.id;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  let previous: ChainComparison | undefined;
  if (row) {
    try { const value: unknown = JSON.parse(row.value); validateChainComparison(value); previous = value; }
    catch { return error('对比记录读取失败，请保留资料并重试', 500); }
  }
  if ((previous?.revision ?? 0) !== record.revision) return error('对比记录已更新，请重新加载后继续', 409);
  for (const round of previous?.rounds || []) {
    if (JSON.stringify(record.rounds.find(item => item.id === round.id)) !== JSON.stringify(round)) return error('已有对比轮次不可覆盖或删除', 400);
  }
  const saved = { ...record, revision: record.revision + 1, updatedAt: Date.now() };
  const result = row
    ? await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ? RETURNING key').bind(JSON.stringify(saved), key, row.value).first()
    : await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?) RETURNING key').bind(key, JSON.stringify(saved)).first();
  if (!result) return error('对比记录已更新，请重新加载后继续', 409);
  return json({ record: saved });
}

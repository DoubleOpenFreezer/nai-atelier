/*
 * 独立测试环境 · 常量与身份守卫（收尾 B）
 *
 * 铁律：任何写请求必须先过 assertIsolatedEnv()。
 * 它做两件事：
 *   1) 目标地址必须是配置里显式写死的测试地址，不能是生产地址；
 *   2) 目标实例必须自报 /api/__testenv/identity 且标识匹配。
 * 任一条不满足 → 抛错终止，写请求根本不会发出。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTENV_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TESTENV_ID = 'isolated-testenv-v1';
export const BASE_URL = 'http://127.0.0.1:3055';
export const PROD_URL = 'http://127.0.0.1:3000';
export const PERSIST_DIR = path.join(TESTENV_DIR, 'persist');
export const SEED_FILE = path.join(TESTENV_DIR, 'seed', 'baseline.json');
export const STATE_FILE = path.join(TESTENV_DIR, '.testenv-state.json');
export const RUNS_DIR = path.join(TESTENV_DIR, 'runs');

export function assertTestTarget(target) {
  const base = String(target || BASE_URL).replace(/\/+$/, '');
  if (base === PROD_URL) throw new Error(`拒绝执行：目标是生产实例 ${PROD_URL}`);
  if (PROD_URL.startsWith(base)) throw new Error(`拒绝执行：${base} 覆盖了生产实例 ${PROD_URL}`);
  if (base !== BASE_URL) throw new Error(`拒绝执行：写了非测试地址 ${base}（测试地址只允许 ${BASE_URL}）`);
  return base;
}

export async function fetchIdentity(base) {
  let res;
  try {
    res = await fetch(`${base}/api/__testenv/identity`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
  } catch {
    return null; // 连不上 = 没有标识 = 不是可写测试环境
  }
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

/** 写请求前必须调用。返回 {base, identity}。 */
export async function assertIsolatedEnv(target) {
  const base = assertTestTarget(target);
  let identity = null;
  try { identity = await fetchIdentity(base); } catch { identity = null; }
  if (!identity || identity.testenv !== true || identity.id !== TESTENV_ID) {
    throw new Error(
      `ISOLATION GUARD BLOCKED WRITES: ${base} 没有返回测试环境标识 ${TESTENV_ID}` +
      `（实际：${JSON.stringify(identity)}）。写入测试终止，未发出任何写请求。`
    );
  }
  return { base, identity };
}

export function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

export function writeState(next) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), 'utf8');
}

/** 本次测试运行专用的输出目录（原始输出留档）。 */
export function runDir(tag) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(RUNS_DIR, `${stamp}-${tag}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function dump(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  return file;
}

/*
 * 独立测试环境 · 数据基线装载（收尾 B）
 *
 *   node nai-atelier-testenv/seed.mjs          建立基线（幂等）
 *   node nai-atelier-testenv/seed.mjs verify   只读校验基线是否在位
 *
 * 可重复使用：id = 'agent-' + sha256('nai-testenv:' + slug)，服务端对 agent-<64hex>
 * 做幂等回放，所以重复执行不会产生第二份条目，也不会覆盖已有内容。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertIsolatedEnv, SEED_FILE, TESTENV_DIR, runDir, dump } from './lib/env.mjs';
import { api } from './lib/guard.mjs';

const spec = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
const mode = (process.argv[2] || 'apply').toLowerCase();
const { base, identity } = await assertIsolatedEnv();
const dir = runDir('seed');

const idFor = slug => 'agent-' + createHash('sha256').update('nai-testenv:' + slug).digest('hex');

const results = [];
const problems = [];

for (const entry of spec.entries) {
  const { slug, ...body } = entry;
  const id = idFor(slug);

  if (mode === 'verify') {
    const got = await api('GET', `/api/chains/${encodeURIComponent(id)}`);
    results.push({ slug, id, status: got.status, found: got.ok, name: got.detail && got.detail.name });
    if (!got.ok) problems.push(`基线缺失: ${slug} (${id})`);
    continue;
  }

  const res = await api('POST', '/api/chains', { id, ...body });
  results.push({ slug, id, status: res.status, replayed: !!(res.detail && res.detail.replayed) });
  if (!res.ok) problems.push(`装载失败: ${slug} -> ${res.status} ${JSON.stringify(res.detail)}`);
}

const list = await api('GET', '/api/chains');
const baselineIds = results.map(r => r.id);
const present = (list.detail || []).filter(c => baselineIds.includes(c.id));

const report = {
  mode,
  base,
  testenvId: identity.id,
  persistRoot: identity.persistRoot,
  results,
  baselineTotal: baselineIds.length,
  baselinePresent: present.length,
  totalInEnv: (list.detail || []).length,
  problems,
};
dump(dir, 'seed-report.json', report);
console.log(JSON.stringify({
  mode, base, testenvId: identity.id,
  baselineTotal: baselineIds.length, baselinePresent: present.length,
  totalInEnv: report.totalInEnv, problems,
}, null, 2));
console.log('raw output:', path.relative(TESTENV_DIR, dir));
process.exitCode = problems.length ? 1 : 0;

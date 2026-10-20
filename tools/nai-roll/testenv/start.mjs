/*
 * 独立测试实例 · 启动 / 停止 / 状态（收尾 B）
 *
 *   node nai-atelier-testenv/start.mjs          启动（已运行则复用）
 *   node nai-atelier-testenv/start.mjs status   查看状态 + 身份标识
 *   node nai-atelier-testenv/start.mjs stop     停止
 *   node nai-atelier-testenv/start.mjs reset    停止并清空隔离数据（只删 nai-atelier-testenv/persist）
 *
 * 与生产实例的关系：共用 dist 产物，但端口(3055)、--persist-to、身份标识全部独立。
 * reset 的删除范围被硬编码限制在隔离目录内，不可能指向真实 workshop。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BASE_URL, PERSIST_DIR, TESTENV_ID, TESTENV_DIR, STATE_FILE, fetchIdentity, readState, writeState } from './lib/env.mjs';

const RUNTIME = process.env.NAI_RUNTIME || 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const NODE = path.join(RUNTIME, 'node.exe');
const WRANGLER = path.join(RUNTIME, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
const PORT = 3055;
const LOG_DIR = path.join(TESTENV_DIR, 'logs');
const OUT_LOG = path.join(LOG_DIR, 'testenv.out.log');
const ERR_LOG = path.join(LOG_DIR, 'testenv.err.log');

async function waitReady(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const identity = await fetchIdentity(BASE_URL);
    if (identity && identity.id === TESTENV_ID) return identity;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function status() {
  const identity = await fetchIdentity(BASE_URL);
  const state = readState();
  const ok = !!(identity && identity.id === TESTENV_ID);
  console.log(JSON.stringify({
    base: BASE_URL,
    expectedId: TESTENV_ID,
    pid: state && state.pid,
    pidAlive: alive(state && state.pid),
    persistDir: PERSIST_DIR,
    identity,
    isolated: ok,
  }, null, 2));
  process.exit(ok ? 0 : 3);
}

async function stop() {
  const state = readState();
  const pid = state && state.pid;
  if (pid && alive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
    // wrangler 会带走它下面的 workerd 子进程；再等一会儿确认端口释放
    await new Promise(r => setTimeout(r, 2500));
    if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ } }
  }
  // 兜底：只结束命令行里带本测试实例特征端口的 wrangler/workerd 进程
  const { execFileSync } = await import('node:child_process');
  try {
    const ps = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*--port ${PORT}*' -and $_.CommandLine -like '*nai-atelier-testenv*' } | ForEach-Object { $_.ProcessId }`
    ], { encoding: 'utf8' });
    for (const line of ps.split(/\r?\n/)) {
      const n = Number(line.trim());
      if (Number.isInteger(n) && n > 0) { try { process.kill(n, 'SIGKILL'); } catch { /* ignore */ } }
    }
  } catch { /* best effort */ }
  fs.rmSync(STATE_FILE, { force: true });
  console.log('stopped', BASE_URL);
}

function reset() {
  const resolved = path.resolve(PERSIST_DIR);
  if (!resolved.startsWith(path.resolve(TESTENV_DIR) + path.sep)) {
    throw new Error('拒绝删除：目标不在隔离目录内 ' + resolved);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
  console.log('isolated data cleared:', resolved);
}

async function start() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(PERSIST_DIR, { recursive: true });

  const running = await fetchIdentity(BASE_URL);
  if (running && running.id === TESTENV_ID) {
    console.log('already running:', BASE_URL, 'id =', running.id);
    return;
  }

  const args = [
    '--no-warnings', '--experimental-vm-modules', WRANGLER,
    'pages', 'dev', path.join(RUNTIME, 'dist'),
    '--persist-to', PERSIST_DIR,
    '--binding', `NAI_TESTENV_ID=${TESTENV_ID}`,
    '--binding', `NAI_TESTENV_PERSIST_ROOT=${PERSIST_DIR}`,
    '--binding', 'PERSONAL_MODE_ENABLED=true',
    '--binding', 'LOCAL_HISTORY_ENABLED=true',
    '--ip', '127.0.0.1',
    '--port', String(PORT),
    '--compatibility-date', '2024-04-01',
    '--show-interactive-dev-session=false',
  ];

  const out = fs.openSync(OUT_LOG, 'a');
  const err = fs.openSync(ERR_LOG, 'a');
  const child = spawn(NODE, args, {
    cwd: TESTENV_DIR,               // ← 决定 --persist-to 的相对基准，也是 wrangler.toml 的位置
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, err],    // 不用管道：避免命名管道限制，日志直接落文件
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1', NO_COLOR: '1' },
  });
  child.unref();
  writeState({ pid: child.pid, port: PORT, base: BASE_URL, persistDir: PERSIST_DIR, startedAt: new Date().toISOString() });

  const identity = await waitReady();
  if (!identity) {
    console.error('test instance did not become ready; see', OUT_LOG, ERR_LOG);
    process.exit(4);
  }
  console.log('isolated test instance ready:', BASE_URL, 'id =', identity.id);
  console.log('persist dir:', PERSIST_DIR);
}

const cmd = (process.argv[2] || 'start').toLowerCase();
if (cmd === 'start') await start();
else if (cmd === 'status') await status();
else if (cmd === 'stop') await stop();
else if (cmd === 'reset') { await stop(); reset(); console.log('下次 start 会得到一份全新的空库；要恢复测试基线请再跑 seed.mjs'); }
else { console.error('usage: start.mjs [start|status|stop|reset]'); process.exit(2); }

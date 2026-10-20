/*
 * 补丁：patches/roll/bump-version.mjs
 * 任务：把 dist 里的版本串整体升一档（默认 atelier-v170-71 → atelier-v170-72）。
 *
 * 为什么需要它：所有模块之间的 import 都带 `?atelier-v<版本>` 查询串，而**文件名不变**
 * （Vite 的 content hash 在打了补丁之后不再更新）。改了文件内容却不换查询串，
 * 浏览器/Workers 缓存里那份旧模块就可能和新模块混用（同一个 chunk 走两条 URL，
 * React 会被加载两次）。所以每次改完 dist 都要整体 bump 一次，再重启。
 *
 * 规则：
 *   · 只改 dist/index.html、dist/assets/*.js、dist/assets/*.css（_worker.js 里没有版本串）；
 *   · 幂等：目标版本已经在位且旧版本已不存在 → no-op；
 *   · 同一个文件里新旧版本同时存在 → 报错并停手（状态不明，不猜）；
 *   · 写入前把每个要改的文件整份备份到 <RUNTIME>/patches/version-bump-<时间戳>/；
 *   · 全部替换完再自检：旧版本串 0 处、新版本串只在预期文件里。
 *
 * 用法：
 *   node patches/roll/bump-version.mjs                          # 170-71 -> 170-72
 *   node patches/roll/bump-version.mjs atelier-v170-72 atelier-v170-73
 */
import fs from 'node:fs';
import path from 'node:path';

const RUNTIME = process.env.NAI_RUNTIME || 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const DIST = path.join(RUNTIME, 'dist');
const ASSETS = path.join(DIST, 'assets');
const FROM = process.argv[2] || 'atelier-v170-71';
const TO = process.argv[3] || 'atelier-v170-72';

function stamp() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
function count(text, needle) {
  return text.split(needle).length - 1;
}
function targets() {
  const list = [path.join(DIST, 'index.html')];
  for (const name of fs.readdirSync(ASSETS)) {
    if (/\.(js|css)$/.test(name)) list.push(path.join(ASSETS, name));
  }
  return list.filter(f => fs.existsSync(f));
}

function run() {
  if (FROM === TO) throw new Error('新旧版本串相同：' + FROM);
  const files = targets();
  let fromTotal = 0;
  let toTotal = 0;
  const plan = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const a = count(text, FROM);
    const b = count(text, TO);
    fromTotal += a;
    toTotal += b;
    if (a && b) throw new Error(`同一个文件里新旧版本同时存在，状态不明，停手：${path.basename(file)} (${FROM}=${a}, ${TO}=${b})`);
    if (a) plan.push({ file, a });
  }
  if (!plan.length) {
    if (toTotal) {
      console.log(`[bump] ${TO} 已在位（旧版本 ${FROM} 0 处）-> no-op（幂等）`);
      return 0;
    }
    throw new Error(`既没有 ${FROM} 也没有 ${TO}，无法判断当前状态`);
  }
  console.log(`[bump] ${FROM} -> ${TO}；涉及 ${plan.length} 个文件，共 ${fromTotal} 处`);

  const bkDir = path.join(RUNTIME, 'patches', `version-bump-${stamp()}`);
  fs.mkdirSync(bkDir, { recursive: true });
  let changed = 0;
  let replaced = 0;
  for (const { file, a } of plan) {
    fs.copyFileSync(file, path.join(bkDir, path.basename(file)));
    const next = fs.readFileSync(file, 'utf8').split(FROM).join(TO);
    if (count(next, FROM) !== 0) throw new Error('替换后仍残留旧版本串：' + file);
    fs.writeFileSync(file, next, 'utf8');
    changed++;
    replaced += a;
  }

  /* 自检 */
  let leftFrom = 0;
  let leftTo = 0;
  for (const file of targets()) {
    const text = fs.readFileSync(file, 'utf8');
    leftFrom += count(text, FROM);
    leftTo += count(text, TO);
  }
  if (leftFrom !== 0) throw new Error('自检失败：dist 里仍有 ' + leftFrom + ' 处 ' + FROM);
  if (leftTo !== toTotal + replaced) throw new Error(`自检失败：${TO} 处数不符（期望 ${toTotal + replaced}，实际 ${leftTo}）`);
  const workerHasVersion = count(fs.readFileSync(path.join(DIST, '_worker.js'), 'utf8'), FROM) + count(fs.readFileSync(path.join(DIST, '_worker.js'), 'utf8'), TO);
  if (workerHasVersion) throw new Error('_worker.js 里出现了版本串，本脚本不该碰它，请检查');

  console.log(`[bump] 完成：${changed} 个文件、${replaced} 处；备份目录 ${path.relative(RUNTIME, bkDir)}`);
  console.log(`[bump] 记得重启应用（NAI Atelier.exe）后再真机点一遍。`);
  return 0;
}

process.exit(run());

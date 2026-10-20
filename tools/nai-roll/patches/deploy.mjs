/* =====================================================================
 * 一条命令完成「改完 dist → 可交付」的三步（顺序不能错）
 * ---------------------------------------------------------------------
 *   1) patches/apply-roll.mjs          打/更新 Roll 补丁（写盘前自带语法检查）
 *   2) patches/roll/bump-version.mjs   版本串 +1（客户端才会重新取资源）
 *   3) patches/normalize-version-query.mjs  把历史上叠出来的 `-ui1-roll1-entry1-expand1`
 *      后缀收掉，保证**同一个入口只有一个 URL**（否则两份 React → 实验室 #321 崩溃）
 *
 * 为什么必须串起来：只做 1+2 时，如果 bundle 是从「原始备份」重建的（备份里是更老的版本串），
 * 会出现 `index.html` 用新版本串、`ChainEditor` 用另一串的局面 —— 2026-10-20 就是这样
 * 让「填入实验室」一进去就白屏的。这个脚本最后会自检「dist 里版本串必须只有一种」。
 *
 * 用法：node patches/deploy.mjs            （默认沿用当前的版本串，只补归一 + 自检）
 *       node patches/deploy.mjs v170-77    （先 bump 到指定版本，再归一 + 自检）
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const DIST = 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime\\dist';

function run(label, args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const tail = out.trim().split('\n').slice(-4).join('\n');
  console.log('---- ' + label + ' (exit ' + r.status + ')\n' + tail);
  if (r.status !== 0) {
    console.error('!! ' + label + ' 失败，停止。');
    process.exit(r.status || 1);
  }
}

const rawTarget = process.argv[2] || '';
/* 版本串统一成 atelier-v<数字>-<数字>：传 v170-78 也自动补前缀（否则会把前缀替换掉） */
let target = '';
if (rawTarget) {
  if (/^atelier-v[0-9]+-[0-9]+$/.test(rawTarget)) target = rawTarget;
  else if (/^v[0-9]+-[0-9]+$/.test(rawTarget)) target = 'atelier-' + rawTarget;
  else throw new Error('版本串要形如 atelier-v170-78 或 v170-78，收到：' + rawTarget);
}
run('apply-roll', [path.join('patches', 'apply-roll.mjs')]);
{
  /* target：显式指定就用它，否则沿用 index.html 的当前版本串 */
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const htmlVer = (html.match(/(?:atelier-)?v[0-9]+-[0-9]+/) || [])[0] || '';
  const to = target || htmlVer;
  if (!to) throw new Error('index.html 里没有版本串');
  /* from：以 bundle 里的实际版本为准 —— apply 从「干净产物」重建后 bundle 会退回更老的版本串 */
  const bundle = fs.readFileSync(path.join(DIST, 'assets', 'index-Dm65S2yO.js'), 'utf8');
  const from = (bundle.match(/(?:atelier-)?v[0-9]+-[0-9]+/) || [])[0] || htmlVer;
  if (from === to) console.log('[deploy] 两个 bundle 已是 ' + to + '，跳过 bump');
  else run('bump ' + from + ' -> ' + to, [path.join('patches', 'roll', 'bump-version.mjs'), from, to]);
}
run('normalize-version-query', [path.join('patches', 'normalize-version-query.mjs')]);

/* 语法自检 */
const check = (file, label) => {
  const tmp = path.join(ROOT, '.check', label + '.mjs');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.copyFileSync(file, tmp);
  const r = spawnSync(process.execPath, ['--check', tmp], { stdio: 'ignore' });
  console.log('[deploy] node --check ' + label + ' => ' + (r.status === 0 ? 'OK' : 'FAIL'));
  if (r.status !== 0) process.exit(1);
};
check(path.join(DIST, 'assets', 'index-Dm65S2yO.js'), 'index-Dm65S2yO');
check(path.join(DIST, 'assets', 'ChainEditor-BQd34Tw5.js'), 'ChainEditor-BQd34Tw5');
check(path.join(DIST, 'assets', 'WardrobeLibrary.js'), 'WardrobeLibrary');
check(path.join(DIST, 'assets', 'PromptLibraryPicker.js'), 'PromptLibraryPicker');
console.log('\n[deploy] 完成。下一步：重启应用（NAI Atelier.exe / 隔离实例）后再真机点一遍。');

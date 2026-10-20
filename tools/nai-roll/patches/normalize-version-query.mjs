/* =====================================================================
 * 版本查询串归一：把 `atelier-v<ver>-ui1-roll1-entry1-expand1` 一律收成 `atelier-v<ver>`
 * ---------------------------------------------------------------------
 * 为什么要做：自研 bump 工具在历史上把「缓存后缀」越叠越长（ui1 → roll1 → entry1 → expand1），
 * 结果 dist 里同一个入口存在两种 URL：
 *   index.html 与懒加载块： ./index-Dm65S2yO.js?atelier-v170-76-ui1-roll1-entry1-expand1
 *   ChainEditor：          ./index-Dm65S2yO.js?atelier-v170-76
 * 浏览器把这两种 URL 当**两个模块**，于是 index（含 React）被加载两份 →
 * 打开实验室就 `Minified React error #321（Invalid hook call）`、随后 removeChild 崩溃。
 * 归一之后所有引用同一个 URL，只有一份 React；版本号本身仍然逐轮递增，缓存照样能失效。
 *
 * 幂等：没有可归一的后缀时不做任何事。写盘前逐文件备份到 patches/backup-version-normalize-<ts>/。
 * 用法：node patches/normalize-version-query.mjs
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const DIST = 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const ROOT = path.join(DIST, 'dist');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SUFFIX = /(atelier-v[0-9]+-[0-9]+)-ui1-roll1-entry1-expand1/g;

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk(ROOT).filter(f => /\.(js|mjs|html|css|json)$/.test(f));
let touched = 0;
let replaced = 0;
const backupDir = path.join(DIST, 'patches', 'backup-version-normalize-' + STAMP);
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const hits = (text.match(SUFFIX) || []).length;
  if (!hits) continue;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(f, path.join(backupDir, path.basename(f)));
  fs.writeFileSync(f, text.replace(SUFFIX, '$1'), 'utf8');
  touched += 1;
  replaced += hits;
  console.log('[ver] ' + path.relative(ROOT, f) + '：' + hits + ' 处');
}
if (!touched) {
  console.log('[ver] 没有需要归一的后缀（幂等跳过）');
} else {
  console.log('[ver] 完成：' + touched + ' 个文件、' + replaced + ' 处；备份 ' + backupDir);
}

/* 归一后自检：整个 dist 只应出现一种版本串（picker-layout 的内容哈希除外） */
const seen = new Map();
for (const f of walk(ROOT).filter(x => /\.(js|mjs|html|css)$/.test(x))) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/atelier-v[0-9]+-[0-9]+[^\s"')]*/g)) {
    const key = m[0].split('=')[0];
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(path.relative(ROOT, f));
  }
}
const keys = [...seen.keys()];
console.log('[ver] 自检：dist 里的版本串 ' + JSON.stringify(keys));
if (keys.length !== 1) {
  console.error('[ver] 警告：仍有多于一种版本串，请检查（这会导致同一个入口被加载两份）');
  process.exitCode = 1;
}

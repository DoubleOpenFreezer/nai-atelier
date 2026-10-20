/* =====================================================================
 * 提示词选择面板（统一选择器）布局修复 —— 「候选列表被底部说明挤成一条缝」
 * ---------------------------------------------------------------------
 * 症状（用户报告）：文生图里点「选择 / 修改」选词库时，候选点不到、看不清，
 *   像是 UI 打架、无法确定选项。
 * 实测（隔离实例、同产物、1500×900）：
 *   面板 560 高；头部+标签+搜索+计数占 172；**列表只剩 82**（约 1.5 行）；
 *   底部 .plp-foot 占 284（= max-height:64%），把列表挤没；
 *   对第二条条目的中心做命中测试，命中的是 .plp-foot，不是条目本身。
 * 修法（只动布局，不动业务逻辑）：
 *   1) .plp-foot 的 max-height 64% → min(210px, 42%)，说明区内部滚动；
 *   2) .plp-actions 不参与压缩（应用/取消按钮永远完整）；
 *   3) 列表保底 96px；4) 面板可用高度上限 560 → 760（视口高时给列表更多空间）；
 *   5) **.plp-foot 补 min-height:0** —— flex 子项默认 min-height:auto，内容高度会压过 max-height。
 *   6) 底部上限用**纯像素**，不要百分比：面板高度是「内容撑开 + max-height」的不定高度，
 *      max-height 里的百分比无法解析，`min(210px,42%)` 会整条失效（实测仍 410px）。
 * 两个文件都是独立资源（PromptLibraryPicker.js 以 `?atelier-v170-72` 引入），
 * 改完必须 bump 版本，否则客户端仍用旧缓存。
 * 幂等：CSS/JS 各自带标记；写 JS 前先 `node --check`，不通过不写盘。
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RUNTIME = 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const ASSETS = path.join(RUNTIME, 'dist', 'assets');
const JS_FILE = path.join(ASSETS, 'PromptLibraryPicker.js');
const CSS_FILE = path.join(ASSETS, 'prompt-library-picker.css');
const CSS_MARK = '/* nai-roll-picker-layout-v1 */';
const JS_MARK = '__NAI_PICKER_LAYOUT_V1__';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function backup(file) {
  const dir = path.join(RUNTIME, 'patches', 'backup-picker-layout-' + STAMP);
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, path.basename(file));
  fs.copyFileSync(file, to);
  return to;
}

function guardText(text, label) {
  const tmp = path.join(RUNTIME, 'patches', '.check-' + label + '.mjs');
  fs.writeFileSync(tmp, text, 'utf8');
  const r = spawnSync(process.execPath, ['--check', tmp], { stdio: 'ignore' });
  fs.unlinkSync(tmp);
  return r.status === 0;
}

/* ---------- 1. CSS ---------- */
const css = fs.readFileSync(CSS_FILE, 'utf8');
if (css.includes(CSS_MARK) && css.includes('max-height: 232px !important')) {
  console.log('[picker] CSS 已是修复后状态（幂等跳过）');
} else {
  const bak = backup(CSS_FILE);
  const block = `\n\n${CSS_MARK}\n`
    + `/* 候选列表优先拿高度。注意两点：\n`
    + `   ① .plp-foot 是 flex 子项，默认 min-height:auto 会让内容压过 max-height，必须归零；\n`
    + `   ② 面板高度是「内容撑开 + max-height」的不定高度，max-height 里的百分比解析不成，\n`
    + `      所以这里只用像素（min(210px,42%) 实测会整条失效）。 */\n`
    + `.plp-foot { max-height: 232px !important; min-height: 0 !important; }\n`
    + `.plp-foot-body { max-height: 112px; min-height: 0; overflow-y: auto; }\n`
    + `.plp-actions { flex: 0 0 auto; }\n`
    + `.plp-list { min-height: 0; }\n`;
  /* 已打过就用整段替换（避免重复叠加）：从标记处截断后再写回 */
  const cut = css.indexOf(CSS_MARK);
  const next = (cut >= 0 ? css.slice(0, cut) : css) + block;
  fs.writeFileSync(CSS_FILE, next, 'utf8');
  console.log('[picker] CSS 已修（备份 ' + path.basename(bak) + '）');
}

/* ---------- 2. JS ---------- */
const js = fs.readFileSync(JS_FILE, 'utf8');
const JS_V1 = 'const maxHeight = Math.max(220, Math.min(760, Math.round(openUp ? above : below))); /* __NAI_PICKER_LAYOUT_V1__ */';
const JS_V2 = 'const maxHeight = Math.max(220, Math.min(760, vh - MARGIN * 2, Math.round(openUp ? above : below))); /* __NAI_PICKER_LAYOUT_V2__ */';
if (js.includes(JS_V2)) {
  console.log('[picker] JS 已是修复后状态（幂等跳过）');
} else if (js.includes('const maxHeight = Math.max(220, Math.min(560, Math.round(openUp ? above : below)));')) {
  const bak = backup(JS_FILE);
  const next = js.replace('const maxHeight = Math.max(220, Math.min(560, Math.round(openUp ? above : below)));', JS_V2);
  if (!guardText(next, 'picker')) throw new Error('syntax guard failed：未写盘');
  fs.writeFileSync(JS_FILE, next, 'utf8');
  console.log('[picker] JS 已修：560 → min(760, 视口-24)（备份 ' + path.basename(bak) + '）');
} else if (js.includes(JS_V1)) {
  const bak = backup(JS_FILE);
  const next = js.replace(JS_V1, JS_V2);
  if (!guardText(next, 'picker')) throw new Error('syntax guard failed：未写盘');
  fs.writeFileSync(JS_FILE, next, 'utf8');
  console.log('[picker] JS 已升级 V1 → V2（补视口夹取，备份 ' + path.basename(bak) + '）');
} else {
  throw new Error('找不到 maxHeight 锚点，未改动 JS');
}
console.log('[picker] 完成。记得 bump 版本 + 重启应用。');

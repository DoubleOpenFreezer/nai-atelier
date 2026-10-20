/* =====================================================================
 * 图片提示词库：点卡片直接进编辑器（原来的「先点预览 → 再点编辑条目」太慢）
 * ---------------------------------------------------------------------
 * 用户要求：点进条目就能直接编辑、顺带设封面，而不是先看只读预览再点「编辑条目」。
 * 现状（WardrobeLibrary.js 卡片注释 §4.2）：点封面 / 标题 / 「预览」都只开只读预览；
 *   编辑要再点预览页头部的「编辑条目」，多一跳。
 * 改动（只改入口指向，不动编辑器本身、不动保存逻辑）：
 *   1) 卡片根节点 onClick / Enter / Space → openEditor(chain)（原来 openPreview）；
 *   2) 卡片标题 title 文案改成「点击打开编辑器」；
 *   3) 卡片那段的注释同步改掉，避免下一个人按旧注释理解；
 *   4) **多选（勾选）模式下保持原行为**：仍然只开只读预览，避免勾选时误进编辑器。
 *   只读预览没有删：卡片右侧的「预览」操作按钮与「更多 → 预览（只读）」都还在。
 * 幂等：以 EDIT_MARK 判断；写盘前先 node --check，不通过不写。
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RUNTIME = 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const FILE = path.join(RUNTIME, 'dist', 'assets', 'WardrobeLibrary.js');
const EDIT_MARK = '__NAI_CARD_OPENS_EDITOR__';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

let src = fs.readFileSync(FILE, 'utf8');
if (src.includes(EDIT_MARK)) {
  console.log('[lib] 已是「点卡片直接进编辑器」状态（幂等跳过）');
  process.exit(0);
}

const edits = [
  /* 1) 根节点点击：多选模式保持只读预览，其它情况直接进编辑器 */
  [
    "        onClick: () => openPreview(chain.id),",
    "        onClick: () => (selectMode ? openPreview(chain.id) : openEditor(chain)), /* " + EDIT_MARK + " */"
  ],
  /* 2) 键盘 Enter / Space 同步 */
  [
    "          event.preventDefault();\n          openPreview(chain.id);\n        },\n        children: [\n          jsx.jsxs('div', { className: 'wardrobe-thumb', children: [",
    "          event.preventDefault();\n          if (selectMode) openPreview(chain.id); else openEditor(chain);\n        },\n        children: [\n          jsx.jsxs('div', { className: 'wardrobe-thumb', children: ["
  ],
  /* 3) 标题文案 */
  [
    "                  title: `${name}（点击查看只读预览）`,",
    "                  title: `${name}（点击打开编辑器）`,"
  ],
  /* 4) 注释同步（避免下一个人按旧注释理解） */
  [
    "     * 点击行为（§4.2）：点封面 / 标题 / 「预览」都只打开只读预览；\n     * 收藏、多选框、「更多」各自独立，不冒泡触发预览，也不误开编辑或应用（U02）。",
    "     * 点击行为（§4.2，已按用户要求调整）：点卡片 / 封面 / 标题 **直接进编辑器**（可立即改内容与封面）；\n     * 「预览」（卡片右侧按钮、以及「更多 → 预览（只读）」）仍然只打开只读预览；\n     * 多选勾选模式下点卡片仍只开只读预览，避免勾选时误进编辑器；\n     * 收藏、多选框、「更多」各自独立，不冒泡触发，也不误开编辑或应用（U02）。"
  ]
];

let next = src;
for (const [from, to] of edits) {
  const hits = next.split(from).length - 1;
  if (hits !== 1) throw new Error('锚点命中 ' + hits + ' 次（应为 1）：' + from.slice(0, 60));
  next = next.replace(from, to);
}

/* 写盘前语法检查 */
const tmp = path.join(RUNTIME, 'patches', '.check-wardrobe.mjs');
fs.writeFileSync(tmp, next, 'utf8');
const r = spawnSync(process.execPath, ['--check', tmp], { stdio: 'ignore' });
fs.unlinkSync(tmp);
if (r.status !== 0) throw new Error('syntax guard failed：未写盘');

const dir = path.join(RUNTIME, 'patches', 'backup-library-direct-edit-' + STAMP);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(FILE, path.join(dir, 'WardrobeLibrary.js'));
fs.writeFileSync(FILE, next, 'utf8');
console.log('[lib] 已改：点卡片直接进编辑器（备份 ' + path.basename(dir) + '）');

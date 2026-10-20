/*
 * 补丁：patches/apply-roll.mjs  （v2 · v170-72「一键 Roll」优化轮）
 * =====================================================================
 * 需求：NAI-Atelier-v170-72一键Roll优化需求.md（P0-1..P0-4 / P1 / P2）
 * 设计：v170-72-roll/优化-设计与实施计划.md
 *
 * 这一版把「一键 Roll」从「直接写英文正文」升级为「先确认、再整表写入、可一次撤销」：
 *
 *   ① index 主 bundle（工作区视图）
 *      注入 纯逻辑核(core.mjs) + 工作区视图(view.js)；
 *      挂侧栏入口 / 移动端底栏入口 / case"roll" / 进入刷新 / 「从实验室返回」记忆。
 *      v2 视图新增：单栏「换一个」、参与与固定语义、上一组/下一组、还原 vs 重算、
 *      组合随机码与证据、风格「保持/替换」分开、存为搭配四态、未消费导入保护。
 *
 *   ② ChainEditor
 *      · 确认面板 + 撤销横幅 + 计划/写入/撤销逻辑（注入 au 组件体）
 *      · Yi 里的 roll-apply 分支改成「只打开确认面板」
 *      · tu 组件登记「整套全局栏一次提交」能力（一次 commitSections = 一次状态变更 + 主体同步）
 *      · Pi 组件登记「角色栏一次提交 + 新建角色 + 移除新建角色」能力
 *      · 两处既有缺陷修正：载入搭配预览读纯字符串形状；保存搭配的幂等键 64 位
 *
 * 特性：幂等（v2 标记已存在即 no-op）、每处一个唯一锚点、写前自动备份、写后自检；
 *       注入片段与 patches/roll/ 下的源文件**逐字节比对**，防止「测的那份」与「跑的那份」分叉。
 *
 * 复现（推荐从干净产物开始，两步都幂等）：
 *   # 0) 若要回到本轮之前的干净产物（可选；有旧版 v1 补丁时建议这样做）
 *   Copy-Item v170-72-roll\before\index-Dm65S2yO.js.bak <runtime>\dist\assets\index-Dm65S2yO.js -Force
 *   Copy-Item v170-72-roll\before\ChainEditor-BQd34Tw5.js.bak <runtime>\dist\assets\ChainEditor-BQd34Tw5.js -Force
 *   # 1) 打补丁
 *   node patches\apply-roll.mjs
 *   # 2) 写入之后必须复查语法（硬约束 1）
 *   Copy-Item <dist>\assets\index-Dm65S2yO.js .check\index-Dm65S2yO.mjs -Force ; node --check .check\index-Dm65S2yO.mjs
 *   Copy-Item <dist>\assets\ChainEditor-BQd34Tw5.js .check\ChainEditor-BQd34Tw5.mjs -Force ; node --check .check\ChainEditor-BQd34Tw5.mjs
 *   # 3) 版本串整体升一档并重启
 *   node patches\roll\bump-version.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, '..');
const RUNTIME = process.env.NAI_RUNTIME || 'G:\\AI\\NAI\\NAI Atelier\\resources\\runtime';
const ASSETS = path.join(RUNTIME, 'dist', 'assets');
const INDEX = path.join(ASSETS, 'index-Dm65S2yO.js');
const CE = path.join(ASSETS, 'ChainEditor-BQd34Tw5.js');
const BACKUP_DIR = path.join(RUNTIME, 'patches');

const READ = name => read(path.join(HERE, 'roll', name));

/* ================= 片段 ================= */
function slice(text, begin, end, label) {
  const a = text.indexOf(begin);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b < a) throw new Error(`fragment markers missing (${label}): ${begin} / ${end}`);
  return text.slice(a, b + end.length);
}
const FRAG = {
  core: slice(READ('core.mjs'), '/* __NAI_ROLL_CORE_BEGIN__ */', '/* __NAI_ROLL_CORE_END__ */', 'core'),
  view: slice(READ('view.js'), '/* __NAI_ROLL_VIEW_BEGIN__ */', '/* __NAI_ROLL_VIEW_END__ */', 'view'),
  panel: slice(READ('panel.js'), '/* __NAI_ROLL_PANEL_BEGIN__ */', '/* __NAI_ROLL_PANEL_END__ */', 'panel'),
  banner: slice(READ('panel.js'), '/* __NAI_ROLL_BANNER_BEGIN__ */', '/* __NAI_ROLL_BANNER_END__ */', 'banner'),
  hostTu: slice(READ('host-tu.js'), '/* __NAI_ROLL_HOST_TU_BEGIN__ */', '/* __NAI_ROLL_HOST_TU_END__ */', 'host-tu'),
  hostPi: slice(READ('host-pi.js'), '/* __NAI_ROLL_HOST_PI_BEGIN__ */', '/* __NAI_ROLL_HOST_PI_END__ */', 'host-pi'),
  hostAu: slice(READ('host-au.js'), '/* __NAI_ROLL_HOST_AU_BEGIN__ */', '/* __NAI_ROLL_HOST_AU_END__ */', 'host-au'),
  apply: slice(READ('apply.js'), '/* __NAI_ROLL_APPLY_BEGIN__ */', '/* __NAI_ROLL_APPLY_END__ */', 'apply'),
  lib: slice(READ('view.js'), '/* __NAI_ROLL_LIB_BEGIN__ */', '/* __NAI_ROLL_LIB_END__ */', 'lib'),
  content: slice(READ('content-load.js'), '/* __NAI_ROLL_CONTENT_BEGIN__ */', '/* __NAI_ROLL_CONTENT_END__ */', 'content')
};

/* ================= 锚点 ================= */
/* index */
const MOUNT_ANCHOR = 'const ax=document.getElementById("root");';
const NAV_WORKSPACE = '{id:"list",label:"风格串",icon:_t.list},{id:"playground",label:"实验室",icon:_t.lab}]}';
const NAV_NEW = '{id:"list",label:"风格串",icon:_t.list},{id:"roll",label:"一键 Roll",icon:__naiRollNavIcon},{id:"playground",label:"实验室",icon:_t.lab}]}';
const MOBILE_ROLL_AFTER = 'g.jsx(et,{label:w("风格串"),active:o==="list",icon:_t.list,onClick:()=>Ue("list")})';
const MOBILE_ROLL_NEW = ',g.jsx(et,{label:w("Roll"),active:o==="roll",icon:__naiRollNavIcon,onClick:()=>Ue("roll")})';
const SWITCH_ANCHOR = 'case"scene":return g.jsx(__naiSceneLibrary,{chains:m,onCreate:U,onSelect:ge=>dt("edit",ge),onDelete:fe,onUpdateChain:Fe,onRefresh:()=>$e(!0),notify:He,returnTargetId:r==="scene"?f:void 0});';
const SWITCH_NEW = 'case"roll":return g.jsx(__NaiRollWorkspace,{chains:m,notify:He,onNavigate:dt,onRefresh:()=>$e(!0)});';
const REFRESH_ANCHOR = '(H==="list"||H==="characters"||H==="wardrobe"||H==="poses"||H==="appearance"||H==="scene"||H==="prompts")';
const REFRESH_NEW = '(H==="list"||H==="roll"||H==="rolllib"||H==="characters"||H==="wardrobe"||H==="poses"||H==="appearance"||H==="scene"||H==="prompts")';
const RETURNLIST_ANCHOR = 'lE=["list","characters","library","aitag","danbooru","pixiv","codex","inspiration","history"]';
const RETURNLIST_NEW = 'lE=["list","roll","rolllib","characters","library","aitag","danbooru","pixiv","codex","inspiration","history"]';
/* Roll 内容库（v170-72 第三轮 · 纯内容搭配库） */
const NAV_ROLL_ENTRY = '{id:"roll",label:"一键 Roll",icon:__naiRollNavIcon}';
const NAV_ROLLLIB_ENTRY = '{id:"rolllib",label:"Roll 内容库",icon:__naiRollLibIcon}';
const SWITCH_ROLL_ANCHOR = 'case"roll":return g.jsx(__NaiRollWorkspace,{chains:m,notify:He,onNavigate:dt,onRefresh:()=>$e(!0)});';
const SWITCH_ROLLLIB = 'case"rolllib":return g.jsx(__NaiRollLibraryWorkspace,{chains:m,notify:He,onNavigate:dt,onRefresh:()=>$e(!0)});';
const VIEW_END_MARK = '/* __NAI_ROLL_VIEW_END__ */';
const CE_LIB_PRESET_FILTER_OLD = 'const __mine=__list.filter(__c=>String(__c&&__c.type||"")==="preset");';
const CE_LIB_PRESET_FILTER_NEW = 'const __mine=__list.filter(__c=>String(__c&&__c.type||"")==="preset"&&!(__c&&__c.params&&__c.params._rollContentSnapshot));';
const CE_LOAD_BTN_ANCHOR = 'e.jsx("button",{type:"button","data-nai-preset-trigger":"load",onClick:PR.openLoad,className:"nai-preset-btn",title:"载入一份已保存的搭配；载入前会先显示覆盖范围",children:"载入搭配"}),';
const CE_STYLE_ROW_ANCHOR = 'e.jsx("span",{className:"text-sm font-semibold text-gray-800 dark:text-gray-100",children:"画师与风格"}),';
const CE_TU_LIBPROP_OLD = 'markChange:h,activeLabLayout:I,mobileEditorTab:v,onRollHost:RH=null})=>{';
const CE_TU_LIBPROP_NEW = 'markChange:h,activeLabLayout:I,mobileEditorTab:v,onRollHost:RH=null,onOpenRollLibrary:ROL=null})=>{';
const CE_TU_LIBCALL_OLD = 'mobileEditorTab:ur,onRollHost:__naiRollRegisterHost}),e.jsx(Pi,{';
const CE_TU_LIBCALL_NEW = 'mobileEditorTab:ur,onRollHost:__naiRollRegisterHost,onOpenRollLibrary:__naiRollOpenPicker}),e.jsx(Pi,{';

/* ChainEditor */
const CE_PARAMS_ONLY = 'if(a.mode==="params-only"){k(a.params),Et(),h("已使用灵感的生成参数。");return}';
const CE_PS_OLD = 'const __ps=(__o,__k)=>String((__o&&__o._promptSections&&__o._promptSections[__k]&&__o._promptSections[__k].text)||"").trim();';
const CE_PS_NEW = 'const __ps=(__o,__k)=>{const __v=__o&&__o._promptSections?__o._promptSections[__k]:null;return String((__v&&typeof __v==="object"?__v.text:__v)||"").trim()};';
const CE_PID_OLD_1 = 'const __rnd=new Uint8Array(16);try{window.crypto.getRandomValues(__rnd)}catch(_e){for(let __i=0;__i<16;__i++)__rnd[__i]=(Date.now()+__i*7)&255}';
const CE_PID_NEW_1 = '/* roll: 服务端只认 agent-[a-f0-9]{64} 作幂等键，32 位会被忽略并另生成 UUID。 */\n        const __rnd=new Uint8Array(32);try{window.crypto.getRandomValues(__rnd)}catch(_e){for(let __i=0;__i<32;__i++)__rnd[__i]=(Date.now()+__i*7)&255}';
const CE_PID_OLD_2 = '__pid="agent-"+Date.now().toString(16).padStart(32,"0").slice(0,32);';
const CE_PID_NEW_2 = '__pid="agent-"+Date.now().toString(16).padStart(64,"0").slice(0,64);';
const AU_LOGIC_ANCHOR = 'const __naiPresetApi={openSave:';
const CE_PRESET_API_OLD = 'count:__naiPresetCount,hasUndo:!!__naiPresetUndo};';
const CE_PRESET_API_NEW = 'count:__naiPresetCount,hasUndo:!!__naiPresetUndo,openRollLibrary:__naiRollOpenPicker};';
const RENDER_ANCHOR = 'children:[__naiPresetState&&e.jsx(__NaiPresetPanel,';
const TU_DESTRUCT = 'markChange:h,activeLabLayout:I,mobileEditorTab:v})=>{';
const TU_DESTRUCT_NEW = 'markChange:h,activeLabLayout:I,mobileEditorTab:v,onRollHost:RH=null})=>{';
const TU_HOOK_ANCHOR = 'const commitSections=(next,metaNext,negNext)=>{SS&&SS(next);SMSS&&SMSS(metaNext);if(negNext!==void 0&&SNSS)SNSS(negNext);S(subjectWithSections(next,legacySubjectText(),prevEffectiveSections()));b("subject");h();};';
const TU_CALL_OLD = 'mobileEditorTab:ur}),e.jsx(Pi,{';
const TU_CALL_NEW = 'mobileEditorTab:ur,onRollHost:__naiRollRegisterHost}),e.jsx(Pi,{';
const PI_DESTRUCT = 'canSaveCharacter:A=!1,onSaveCharacter:de,notify:P})=>{';
const PI_DESTRUCT_NEW = 'canSaveCharacter:A=!1,onSaveCharacter:de,notify:P,onRollHost:RH=null})=>{';
const PI_HOOK_ANCHOR = '};\nconst __naiUndoApply=force=>{';
const PI_CALL_OLD = 'mobileEditorTab:ur}),ee.supportsCharacterReferences';
const PI_CALL_NEW = 'mobileEditorTab:ur,onRollHost:__naiRollRegisterHost}),ee.supportsCharacterReferences';

/* 版本标记（幂等判据） */
const IDX_MARK = "const ALGO = 'nai-roll-2';";
/* 「干净产物」：本项目在开始改之前留的原始备份。fragment 更新后必须从它重建，
   否则 apply 见到已有标记会整段跳过 —— 旧代码会一直留在 dist 里（2026-10-20 踩过）。 */
const PRISTINE_INDEX = path.join(ROOT_DIR, 'v170-72-roll', 'before', 'index-Dm65S2yO.js.bak');
const PRISTINE_CE = path.join(ROOT_DIR, 'v170-72-roll', 'before', 'ChainEditor-BQd34Tw5.js.bak');
const restorePristine = (target, pristine, mark) => {
  try {
    const cur = fs.readFileSync(target, 'utf8');
    if (!cur.includes(mark)) return false;          /* 还没打过补丁，不用重建 */
    if (!fs.existsSync(pristine)) return false;      /* 没有干净产物就按原逻辑走 */
    fs.copyFileSync(pristine, target);
    console.log('[roll] 从干净产物重建：' + path.basename(target) + '（避免旧片段残留）');
    return true;
  } catch (e) {
    console.log('[roll] 重建失败（继续按原逻辑）：' + String((e && e.message) || e));
    return false;
  }
};
const CE_MARK = '__naiRollOpen(a)';
const CE_PS_MARK = 'const __v=__o&&__o._promptSections?__o._promptSections[__k]:null';
const CE_PID_MARK = 'padStart(64,"0").slice(0,64)';
const CE_TU_MARK = '__NAI_ROLL_HOST_TU_BEGIN__';
const CE_PI_MARK = '__NAI_ROLL_HOST_PI_BEGIN__';
const CE_AU_MARK = '__NAI_ROLL_HOST_AU_BEGIN__';
const CE_PANEL_MARK = '__NAI_ROLL_PANEL_BEGIN__';
const CE_RENDER_MARK = '__naiRollApplyUI()';
const CE_LIB_MARK = '__NAI_ROLL_CONTENT_BEGIN__';
const CE_LIB_FILTER_MARK = '__c.params._rollContentSnapshot';
const CE_LIB_BTN_MARK = 'data-nai-rolllib-trigger":"load';

function stamp() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
function backup(file, ts) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `backup-${path.basename(file)}-roll.${ts}.bak`);
  fs.copyFileSync(file, dest);
  return path.relative(RUNTIME, dest);
}
function read(file) {
  if (!fs.existsSync(file)) throw new Error('missing ' + file);
  return fs.readFileSync(file, 'utf8');
}
function uniq(src, needle, label) {
  const first = src.indexOf(needle);
  if (first < 0) throw new Error(`anchor not found (${label}): ${needle.slice(0, 120)}`);
  if (src.indexOf(needle, first + 1) !== -1) throw new Error(`anchor not unique (${label}): ${needle.slice(0, 120)}`);
  return first;
}
/* 写盘之前先让 node 自己解析一遍：括号/引号错位这类问题必须在写盘前拦下来。
   （硬约束 1 要求「写入之后必须复查」，这里再往前挪一步：连不该写的那次都不写。） */
function assertSyntax(text, label) {
  const tmpDir = path.join(process.env.DSH_WORKSPACE || 'C:\\Users\\YPY\\DSH', '.check');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${label}.guard.mjs`);
  fs.writeFileSync(tmp, text, 'utf8');
  const res = spawnSync(process.execPath, ['--check', tmp], { stdio: 'ignore' });
  if (res.status !== 0) throw new Error(`syntax guard failed for ${label} (exit ${res.status}): 产物不会被写入`);
  console.log(`[roll] syntax guard ok: ${label}`);
}
function replaceOnce(src, oldStr, newStr, label) {
  const at = uniq(src, oldStr, label);
  return src.slice(0, at) + newStr + src.slice(at + oldStr.length);
}
function insertAfter(src, needle, payload, label) {
  const at = uniq(src, needle, label);
  return src.slice(0, at + needle.length) + payload + src.slice(at + needle.length);
}
function insertBefore(src, needle, payload, label) {
  const at = uniq(src, needle, label);
  return src.slice(0, at) + payload + src.slice(at);
}
/* 旧版（v1）已经注入过的同名标记区：整段替换成 v2（让「已经装过 v1」的环境也能升级） */
function replaceRegion(src, begin, end, body) {
  const a = src.indexOf(begin);
  if (a < 0) return null;
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error('found begin without end: ' + begin);
  return src.slice(0, a) + body + src.slice(b + end.length);
}
/* 把纯逻辑核从 index 导出、由 ChainEditor 显式导入 —— 两个 chunk 是不同模块，
   共享同一份实现只能走这条依赖（不能再往 ChainEditor 里塞第二份副本）。 */
function appendToExportList(src, entry, label) {
  const at = src.lastIndexOf('export{');
  if (at < 0) throw new Error('export list not found: ' + label);
  const open = src.indexOf('{', at);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { close = i; break; } }
  }
  if (close < 0) throw new Error('export list unbalanced: ' + label);
  if (src.slice(open, close).indexOf(entry) >= 0) return src;
  return src.slice(0, close) + ',' + entry + src.slice(close);
}
function appendToIndexImport(src, entry, label) {
  const marker = 'from"./index-Dm65S2yO.js?atelier-';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('index import not found: ' + label);
  const open = src.lastIndexOf('{', at);
  const close = src.lastIndexOf('}', at);
  if (open < 0 || close < 0 || close < open) throw new Error('import braces not found: ' + label);
  if (src.slice(open, close).indexOf(entry) >= 0) return src;
  return src.slice(0, close) + ',' + entry + src.slice(close);
}

/* ================= ChainEditor ================= */
function patchChainEditor(report, ts) {
  restorePristine(CE, PRISTINE_CE, CE_MARK);
  const src = read(CE);
  const before = src.length;
  const done = {
    panel: src.includes(CE_PANEL_MARK),
    au: src.includes(CE_AU_MARK),
    apply: src.includes(CE_MARK),
    ps: src.includes(CE_PS_MARK),
    pid: src.includes(CE_PID_MARK),
    tuColon: src.includes(CE_TU_MARK),
    piColon: src.includes(CE_PI_MARK),
    render: src.includes(CE_RENDER_MARK),
    ceImport: src.includes('naiRollCore as __naiRollCore'),
    libLogic: src.includes(CE_LIB_MARK),
    libFilter: src.includes(CE_LIB_FILTER_MARK),
    libEntry: src.includes(CE_LIB_BTN_MARK) && src.includes('openRollLibrary:__naiRollOpenPicker'),
    libPicker: src.includes('__naiRollContentUI()')
  };
  if (done.panel && done.au && done.apply && done.ps && done.pid && done.tuColon && done.piColon && done.render && done.ceImport && done.libLogic && done.libFilter && done.libEntry && done.libPicker) {
    console.log('[roll] ChainEditor 已是 v2（面板/逻辑/落盘/两处既有缺陷修正/两个宿主登记/渲染挂载）-> no-op（幂等）');
    report.chainEditor = 'no-op (idempotent)';
    return;
  }
  let next = src;

  /* 0) 旧版 v1 的 roll-apply 分支：整段换成 v2（只打开确认面板） */
  if (!done.apply && next.includes('/* __NAI_ROLL_APPLY_BEGIN__ */')) {
    const replaced = replaceRegion(next, '/* __NAI_ROLL_APPLY_BEGIN__ */', '/* __NAI_ROLL_APPLY_END__ */', FRAG.apply);
    if (replaced) next = replaced;
  }

  /* 1) 面板 + 撤销横幅 + 计划/写入/撤销逻辑：注入 au 组件体（与既有 __NaiPresetPanel 同一层级） */
  if (!done.panel || !done.au) {
    const payload = '\n/* ===== 一键 Roll v2：确认面板 / 撤销横幅 / 计划与写入（见 patches/roll/*） ===== */\n'
      + (done.panel ? '' : FRAG.panel + '\n' + FRAG.banner + '\n')
      + (done.au ? '' : FRAG.hostAu + '\n');
    next = insertBefore(next, AU_LOGIC_ANCHOR, payload, 'au preset api');
  }

  /* 2) Yi 的 roll-apply 分支 */
  if (!next.includes(CE_MARK)) {
    if (next.includes('/* __NAI_ROLL_APPLY_BEGIN__ */')) {
      const replaced = replaceRegion(next, '/* __NAI_ROLL_APPLY_BEGIN__ */', '/* __NAI_ROLL_APPLY_END__ */', FRAG.apply);
      next = replaced || next;
    } else {
      next = insertAfter(next, CE_PARAMS_ONLY, '\n' + FRAG.apply, 'ChainEditor params-only branch');
    }
  }

  /* 3) 两处既有缺陷修正 */
  if (!next.includes(CE_PS_MARK)) next = replaceOnce(next, CE_PS_OLD, CE_PS_NEW, 'preset diff __ps');
  if (!next.includes(CE_PID_MARK)) {
    next = replaceOnce(next, CE_PID_OLD_1, CE_PID_NEW_1, 'preset id rand bytes');
    next = replaceOnce(next, CE_PID_OLD_2, CE_PID_NEW_2, 'preset id fallback');
  }

  /* 4) tu：加 onRollHost 属性 + 登记（一次 commitSections） */
  if (!next.includes(CE_TU_MARK)) {
    next = replaceOnce(next, TU_DESTRUCT, TU_DESTRUCT_NEW, 'tu destructure');
    next = insertAfter(next, TU_HOOK_ANCHOR, '\n' + FRAG.hostTu, 'tu commitSections');
    next = replaceOnce(next, TU_CALL_OLD, TU_CALL_NEW, 'tu call site');
  }

  /* 5) Pi：加 onRollHost 属性 + 登记（角色栏一次提交 / 新建 / 移除） */
  if (!next.includes(CE_PI_MARK)) {
    next = replaceOnce(next, PI_DESTRUCT, PI_DESTRUCT_NEW, 'Pi destructure');
    next = replaceOnce(next, PI_HOOK_ANCHOR, '};\n' + FRAG.hostPi + '\nconst __naiUndoApply=force=>{', 'Pi undoApply');
    next = replaceOnce(next, PI_CALL_OLD, PI_CALL_NEW, 'Pi call site');
  }

  /* 6) 渲染挂载 */
  if (!next.includes(CE_RENDER_MARK)) {
    next = replaceOnce(next, RENDER_ANCHOR, 'children:[__naiRollApplyUI(),__naiRollUndoUI(),__naiPresetState&&e.jsx(__NaiPresetPanel,', 'render children');
  }

  /* 7) 让 ChainEditor 能拿到同一份纯逻辑核（跨 chunk 显式依赖，不复制第二份） */
  if (!next.includes('naiRollCore as __naiRollCore')) {
    next = appendToIndexImport(next, 'naiRollCore as __naiRollCore', 'ChainEditor import');
  }


  /* 8) Roll 内容库（纯内容搭配库）：既有「载入搭配」列表只显示完整搭配；新增工具栏/画师行入口 + 载入逻辑 */
  if (!next.includes(CE_LIB_FILTER_MARK)) {
    next = replaceOnce(next, CE_LIB_PRESET_FILTER_OLD, CE_LIB_PRESET_FILTER_NEW, 'preset list filter (exclude content records)');
  }
  if (!next.includes(CE_LIB_BTN_MARK)) {
    next = insertAfter(next, CE_LOAD_BTN_ANCHOR,
      'e.jsx("button",{type:"button","data-nai-rolllib-trigger":"load",onClick:PR.openRollLibrary,className:"nai-preset-btn",title:"载入一份 Roll 内容（只含六类内容；画师风格与生图参数保持不变）",children:"载入 Roll 内容"}),',
      'preset toolbar (roll library)');
    next = insertAfter(next, CE_STYLE_ROW_ANCHOR,
      'e.jsx("button",{type:"button","data-nai-rolllib-trigger":"style",onClick:()=>{if(typeof ROL==="function")ROL();},className:"ml-1 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-indigo-600 dark:border-gray-700 dark:text-gray-400",title:"选择内容搭配并载入实验室，当前画师风格保持不变",children:"载入 Roll 内容"}),',
      'style row (roll library entry)');
    next = replaceOnce(next, CE_TU_LIBPROP_OLD, CE_TU_LIBPROP_NEW, 'tu destructure (onOpenRollLibrary)');
    next = replaceOnce(next, CE_TU_LIBCALL_OLD, CE_TU_LIBCALL_NEW, 'tu call site (onOpenRollLibrary)');
  }
  if (!next.includes('openRollLibrary:__naiRollOpenPicker')) {
    next = replaceOnce(next, CE_PRESET_API_OLD, CE_PRESET_API_NEW, 'preset api (openRollLibrary)');
  }
  if (!next.includes(CE_LIB_MARK)) {
    next = insertBefore(next, AU_LOGIC_ANCHOR, '\n/* ===== Roll 内容库：载入逻辑与选择器（见 patches/roll/content-load.js） ===== */\n' + FRAG.content + '\n', 'au content logic');
  }
  if (!next.includes('__naiRollContentUI()')) {
    next = replaceOnce(next, 'children:[__naiRollApplyUI(),__naiRollUndoUI(),', 'children:[__naiRollContentUI(),__naiRollApplyUI(),__naiRollUndoUI(),', 'render children (picker)');
  }

  /* ---- 自检 ---- */
  const checks = [
    ['面板', next.includes(CE_PANEL_MARK)],
    ['撤销横幅', next.includes('__NAI_ROLL_BANNER_BEGIN__')],
    ['逻辑', next.includes('const __naiRollConfirm = force =>') && next.includes('const __naiRollUndoRun = force =>')],
    ['落盘分支', next.includes('__naiRollOpen(a)')],
    ['预览修正', next.includes(CE_PS_MARK) && !next.includes(CE_PS_OLD)],
    ['幂等键', next.includes(CE_PID_MARK) && !next.includes(CE_PID_OLD_2)],
    ['tu 登记', next.includes(CE_TU_MARK) && next.includes('onRollHost:RH=null') && next.includes('onRollHost:__naiRollRegisterHost')],
    ['Pi 登记', next.includes(CE_PI_MARK) && next.includes('removePlan')],
    ['渲染挂载', next.includes('children:[__naiRollContentUI(),__naiRollApplyUI(),__naiRollUndoUI()')],
    ['跨 chunk 依赖', next.includes('naiRollCore as __naiRollCore')],
    ['Roll 内容库逻辑', next.includes(CE_LIB_MARK)],
    ['载入搭配列表隔离内容记录', next.includes(CE_LIB_FILTER_MARK)],
    ['Roll 内容库入口', next.includes(CE_LIB_BTN_MARK) && next.includes('openRollLibrary:__naiRollOpenPicker')],
    ['Roll 内容库选择器渲染', next.includes('__naiRollContentUI()')],
    ['宿主引用不外泄', !next.includes('export default __naiRollCore;')]
  ];
  for (const [label, ok] of checks) if (!ok) throw new Error('self-check failed: ' + label);
  if (next.length <= before) throw new Error('self-check: no growth');
  assertSyntax(next, 'ChainEditor-BQd34Tw5');

  const bkp = backup(CE, ts);
  fs.writeFileSync(CE, next, 'utf8');
  console.log('[roll] ChainEditor 已改 v2：+' + (next.length - before) + ' 字符');
  console.log('       chars:', before, '->', next.length, ' backup =', bkp);
  report.chainEditor = `patched (${before} -> ${next.length}) backup=${bkp}`;
}

/* ================= index ================= */
function patchIndex(report, ts) {
  restorePristine(INDEX, PRISTINE_INDEX, IDX_MARK);
  const src = read(INDEX);
  const before = src.length;
  if (src.includes(IDX_MARK) && src.includes('__naiRollCore as naiRollCore') && src.includes('{id:"roll",label:"一键 Roll"') && src.includes('case"roll":return g.jsx(__NaiRollWorkspace') && src.includes('case"rolllib":return g.jsx(__NaiRollLibraryWorkspace') && src.includes('__NAI_ROLL_LIB_BEGIN__')) {
    console.log('[roll] index 已是 v2 -> no-op（幂等）');
    report.index = 'no-op (idempotent)';
    return;
  }
  let next = src;

  /* 1) 模块作用域：纯逻辑核 + 视图（插在 render 之前的语句边界，避免 TDZ 与逗号表达式断裂） */
  if (!next.includes(IDX_MARK) || !next.includes('const __NaiRollWorkspace = props => {')) {
    const header = '\n/* ===== 一键 Roll v2（补丁 patches/apply-roll.mjs；源文件在 patches/roll/）=====\n'
      + '   纯逻辑核（每栏独立随机流 / 单栏换一个 / 四态约束派生 / 证据）+ 工作区视图。\n'
      + '   逻辑核与视图由补丁逐字节比对，防止「测的那份」与「跑的那份」分叉。 */\n';
    next = insertBefore(next, MOUNT_ANCHOR, header + FRAG.core + '\n' + FRAG.view + '\n', 'index mount statement');
  }
  /* 2) 侧栏「工作区」入口 */
  if (!next.includes('{id:"roll",label:"一键 Roll"')) next = replaceOnce(next, NAV_WORKSPACE, NAV_NEW, 'sidebar workspace group');
  /* 3) 移动端底栏入口 */
  if (!next.includes('label:w("Roll")')) next = insertAfter(next, MOBILE_ROLL_AFTER, MOBILE_ROLL_NEW, 'mobile bottom bar');
  /* 4) 视图分发 */
  if (!next.includes('case"roll":return g.jsx(__NaiRollWorkspace')) next = insertAfter(next, SWITCH_ANCHOR, SWITCH_NEW, 'view switch');
  /* 5) 进入 Roll 时刷新数据 */
  if (!next.includes('H==="rolllib"')) {
    const already = next.includes('H==="roll"');
    next = replaceOnce(next, already ? REFRESH_NEW.replace('||H==="rolllib"', '') : REFRESH_ANCHOR, REFRESH_NEW, 'refresh condition');
  }
  /* 6) 从 Roll 进实验室时记住返回目标 */
  if (!next.includes('lE=["list","roll"')) next = replaceOnce(next, RETURNLIST_ANCHOR, RETURNLIST_NEW, 'return-target list');

  /* 7) 把纯逻辑核从 index 导出，供 ChainEditor 显式导入（同一份实现） */
  if (!next.includes('__naiRollCore as naiRollCore')) {
    next = appendToExportList(next, '__naiRollCore as naiRollCore', 'index export');
  }


  /* 7) Roll 内容库（纯内容搭配库）：片段 + 侧栏入口 + 视图分发 */
  if (!next.includes('__NAI_ROLL_LIB_BEGIN__')) {
    next = insertAfter(next, VIEW_END_MARK, '\n' + FRAG.lib + '\n', 'index view end (lib)');
  }
  if (!next.includes(NAV_ROLLLIB_ENTRY)) {
    next = replaceOnce(next, NAV_ROLL_ENTRY, NAV_ROLL_ENTRY + ',' + NAV_ROLLLIB_ENTRY, 'sidebar rolllib entry');
  }
  if (!next.includes('case"rolllib":return g.jsx(__NaiRollLibraryWorkspace')) {
    next = insertAfter(next, SWITCH_ROLL_ANCHOR, SWITCH_ROLLLIB, 'view switch (rolllib)');
  }

  /* ---- 自检 ---- */
  const checks = [
    ['core v2', next.includes("const ALGO = 'nai-roll-2';")],
    ['core 逐字节', next.includes(FRAG.core)],
    ['view 逐字节', next.includes(FRAG.view)],
    ['core 已导出给 ChainEditor', next.includes('__naiRollCore as naiRollCore')],
    ['Roll 内容库片段', next.includes('__NAI_ROLL_LIB_BEGIN__') && next.includes('const __NaiRollLibraryWorkspace = props => {')],
    ['Roll 内容库入口', next.includes(NAV_ROLLLIB_ENTRY)],
    ['Roll 内容库分发', next.includes('case"rolllib":return g.jsx(__NaiRollLibraryWorkspace')],
    ['内容库刷新条件', next.includes('H==="rolllib"')],
    ['node-only export 未外泄', !next.includes('export default __naiRollCore;')],
    ['侧栏入口', next.includes('{id:"roll",label:"一键 Roll"')],
    ['移动端入口', next.includes('label:w("Roll")')],
    ['视图分发', next.includes('case"roll":return g.jsx(__NaiRollWorkspace')],
    ['刷新条件', next.includes('H==="roll"')],
    ['返回记忆', next.includes('lE=["list","roll"')]
  ];
  for (const [label, ok] of checks) if (!ok) throw new Error('self-check failed: ' + label);
  if (next.indexOf('const __naiRollCore = (() => {') > next.indexOf('const ax=document.getElementById("root")')) {
    throw new Error('self-check: roll core injected after mount statement');
  }
  if (next.indexOf('const __NaiRollWorkspace = props => {') > next.indexOf('const ax=document.getElementById("root")')) {
    throw new Error('self-check: roll view injected after mount statement');
  }
  if (next.length <= before) throw new Error('self-check: no growth');
  assertSyntax(next, 'index-Dm65S2yO');

  const bkp = backup(INDEX, ts);
  fs.writeFileSync(INDEX, next, 'utf8');
  console.log('[roll] index 已改 v2：+' + (next.length - before) + ' 字符');
  console.log('       chars:', before, '->', next.length, ' backup =', bkp);
  report.index = `patched (${before} -> ${next.length}) backup=${bkp}`;
}

function run() {
  const ts = stamp();
  const report = {};
  console.log('[roll] runtime = ' + RUNTIME);
  console.log('[roll] 片段字符数：' + Object.keys(FRAG).map(k => k + '=' + FRAG[k].length).join(' / '));
  patchChainEditor(report, ts);
  patchIndex(report, ts);
  console.log('\n[roll] summary: ' + JSON.stringify(report, null, 2));
  console.log('\n[roll] 写完必须复查语法（硬约束 1）：');
  console.log('  Copy-Item <dist>\\assets\\index-Dm65S2yO.js .check\\index-Dm65S2yO.mjs -Force ; node --check .check\\index-Dm65S2yO.mjs');
  console.log('  Copy-Item <dist>\\assets\\ChainEditor-BQd34Tw5.js .check\\ChainEditor-BQd34Tw5.mjs -Force ; node --check .check\\ChainEditor-BQd34Tw5.mjs');
  return 0;
}

process.exit(run());

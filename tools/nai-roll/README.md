# 一键 Roll · 补丁工具链与端到端验收

本目录是「一键 Roll / Roll 内容搭配库」这批改动的**可复现交付物**：补丁脚本、功能片段、端到端验收套件与说明。

## 为什么是补丁而不是源码改动

本批功能是在**已构建产物**（Vite 打包出的 `dist/assets/index-*.js`、`ChainEditor-*.js`）上实现的：这些工作发生在已安装的桌面版运行目录里（`NAI Atelier.exe` 加载的 `resources/runtime/dist`），而该运行目录与仓库源码不是同一份快照。为了不制造「仓库源码与 dist 不一致」的混装状态，本 PR 只交付工具、片段与验收，不提交 `dist`、不改源码。

上游若要并入产品，建议按同一套语义在 `components/` 侧重写（`components/ChainEditor.tsx`、`components/PromptLibraryPicker.tsx` 已在源码中，功能片段里的语义与边界可直接照搬，见 `PR.md`）。

## 目录

```
tools/nai-roll/
├── PR.md                      # PR 正文（问题与效果 / 修改范围 / 验证 / 约束 / 基线）
├── README.md                  # 本文件
├── patches/
│   ├── apply-roll.mjs         # 主注入脚本（幂等、唯一锚点、写前自动备份、写前语法自检、跨 chunk 导出）
│   ├── deploy.mjs             # 打补丁 → bump → 版本串归一 → 四个产物 node --check
│   ├── normalize-version-query.mjs   # 版本查询串归一 + 「dist 只能有一种版本串」自检
│   ├── picker-layout.mjs      # 选择面板版式修复（候选列表被底部说明挤成一条缝）
│   ├── library-direct-edit.mjs# 图片提示词库：点卡片直接进编辑器
│   └── roll/
│       ├── core.mjs           # 纯逻辑核（抽取 / 单栏换一个 / 四态约束 / 证据 / 内容快照白名单）
│       ├── view.js            # 工作区视图（Roll + Roll 内容库 + 封面选图）
│       ├── panel.js           # 实验室确认面板 + 撤销横幅
│       ├── host-tu.js         # 全局分区一次提交（含主体提示词同步）
│       ├── host-pi.js         # 角色分区一次提交（含新建/移除角色）
│       ├── host-au.js         # 计划、应用、撤销、目标角色解析
│       ├── apply.js           # 落盘入口分派（roll-apply / roll-content-load）
│       ├── content-load.js    # Roll 内容库载入 + 选择器
│       └── bump-version.mjs   # 版本串递增（幂等、写前备份）
└── testenv/                   # 端到端验收（需要已安装应用 + 真浏览器）
    ├── start.mjs              # 隔离实例（独立 persist 目录，默认 :3055）
    ├── seed.mjs               # 合成基线数据（幂等）
    ├── lib/{cdp,env,guard,walk,lab}.mjs
    └── tests/roll-*.mjs       # 纯逻辑核 / R01–R18 / 内容库 C01–C23 / bump 冒烟 / 布局几何
```

## 用法

```bash
# 运行目录（默认已安装的桌面版；可用 NAI_RUNTIME 指向别处）
export NAI_RUNTIME="C:/path/to/NAI Atelier/resources/runtime"

node tools/nai-roll/patches/deploy.mjs            # 打补丁 + 版本串归一 + 语法自检
node tools/nai-roll/patches/deploy.mjs v1.91.2    # 顺便把版本串推到指定值

# 隔离实例（有自己的 persist 目录，不会碰 :3000 的生产数据）
node tools/nai-roll/testenv/start.mjs reset
node tools/nai-roll/testenv/seed.mjs

# 验收
node tools/nai-roll/testenv/tests/roll-core-suite.mjs     # 纯逻辑核
node tools/nai-roll/testenv/tests/roll-ui-suite.mjs       # R01–R18 真机
node tools/nai-roll/testenv/tests/roll-content-suite.mjs  # 内容库 C01–C23
node tools/nai-roll/testenv/tests/roll-post-bump-smoke.mjs 3055
node tools/nai-roll/testenv/tests/roll-layout-check.mjs 3055
```

## 与仓库规范的关系

- 本目录的脚本按 `AGENTS.md`「验证梯度」定位为**手动端到端验收**：它们需要已安装的桌面应用、一个隔离实例和真浏览器（CDP），无法纳入 `npm test` 的离线单测，因此随工具放在 `tools/nai-roll/`，不进 `tests/` 自动发现范围。
- 不改 `local-data/`、不改存储键与 binding；隔离实例只用 `testenv/persist`。
- 不调用生成接口、不消耗额度；生产环境只做只读验证。

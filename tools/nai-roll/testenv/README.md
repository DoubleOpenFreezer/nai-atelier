# NAI Atelier · 独立测试环境（v170-68 收尾 B）

**用途**：让写入 / 删除 / 并发 / 超时 / 故障注入等测试**不再碰真实数据**。
程序回退与数据回退分开：这里只负责在**隔离实例**上验证，真实 workshop 数据只做只读核查。

## 它是什么

| 组成 | 说明 |
| --- | --- |
| **独立实例** | `http://127.0.0.1:3055`，`--persist-to ./persist`。与生产**共用同一份 `dist` 产物**（保证测的就是线上那份代码），但数据库 / R2 / 端口 / 身份标识全部独立 |
| **身份标识** | 隔离实例带 `NAI_TESTENV_ID` 绑定 → `GET /api/__testenv/identity` 返回 `{testenv:true,id:"isolated-testenv-v1",persistRoot:…}`。**生产实例没有该绑定，同一路径返回 404** |
| **写入守卫** | `lib/env.mjs` 的 `assertIsolatedEnv()`：目标必须在白名单里，且**必须**先读到正确的身份标识。任一条不满足 → 抛错，**写请求根本不会发出** |
| **数据基线** | `seed/baseline.json` 声明式规格（8 条合成条目：六库类型 + 四态 + 旧结构 + 多角色）。id 由 slug 哈希决定，服务端对 `agent-<64hex>` 幂等回放 → **重复装载不会产生第二份** |
| **原始输出** | 每次运行写到 `runs/<时间戳>-<标签>/` |

## 用法

```powershell
cd C:\Users\YPY\DSH

node nai-atelier-testenv/start.mjs            # 启动（已在运行则复用）
node nai-atelier-testenv/start.mjs status     # 状态 + 身份标识（非隔离时退出码 3）
node nai-atelier-testenv/seed.mjs             # 装载 / 幂等重建基线
node nai-atelier-testenv/seed.mjs verify      # 只读校验基线是否在位

# 自检与套件
node nai-atelier-testenv/tests/guard-selftest.mjs        # 证明守卫会拒绝写生产
node nai-atelier-testenv/tests/b-isolation-suite.mjs     # 创建/编辑/删除/撤销/并发/网络异常
node nai-atelier-testenv/tests/a-save-protection.mjs     # §二 保存保护（真机浏览器）
node nai-atelier-testenv/tests/a-write-audit.mjs         # 写入口审计 + 线上产物核对
node nai-atelier-testenv/tests/prod-readonly2.mjs        # 生产只读冒烟

# v170-72 一键 Roll
node nai-atelier-testenv/tests/roll-core-suite.mjs       # 纯逻辑核单测（不接浏览器；71 项）
node nai-atelier-testenv/tests/roll-ui-suite.mjs         # 真机验收：覆盖需求 R01–R18（62 项）
node nai-atelier-testenv/tests/roll-content-suite.mjs   # Roll 内容库（纯内容快照）：C01–C23 可执行子集（41 项）
node nai-atelier-testenv/tests/roll-layout-check.mjs 3055          # 布局几何：桌面 1500 + 窄屏 390，无溢出/无重叠（10 项）
node nai-atelier-testenv/tests/roll-post-bump-smoke.mjs 3055       # bump 后冒烟（隔离实例）
node nai-atelier-testenv/tests/roll-post-bump-smoke.mjs 3000 prod  # bump 后冒烟（生产，只读）

node nai-atelier-testenv/start.mjs stop       # 停止
node nai-atelier-testenv/start.mjs reset      # 停止并清空隔离数据（只删 nai-atelier-testenv/persist）
```

## 隔离边界（必须遵守）

1. **共用 dist**：测试实例跑的是线上同一份 `dist` 产物。这意味着**改 dist 会同时影响两边**。
2. **不连生产**：脚本显式配置目标地址；指向 `http://127.0.0.1:3000` 或任何非白名单地址都会在发请求前被拒。
3. **只按精确 ID 清理**：`lib/guard.mjs` 记录本次运行创建的每个 ID，清理只删这些 ID，
   **绝不按名称前缀对真实库批量删除**。
4. **资产目录独立**：隔离 R2 在 `persist/v3/r2`；`reset` 的删除范围被硬编码限制在隔离目录内。
5. **不接真实 API Key，不自动调用付费生成**。请求一致性用 HTTP 层捕获验证。
6. **真实条目只读打开、绝不保存。** 生产实例只允许 GET。

## 环境要求

- `G:\AI\NAI\NAI Atelier\resources\runtime\node.exe` 与 `node_modules`（wrangler）存在；
  可用 `NAI_RUNTIME` 覆盖路径。
- 端口 `3055` 空闲。
- 生产实例是否运行不影响本环境。

## 目录

```
start.mjs              启动/停止/状态/重置
wrangler.toml          隔离实例的 pages 配置（D1 / R2 绑定与生产同名 → 但落在独立 persist 目录）
lib/env.mjs            常量 + 地址白名单 + 身份标识校验 + 运行目录
lib/guard.mjs          唯一的请求入口（写前守卫 + 精确 ID 记录 + 指纹）
lib/cdp.mjs            浏览器（Chrome DevTools Protocol）工具
lib/marker-route.mjs   身份标识路由的补丁源（patches/apply-final-b.mjs 使用同一段代码）
seed/baseline.json     数据基线规格
seed.mjs               装载 / 校验基线
tests/                 可重复运行的场景与验收脚本
runs/                  每次运行的原始输出与截图
persist/               隔离 D1 + R2（reset 只删这里）
logs/                  隔离实例的 stdout / stderr
```

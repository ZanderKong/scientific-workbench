# OpenCode 外部 Agent Runtime 集成

本文件说明 Scientific Workbench 与已运行的 OpenCode Server 之间的边界、配置和限制。

## 范围

Workbench 负责：

- 连接设置、健康检查、当前可用模型读取；
- 默认文本模型 / 多模态模型选择；
- 独立 Agent 工作目录；
- `agent-run` 任务（Job type），Session 生命周期、状态、权限快捷处理；
- 右下角全局 Task Stack；
- 通过既有 `scientific-workbench` MCP 向 OpenCode 提供科研上下文。

OpenCode 负责：

- LLM Provider、Agent loop、Tool calling、Session、Conversation；
- 完整 Permission UI 与 Question UI；
- Provider 登录、凭据与完整调试界面。

本阶段**没有**实现：AI Chat 页面、AI Sidebar、Prompt Library、Agent Builder、Provider 管理、Codex/ACP Runtime、多 Agent orchestration，也没有在 Sample/Data/Analysis/Claim 页面增加 AI 按钮。科研领域模型（Sample/Data/Analysis/Claim/…）未改变。

## 连接方式（V2-first，V1 兼容在 Adapter 内）

按当前安装的 OpenCode 自动选择传输，差异只存在于 `apps/server/src/opencode.ts`：

- 优先 V2：`GET /api/info` 返回 JSON `version` 时使用固定版本的 `@opencode/client`；
- 否则 V1（当前安装的 `opencode 1.18.31`）：使用 `/global/health`、`/config/providers`、
  `/session/*`、`/permission`、`/question`、`/event` 的原生 HTTP 传输；
- 两者都不通时报告 `OPENCODE_UNREACHABLE`。

其他代码不得直接引用 OpenCode SDK 或构造 OpenCode URL。

`baseUrl` 默认空字符串。第一版只支持 loopback（`localhost` / `127.0.0.1` / `::1`）、
`http`/`https`、根路径，且拒绝 URL 内嵌用户名密码、query、hash、公网或 LAN 地址。
尾随斜杠会被移除。

V2 推荐运行 `opencode pair` 获取 URL/用户名/密码；固定端口用户运行 `opencode serve`
后填写对应地址。端口不要假定为固定 `4096` 或 `49374`。

## 认证

用户名/密码保存在 `<WORKBENCH_DATA_DIR>/private/opencode-<credentialId>.json`，
权限 `0600`。密码不会进入 `registry/settings.json`、SQLite、Job payload、API 响应、
日志或备份。所有 OpenCode 请求（含 Event/SSE 订阅）共用唯一 client factory，因此
认证头统一注入。空密码输入表示保持当前密码。

## Prompt 语义（异步，非阻塞）

`POST /api/v1/agent-runs` 只负责创建 Job、Session 并**异步**提交 Prompt，成功后返回
`202 Accepted`，不会等待模型生成。Workbench 从不调用同步阻塞入口：

- V2：`@opencode/client` 的 `session.prompt()` 返回 `SessionInboxUser`（入队记录），
  即服务端的异步提交；当前固定版本 `2.0.7` 的 TypeScript 类型没有 `promptAsync`，
  因此不虚构该方法；
- V1：`POST /session/:id/prompt_async`，服务端约 10ms 返回 `204`；
- 绝不会使用 `session.wait`、`session.generate`、`POST /session/:id/message` 等阻塞入口。

Workbench 生成或采用服务端返回的持久 message id（V1 需要 `msg_` 前缀），并把它存进
`agent-run` Job 的 `promptMessageId`；完成判定只以该 id 之后的 assistant 响应为准。

## Agent 工作目录

OpenCode 绝不能运行在科研数据目录。默认执行目录为数据目录的同级
`<dataDir basename>-Agent`。`assertSeparateDirectories()` 拒绝相同路径、互相嵌套和
symlink 重叠；目录以 `0700` 创建。科研数据仍通过：

```text
OpenCode -> scientific-workbench MCP -> Workbench API
```

访问，OpenCode 不直接读写科研数据目录。

Legacy V1 使用实例级 HTTP header 路由工作区：

```http
x-opencode-directory: <executionDir>
```

`executionDir` **不是** `POST /session` 的 JSON body 字段（该字段被忽略）。Adapter 为
所有实例请求统一附带该 header，包括 `/session`、`/session/status`、`/session/:id`、
`/session/:id/message`、`/session/:id/prompt_async`、`/session/:id/abort`、`/mcp`、
`/permission`、`/question`、`/config/providers` 与 `/event`（SSE）——不单独复制 header。
Session 创建后会记录自己的 `directory`，后续 session-scoped 请求优先按 Session 自身的
directory 路由。V2 仍通过 `session.create({ location: { directory } })` 指定。

## Session 状态

`/session/status`（V1）与 `session.active()`（V2 active 快照）被当作**权威快照**使用，
每次轮询重建，而不是与事件缓存 merge：

- 快照中出现 → `busy`；
- 快照中消失（含 idle）→ 不返回 `busy`/`retry`，由完成判定使用 message 结果收敛；
- 事件流是快速增量路径，轮询快照是校正路径；丢失 `session.idle` 也能自愈。

`retry` 仍视为运行中，不作为 idle/failed/completed。

## 模型

Workbench 只读取 OpenCode 当前可用模型并选择默认，不管理 Provider、OAuth、API Key
或 Base URL。

- 文本：已配置 `textModel` 则指定，否则跟随 OpenCode 默认；
- 多模态：`visionModel` → `textModel` → OpenCode 默认；
- 若最终模型明确 `supportsImage = false`，视觉任务以 `422 VISION_MODEL_UNAVAILABLE`
  拒绝；能力未知（`unknown`）允许提交。

## 权限

- `ask`：pending permission 保持 Job `running`，在 Task Stack 中显示黄色 attention，
  单击 `Allow Once` 只回复 `once`。
- `auto-allow`：对**属于本 Workbench 所创建 Session** 的每条 pending permission 自动
  回复 `once`。

`auto-allow` 绝不发送 OpenCode 的 `always`，不会创建持久 project-scoped 权限规则。
OpenCode 配置中的 `deny` 继续由 OpenCode 自己拒绝。Question（V2 form）在 `auto-allow`
下也不会被自动回答。

Child/subagent Session 的 permission 通过父链（最大深度 16）归属到 root Job；未知或
循环链不会自动授权，其他用户手动创建的 Session 不会被 Workbench 批准。

## 连接锁定

存在 `queued` / `running` 的 `agent-run` 时，Server 禁止修改连接身份
（`baseUrl`、`username`、`password`、`executionDir`），否则返回
`409 OPENCODE_CONFIG_IN_USE`。`permissionMode`、`textModel`、`visionModel` 仍可修改，
因为只影响后续任务/权限。`GET /api/v1/integrations/opencode` 返回
`config.connectionLocked`；Settings 页面据此禁用连接相关输入。安全边界在 Server，
UI 只是提示。

## Terminal Notice 与刷新恢复

完成/失败不是新的 Job 状态，而是内存 terminal notice。TaskStack 的完成黑色条幅由
`state.notices`（而非前端 run 状态跳变）驱动：

- Server 对 completed notice 保留约 30 秒 TTL，供浏览器刷新或 SSE 重连；
- 前端每个 notice 只播放一次（内存 `seenNoticeIds`），展示 5 秒后离场并调用
  `POST /agent-runs/:id/dismiss`；
- failed 仍显示橙红方块，点击 dismiss 后从 TaskStack 消失，Job 保持在任务历史。

## 事件与轮询

OpenCode Event 是 live-only，无 replay；因此同时使用：

- Event = 快；
- list/poll = 准（Event 健康 15 秒一次，断开 5 秒一次；无 active Job 时不订阅、不轮询）。

Event 断开后按 1s/2s/5s/10s/30s 退避重连。Server 重启后 `agent-run` 的
`queued/running` Job 会恢复：`running + sessionId` 重新 reconcile；`queued + 无
sessionId` 标记 failed，提示重新发起，不会自动 replay prompt。OpenCode 暂时不可达时
Job 保持 `running`，只有 Session 明确 `404` 才 failed。

## Session 深链

`buildSessionUrl()` 是唯一拼接点，当前规则为 server-scoped：

```text
<baseUrl>/server/<base64url(baseUrl)>/session/<sessionId>
```

如果 OpenCode 路由变化，只修改该 helper。URL 不含密码。

## MCP

Workbench 不自动修改 OpenCode 配置，也不执行 `opencode mcp add`。Settings 只显示
`scientific-workbench` MCP 的连接状态。推荐 token scope 为 `read`/`export`，本阶段
不自动创建 token。

`agent-run` 相关 routes 只注册在 Fastify Server，**不会**进入共享
`packages/core/src/operations.ts`，因此 MCP 不会暴露任务入口，避免
`OpenCode -> MCP -> agent-run -> OpenCode` 递归。

## 已知限制

1. Workbench 不管理 OpenCode Provider；
2. Workbench 不会修改 OpenCode 全局或项目长期权限；
3. `auto-allow` 仅逐条自动批准 `once`，不是 OpenCode `always`；
4. OpenCode 不能直接操作 Workbench 科研数据目录；
5. 科研上下文只通过 MCP；
6. Workbench 只连接已有 OpenCode Server，不自动启动/升级/重启服务；
7. V2 推荐用 `opencode pair` 获取 URL/credentials；
8. 当前业务页面尚未加入 AI 任务入口，任务通过 `POST /api/v1/agent-runs` 创建；
9. 目前只有 OpenCode Runtime，没有 Codex Runtime。

## 测试

自动测试使用 Fake OpenCode（模拟 V2 HTTP 契约）与临时工作区/独立端口，禁止调用真实
模型或 Provider。真实 OpenCode 集成只能通过显式 opt-in（如
`SWB_OPENCODE_TEST_URL`）运行，默认跳过；跳过不被视为真实集成通过。

## 真实验收记录（2026-09-18）

在**隔离的临时环境**中对真实 OpenCode 完成低风险冒烟（`XDG_*` 指向临时目录，独立
Workbench 临时数据目录 `WORKBENCH_DATA_DIR` 与独立端口，未使用 `4317`，未访问
`~/ScientificWorkbench`，未修改用户 OpenCode 全局配置，未升级/重装）：

- OpenCode：`1.18.31`（V1 传输），`@opencode/client@2.0.7`（V2 路径）；
- 连接/版本：`● 已连接 · 1.18.31`；
- 模型列表：真实读取到 7 个可用模型；
- MCP：真实读取到 `scientific-workbench` 为已连接；
- 非阻塞：`POST /api/v1/agent-runs` 约 148ms 返回 `202`，TaskStack 立即显示黑色运行方块；
- 完成：真实模型返回文本并落到 `payload.resultText`；
- Session 深链：`/server/<base64url(baseUrl)>/session/<id>` 返回 OpenCode Web HTML；
- 连接锁定：运行中修改 `baseUrl` 返回 `409 OPENCODE_CONFIG_IN_USE`，修改 `permissionMode`
  成功；三处真实验证后取消任务；
- 刷新恢复：真实浏览器刷新后完成条幅重新出现，5 秒后消失；
- Server 重启恢复：重启 Workbench Server 后运行中 Job 立即恢复为 `running`，随后
  `succeeded`（真实结果约 1246 字）；
- MCP 读取：OpenCode 通过 `scientific-workbench` MCP 读取临时工作台中的 `Smoke Sample`
  并返回标题 `Smoke Sample`，未直接访问科研数据目录。

未触发/未验证项：

- Permission 人工触发：当前真实 OpenCode 默认权限策略下，写工作目录内的文件未产生
  pending permission，因此真机 `Allow Once` 未人工触发；该路径由 Fake/单元/E2E 覆盖。
- 真实 OpenCode 临时不可达：为避免影响真实服务，未执行，标记为 NOT MANUALLY VERIFIED。

## Final directory-routing smoke（2026-09-18）

三目录刻意分离的真实冒烟（OpenCode Server cwd 与 Agent directory 不同）：

```text
Workbench dataDir   = /tmp/swb-opencode-final-smoke/workbench
Agent executionDir  = /tmp/swb-opencode-final-smoke/agent
OpenCode server cwd = /tmp/swb-opencode-final-smoke/server-cwd
```

- 连接：真实 OpenCode `1.18.31`（V1 传输），`connected=true`；
- 非阻塞：`POST /api/v1/agent-runs` 约 0.5s 返回，Job 随即 `running`；
- Session 路由：`GET /session/:id` 返回 `directory=/private/tmp/swb-opencode-final-smoke/agent`，
  等于 executionDir，且不等于 server cwd；
- 文件落点：Agent 创建的 `cwd-smoke.txt`（内容 `cwd-ok`）只出现在
  `agent/`，`server-cwd/` 与 Workbench dataDir 均无该文件；resultText 报告的绝对路径
  指向 agent 目录；
- 完成：Job `succeeded`。丢失 idle 事件后的 polling 自愈由 Fake deterministic 测试覆盖
  （本轮不做真实 SSE 故障注入）。

未人工验证项继续保留：真实 Permission、真实 OpenCode 临时不可达、真实 V2 Server。

## 2026-09-21 Vision Compatibility Spike 审核修复：harness 已重写，真实状态仍 NOT VERIFIED

- 任务：`docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_REVIEW_FIX_PLAN.md` 的 S1/S2/S3。上一轮 Spike 的实际问题是：脚本把 `POST /session`（创建 session）的响应当成模型回答，只在任意 response 文本里搜一个数字就报 PASS，因此“没看图”也能 PASS。
- 结构变更：可执行逻辑移到 `apps/server/src/vision-spike.ts`（可被测试 import），`scripts/spike-opencode-vision.mts` 只负责 opt-in、隔离目录与报告。import 脚本不会发出任何请求；无 `SWB_VISION_SPIKE=1` 时 `exit 1` 且请求数为 0。
- transport：新增边界内实验接口 `submitExperimentalImagePrompt(config, flavor, ...)`（不在 `OpenCodeAdapter` 接口上，产品路径无法触达），按 flavor 选择 `/session/:id/prompt_async`（V1）或 `/api/session/:id/prompt`（V2），并统一带 Basic 认证与 `x-opencode-directory`。文件部分形状是**候选**，只有真实运行环境接受并读回像素才可能升级为支持。
- 证据合取：`isolation` / `runtimeIdentityAndModel` / `asyncSubmission` / `correlatedImageAnswer` / `restrictedAllow` / `restrictedDeny` / `noSensitiveWorkbenchLeakage` 七项各自 PASS/FAIL/NOT VERIFIED，全部 PASS 才总 PASS；任一 FAIL 总 FAIL；否则 NOT VERIFIED。判定条件包括：实际 session 的 `directory` 必须等于专属 Agent 目录；提交必须在阈值内返回且返回时会话仍 busy；答案必须是**提交之后**出现的 assistant 消息且是独立数字；session metadata、用户 prompt 回显、更早的历史消息、其他 session 的消息都不能满足；deny 探针要求哨兵内容从未出现且探针期间未被授予权限，只从配置推断不算。
- fixture：红色方块之间加入白色间隔，具有独立连通区，测试用 4-连通计数验证形状可数；答案只存在于像素。
- 负向矩阵：`apps/server/src/vision-spike.test.ts` 18 项针对假 runtime 逐条证明“不会假 PASS”，包括 metadata 含全部候选数字、prompt 回显正确数字、旧 assistant 消息、同步接口作答、阻塞式提交、错误答案、其他 session 的答案、目录不匹配、deny 实际可读、deny 期间被授予权限、缺版本/缺图片模型、密码缺失、证据去敏。这些测试**不**证明真实 Vision 兼容。
- 实际结果（S3）：本机没有合法可用的隔离真实端点与凭据，且不得读取或改写用户全局配置，因此未发出任何真实调用。**Spike V1：NOT VERIFIED；Spike V2：NOT VERIFIED。**
- 缺少的实测项（明确列出，不能因为“只要设置 URL 就支持”）：真实 version/flavor、实际 model identifier 与 `supportsImage` 声明、真实 image transport 的接受与否与返回结构、真实异步时序、`restrictedAllow` 正向（knowledge 读取、import get/save/commit、Question）与 `restrictedDeny` 反向（shell、任意文件读写、local-path upload、subagent、无关 MCP、网络工具、generic 科学写入）逐项实测、auto-allow 下的 deny 优先级、日志/Job/notice 泄漏检查。
- 结论：受影响 flavor 的 AI 导入 readiness 继续 **关闭（BLOCKED）**：产品内没有任何 AI 导入入口（Phase B2 未实现），不回滚 Phase A/B1。
- 下一项最小调查：在隔离 temp 中启动一个使用合法凭据的真实 OpenCode 服务（独立运行目录/端口、精确 PID 追踪），用 `SWB_SPIKE_OPENCODE_URL` 指向它重跑 harness，先确认 `detectOpenCodeFlavor`、`listModels().supportsImage` 与 session directory 证据，再确认图片 transport；之后才评估 B2。禁止升级用户 runtime、同步 prompt 或放宽权限来制造 PASS。

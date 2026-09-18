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

## 连接方式（V2）

按当前安装的 OpenCode（V2 HTTP Server，`/api/*`）实现，客户端为固定版本的
`@opencode/client`，只允许在 `apps/server/src/opencode.ts` 内导入。其他代码不得
直接引用该 SDK。

`baseUrl` 默认空字符串。第一版只支持 loopback（`localhost` / `127.0.0.1` / `::1`）、
`http`/`https`、根路径，且拒绝 URL 内嵌用户名密码、query、hash、公网或 LAN 地址。
尾随斜杠会被移除。

V2 推荐运行：

```text
opencode pair
```

粘贴其显示的 URL / 用户名 / 密码；固定端口用户运行 `opencode serve` 后填写对应地址。
端口不要假定为固定 `4096` 或 `49374`。

## 认证

用户名/密码保存在 `<WORKBENCH_DATA_DIR>/private/opencode-<credentialId>.json`，
权限 `0600`。密码不会进入 `registry/settings.json`、SQLite、Job payload、API 响应、
日志或备份。所有 OpenCode 请求（含 Event/SSE 订阅）共用唯一 client factory，因此
认证头统一注入。空密码输入表示保持当前密码。

## Agent 工作目录

OpenCode 绝不能运行在科研数据目录。默认执行目录为数据目录的同级
`<dataDir basename>-Agent`。`assertSeparateDirectories()` 拒绝相同路径、互相嵌套和
symlink 重叠；目录以 `0700` 创建。科研数据仍通过：

```text
OpenCode -> scientific-workbench MCP -> Workbench API
```

访问，OpenCode 不直接读写科研数据目录。

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

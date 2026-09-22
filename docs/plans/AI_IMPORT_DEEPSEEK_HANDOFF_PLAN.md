# Scientific Workbench：AI 图片导入收尾执行计划

执行对象：DeepSeek V4.1 / Flash。编制日期：2026-09-22。
本计划用于接续当前本地代码，完成产品交付，不要求重新制定架构。

## 1. 执行指令与基线

请实际完成下面的实现、测试、真实页面验收和交接。不要只回复另一份计划，也不要以后台或模拟测试通过结束任务。

仓库：`/Users/kong/ZanderProject/工作台`。当前 HEAD 为 `a3f73e6`，但大量后续工作尚未提交，包含新增文件；**真实基线是 HEAD 加当前整个工作树**。先执行 `git status --short`、审查 diff 和未跟踪文件，不得 reset/clean、覆盖或重新生成这批工作。若实际状态已变化，先核对差异。

按 AGENTS.md 顺序阅读 HANDOFF、IMPLEMENTATION_PLAN、DESIGN_RULES、PAGE_ACCEPTANCE、DATA_PROTOCOL、VERIFICATION，再读本计划、原 AI_RECORD_IMPORT_DELIVERY_PLAN 及相关代码。历史“第七项延期”已被用户撤销；采用七项前置门槛。历史总计划中的“无内置 AI”不否定后来明确批准的本次窄范围导入。

目标流程：样品页 AI 导入 → 选择、排序图片 → 模型理解与必要 Question 澄清 → B1 整批创建正式样品 → 完成通知 → 用户点击刷新 → 重开后内容和来源仍一致。

## 2. 当前状态：不要把初稿当作完成

| 部分 | 证据与状态 | 接续动作 |
| --- | --- | --- |
| A、B1、导入 Skill | 已有实现和历史回归 | 保持架构，必要时补针对性回归 |
| readiness、独立 attempt、有效策略取证 | 本轮已修补，相关局部测试通过 | 检查接入后的行为，不从头重做 |
| 七项真实 Spike | 同一策略的 profile 与真实 Job/log/notice 证据已汇合 PASS | 核对适用性；不能等同于产品 G2 |
| B2 生命周期、UI 鉴权路由 | 已写初稿，缺专项测试和完整恢复逻辑 | 第一重点 |
| 上传 Modal、样品菜单 | 已写初稿，前端编译失败 | 修复并验收 |
| Task Stack 的取消、重试、刷新动作 | 尚未接齐 | 第二重点 |
| 当前全量回归、真实页面 G2、交付实例 | 未完成 | 必须完成 |

本次交接重新运行 `pnpm --filter @workbench/web exec tsc --noEmit`，失败：`SampleImportModal.tsx:20 TS2554`，`useRef` 缺初始值。`git diff --check` 通过。此前服务端类型检查与 6 文件 77 项局部测试通过，但发生在部分后续 B2 编辑之前，**不能当成当前全树通过**。此前 46 项 E2E 也不是新入口的验收。

### 主要文件

- `apps/server/src/sample-import-runs.ts`：新建、未提交的生命周期初稿。
- `apps/server/src/auth.ts`、`main.ts`：scoped token、UI 控制路由、任务合并与启动恢复接线。
- `apps/server/src/sample-import-agent.ts`：策略、目录与 readiness。
- `apps/server/src/agent-runs.ts`：receipt 通知内部方法和任务类型。
- `apps/server/src/import-observation.ts`：判断关联回复结束。
- `apps/web/src/components/SampleImportModal.tsx`、`sample-import.css`、`pages/SamplesPage.tsx`：输入初稿。
- `apps/web/src/components/TaskStack.tsx`、`App.tsx`：尚待补接。
- `scripts/verify-import-artifacts.mts`、`check-import-artifacts.mts`、`apps/mcp/src/inspect-import-tools.ts`：真实验收接线，不能误当成产品入口。

## 3. 顺序与停止条件

执行顺序为 D0 核对证据/基线 → C1 编译与生命周期 → C2 任务操作与 UI → T1 自动化 → G2 真实页面 → D1 交付。

不新增架构分层、Review、聊天、其他页面 AI 或通用审计系统。不重做 A/B1、parser、serializer、Store.commit、FileRepository。冻结原型和根 index.html 不改；不访问或写入 `~/ScientificWorkbench`，不操作现有 14321/4317/5173 实例。没有授权不得派生子代理。

权限和证据实际不成立时修复对应缺口；不要为了假设风险扩展成新一轮无边界重构。真实凭据、额度或端点阻塞时继续不依赖它们的工作，明确保留未验收状态，不能伪造 PASS。

## 4. D0：复用证据并确认预算

先读 `audit/2026-09-22/ai-import/{profile,artifacts,capability}.json` 与最新 HANDOFF。

- profile run：`2377956c-6acf-4897-9b2c-ce192301b5c3`，10 次提交，前六项 PASS。
- artifact run：`2f5af60d-3a9d-4dec-b938-dbac8c8bf012`，1 次提交，第七项 PASS；真实模型、MCP、B1、Job、日志和通知。六个方块的普通观察已正式保存，Data/镜像/receipt 版本均为 2，Store 重开可读。
- 首次 artifact run `cf221650-12cc-430b-a5e9-336f7e4b9849` 失败，原因是工具步骤被误判为最终回复；保留历史失败及修复测试。
- 合并报告引用两次独立运行；其中图片计数、calls 等 profile 字段不是 artifact run 自身的请求数，不得据此重复计费或宣称单次运行覆盖所有项目。
- 策略 hash `749c0777a8f5c0412013ba8caacc9c9529215f1db1ab22f87ec1ea4cb87e9ad9`；bundle hash `4b4afd8536809476859f32bf3e6867d55db2d14c43eb86fa76e0677189c3ad7b`。

核对当前策略实现、实际生效权限、模型、transport 和 bundle 是否仍匹配。不能手改 hash 让 readiness 通过；涉及证据路径的 B2 修改必须在 G2 重新验证产物最小化。没有相关变化，不必重复整套 S2。

仅允许 V1、OpenCode `1.18.31`、`deepseek/deepseek-v4-flash-vision-exp`。端点 `http://127.0.0.1:4199`，凭据文件 `/Users/kong/.opencode-acceptance/server.env`，只在本地私密读取，不打印、不放 argv/报告/提交。确认服务仍可达，不假定一直运行，不擅自重启。

目前 S2 累计 **49/54，余 5**；G2 **0/10，余 10**。这是既有授权余额，本计划不增加额度、不允许挪用。真实提交前持久计数，失败也计数；Question 后续生成是否新增请求须明确记账，不绕过上限。若余额不足，一次性给出余下场景、用途及所需上限并申请追加。

## 5. C1：完成可靠生命周期

先修复明确的前端 useRef 类型错误；整理新增代码为正常格式和明确类型，不用 any、吞错或削弱测试过关。

审查并补齐 `sample-import-runs.ts`，以下是当前代码可见的接续问题；每项先建立失败或缺失行为的针对性测试，再修复：

1. **失败后的执行资格**：当前权限请求/无 receipt 结束等分支只把 Job 标为 failed，未统一撤销 attempt/token；轮询又只扫描 active Job。禁止形成“界面失败但旧 runtime 仍可提交”的窗口。明确终态处理：先对账 receipt；无 receipt 时持久撤销资格，再尽力 abort；abort 失败不能恢复资格。提交先完成则必须认定成功，不能删除实体。
2. **start/retry/cancel 并发**：start 已有串行保护，但 retry 本身没有。使用每 import 的一致互斥和 CAS；避免 retry 调用 start 造成嵌套锁死。两个相同 retry 返回同一新 Job/attempt，不能互相撤销。旧任务事件、旧取消操作不得更改新 attempt。
3. **响应丢失和重启**：当前 recover 对创建阶段直接失败，没有 session 创建响应丢失的真正对账。使用预先持久化关联和现有 session 查询确认归属；无法唯一确认时进入明确 attention/不确定状态，禁止盲目重发。发送前持久化 messageId；已发送任务恢复监听而非再次生成。不要为此新增科研事实快照。
4. **异步返回后资格复核**：逐一检查创建 session、读配置、图像解码、问题/权限/消息查询后的边界，防止已取消或替换的 attempt 被写回 running 或继续发送。使用受控 Promise/屏障测试，不靠 sleep 猜时序。
5. **receipt 优先**：receipt 是成功唯一依据。成功之后 runtime 报错、重连、重启不得变失败或重建实体；失败/不确定任务的恢复也要先对账，不能仅过滤 active Job 后永久漏掉已有 receipt。
6. **最终回复判断**：`importReplyEnded` 目前强依赖 `status === idle`。核对 V1 idle 是否可能从状态表消失；使用实际协议中可靠的关联/完成证据，不能把工具步骤、旧回复或模型自述当作结束/成功。证据不足保留不确定。
7. **私密输入与重试**：当前 retry 只从内存取 note，重启后可能丢失。必要暂态输入用受限私密文件恢复；取消、失败、重试和成功的保留/清理策略一致，长期 Job 不保存 prompt/draft/OCR/图片。用户说明不得被默默丢弃，也不演化为长期科研事实副本。
8. **关闭生命周期**：跟踪并妥善结束正在 dispatch/reconcile 的异步任务，避免 shutdown 后继续访问已关闭 Store。仅释放本任务的 managed directory/资源，不停止共享 OpenCode 服务；恢复不重新发模型请求。
9. **作用域和漂移**：验证 HTTP scoped token 与 MCP 双层约束、旧 token 撤销、attempt 身份、当前配置/运行时漂移。readiness 要保留可显示的具体原因；现在笼统 catch 为 RUNTIME_UNREACHABLE 的分支应区分可确定的配置/绑定错误。

保留 UI-only 的 readiness/start 接口；不加入科学 operations/MCP。start 只接受 attempt/version 和可选说明；同请求 replay 返回同 Job，变更身份或参数冲突。202 不等待模型完成。

**C1 验收**：覆盖真实 Store/B1 的并发 start、retry、cancel/commit 两种顺序、每个 dispatch 阶段重启、session/发送响应丢失、旧事件、权限失败后晚提交、receipt 后 runtime 错误、跨 import 越权和私密输入清理。普通 storage/文本任务行为不退化。

## 6. C2：把现有 UI 初稿接成完整流程

### 上传与启动

复用新 Modal，不另建页面。普通新建保持不变；AI 入口在样品新建菜单中可发现。最多 10 张、每张 10 MiB、合计 30 MiB，前后端均验证 JPEG/PNG/WebP。

补验缩略图、页序、移除、单项上传重试、可选说明、实际模型和 readiness 原因。检查 React effect 清理及 StrictMode、连续选图与上传返回竞态、关闭后异步更新、object URL 释放、键盘焦点和窄屏。prepare/start 期间防重复；网络不确定沿用同一 importId 查询，不偷偷改变来源 fingerprint。关闭不取消已启动任务，不删除来源 Data。

### Task Stack、Question、取消和重试

修改 TaskStack 消费 importTask/attention，提供可发现的取消、失败重试和澄清入口，复用现有 Question/session 流程。真实验证会话链接与身份/目录路由，不能仅拼出 URL 就算可用。关键歧义未回答不得 commit；不能自动批准额外权限。普通任务按钮和行为保持原样。

### 完成通知与手动刷新

App 将现有 refresh 回调传给 TaskStack；消费后端 `action: refresh-samples`，仅 committed receipt 导入显示：

> 实验记录导入完成，刷新样品列表查看　[刷新样品]

点击只调用 App.refresh，不打开 session、不导航、不高亮、不置顶；完成前后均不自动刷新。保留搜索、筛选、排序、选择和编辑草稿。pending 防连点，失败保留可重试；hover/focus/pending 暂停通知消失。核对服务端 TTL、客户端计时、SSE 重连、dismiss 与重复通知，避免动作尚在进行却被移除。普通文本任务不显示刷新样品。

## 7. T1：自动化验证

新增生命周期与 scoped auth 的专项测试；复用现有 foundation 测试，避免只测试 mock 自己。浏览器新增 `test/e2e/sample-import.spec.ts`（或等价文件）：只替换 runtime，保留真实 UI、HTTP、上传、parser、B1 commit、文件持久化。

至少验证普通新建、上传排序/失败重试、同身份响应丢失、关闭继续、Question、取消/失败重试、完成不自动刷新、按钮手动刷新及草稿保留、重开读取。对失败/取消和越权断言零新增正式实体，不能只断言错误文案。

产物最小化测试要检查真实已知图片/base64/凭据/draft/OCR 内容及采集完整性；不能只靠几个 JSON 字段名判断。来源 Data 的正式有 provenance 转录允许存在。维持细粒度来源在 Data component/import provenance 中，Sample 正文不重复灌入页行号。Committed registry/receipt 只保留幂等、恢复和基本审计信息。

局部测试通过后运行一次完整 gate；后续只有相关变更/失败才重复：

```bash
pnpm agent:knowledge:check
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
git diff --check
```

逐项记录首次失败、原因、修复和最终结果；S3/IME/旧目录转换等未执行项保持未验收，不把历史通过计入本轮。接口定义变化时核对是否需要生成 OpenAPI，runtime 控制接口不得因此进入科学 operations。

## 8. G2：真实页面验收

使用独立科研目录、独立 Workbench 端口和已授权隔离 OpenCode。预先准备非敏感图片及独立真值表，三组场景覆盖：

1. 一页包含多个样品、不同用量：逐一核对样品数、对象绑定、数值/单位原文、普通观察与属性投影，不串样。
2. 多页属于同一样品：核对归属、页序、共享条件、来源图片和结构化 provenance，不能每页机械创建样品。
3. 关键歧义：页面发起后实际进入 Question，回答前无 commit，用户路径回答后正确提交。

每组从页面上传开始，不用后台手填 draft 替代；核对完成前后无自动刷新，点击后正式实体可见。停止并重启本轮独立 Workbench，核对正文、bindings、Data、原图、provenance、receipt 和重复实体数；重新采集真实 Job/log/notice 证明最小化。

不能以工具调用成功替代科研内容正确。真实请求不足时申请，不将 mock 算 G2。模型/OCR 局限与程序缺陷分别记录，不通过编造缺失数据让场景过关。

## 9. D1：交付与提交

按通过验证的阶段组织本地逻辑提交；审查 tracked 和 untracked 内容，只纳入源代码、测试和脱敏证据。不要把原始日志、凭据、私密运行目录、临时 probe 或用户数据提交。未经新的明确指令不 push、不建 PR。

更新 HANDOFF、VERIFICATION 和当前状态文档；历史失败保留，最新有效状态写清楚。只有真实产品链路完成后 README 才标为可用，注明验证组合与使用步骤，不把验收内部细节塞入普通操作流程。

提供可直接检查的独立运行实例：URL、菜单位置、模型、非敏感示例图片、数据目录、启动/停止方式、进程与日志位置。不可覆盖或擅自重启现有 14321 人工实例。实例使用明确的私密配置路径和 capability 路径；不要依赖开发机器硬编码目录或丢失的临时证据。无需扩大为打包重构。

最终交接逐项列出：代码完成、自动化结果、真实 G2 内容结果、重启结果、预算余额、提交与工作树、剩余服务、用户入口、仍未验收事项。**没有完整 UI、可靠生命周期、真实内容核对、重开验证、全回归和可运行实例，就不得宣称本次目标完成。**

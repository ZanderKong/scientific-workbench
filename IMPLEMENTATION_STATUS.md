# 首版实现状态

更新：2026-09-15。批准计划的功能范围已经实现，自动构建、业务回归、真实MCP、真实MinIO和浏览器全流程均通过。首版仍保留真实macOS中文输入法选字这一项人工验收，以及非默认长内容状态的人工视觉巡检；不把自动composition事件代替人工结果。当前接续以 [HANDOFF.md](./HANDOFF.md) 为准。

当前四包构建通过；最终单元、服务和真实MCP流程合计72项通过，浏览器28项通过。普通测试明确跳过两项容器S3测试，随后已在隔离MinIO中单独复跑2项通过。原型及用户日常工作区未修改。

已取得局部证据：样品默认列表、描述/FTIR Data、分析已保存布局、固定论点、原料列表与详情的同内容原型对照；正文实际保存与恢复、创建意图、版本冲突、Data多入口、证据冻结、文件独立重建、本地完整备份恢复及真实MCP流程。每项覆盖范围以报告为准，不扩大为全部状态通过。

已经补齐样品附件与区块身份、对象合并/删除、附件清理预览与证据保护、旧格式转换器、PVA生成器、性能基准、长任务取消及恢复后的启动目录选择。剩余人工项：实际用户旧目录如需转换时核对报告、macOS中文选字、极端长内容的视觉巡检。构建仍报告Vite插件弃用和约731KB单包警告，当前不影响行为验收。

2026-09-11及此前的实现声明已被审核更正；原始审核证据保留于 [audit/REVIEW.md](./audit/REVIEW.md)。

## 2026-09-18 OpenCode 外部 Agent Runtime 集成

按 `SCIENTIFIC_WORKBENCH_OPENCODE_CODING_PLAN_FINAL.md` 完成 OpenCode V2 外部 Agent Runtime 集成：`agent-run` Job、OpenCodeAdapter（唯一协议边界）、AgentRunService（Session/提示/状态/权限/Question/事件/轮询/Recovery/Cancel）、Settings → OpenCode、全局 Task Stack、Jobs 历史 Session 跳转、Fake OpenCode 自动测试。

- 本机实测为 OpenCode V2（CLI 1.18.31 含 `/api/*` 路由），依赖锁定 `@opencode/client@2.0.7`。
- `pnpm typecheck`、`pnpm build` 通过；`pnpm test` 通过（真实S3 2项按设计跳过）；完整 Playwright 40 项通过（含新增 OpenCode 10 项）。冻结原型哈希未变。
- 限制：业务科研页面尚未增加 AI 任务入口；未对真实 OpenCode 做人工端到端验证；`auto-allow` 仅逐条 `once`；科研数据只经 MCP 访问。详见 [docs/OPENCODE_INTEGRATION.md](./docs/OPENCODE_INTEGRATION.md)。完整首版仍未完成。

## 2026-09-18 OpenCode 异步与真实闭环修订

- prompt 提交改为真正异步：V1 `POST /session/:id/prompt_async`（V2 `session.prompt` 即入队），`POST /agent-runs` 返回 `202` 且不等待模型；不调用阻塞入口。
- Adapter 增加 V2-first + V1 兼容检测，差异仅在 `apps/server/src/opencode.ts`；真实 OpenCode 1.18.31 走 V1。
- TaskStack 完成通知改由 terminal notice 驱动，支持刷新/重连恢复；运行中锁定 OpenCode 连接身份（409 `OPENCODE_CONFIG_IN_USE`）。
- 自动回归：`pnpm typecheck`/`build` 通过；`pnpm test`（含新增 V1 适配器测试）与 `pnpm exec playwright test` 44 项通过。
- 真实 OpenCode 隔离冒烟：连接/模型/MCP、非阻塞 202、深链、连接锁定、浏览器刷新恢复、Server 重启恢复、MCP 读取 Sample 均通过；permission 真机未触发与不可达场景标记未人工验证。详见 [docs/OPENCODE_INTEGRATION.md](./docs/OPENCODE_INTEGRATION.md)。完整首版未完成。

# 当前状态与限制

更新：2026-09-21。实现基线 `4f3bafb`，结合后续本地审核。本文面向使用者；逐次命令与历史记录见 [VERIFICATION.md](VERIFICATION.md) 和 [HANDOFF.md](../HANDOFF.md)。

## 可试用的能力

- 样品正文编辑、对象与属性、Data 和附件、分析及固定证据论点。
- 文件持久化、索引重建、备份恢复和旧格式转换工具。
- REST / MCP 接口及 Agent 知识层。
- 可选的本机 OpenCode 连接、任务状态与权限处理基础能力。
- 确定性 sample-import backend：接收暂态 draft，校验后整批创建实体；该能力不是自动图片识别入口。

当前定位为开发预览，不能把上述“已实现”理解为所有平台和边界均完成验收。

## AI 图片导入：在验证组合下开放

AI 图片导入入口位于「样品 → ＋新建样品 右侧箭头 → AI 从实验记录新建样品」。它只在**已真实验证的目标组合**下就绪：

- runtime：OpenCode V1 legacy `1.18.31`，transport `/session/:id/prompt_async`
- 模型：`deepseek/deepseek-v4-flash-vision-exp`
- 受限 profile 与知识 bundle 必须与能力记录一致，且运行时实际生效的目录策略、scoped MCP 工具表与记录逐项相符

任一条件不满足时 readiness 会给出具体原因并拒绝启动，界面不会出现可用状态；这不是通用 AI 能力，换模型或换版本需要重新取证。使用步骤与隔离实例见 [GETTING_STARTED.md](GETTING_STARTED.md) 与项目根 `HANDOFF.md`。

真实页面验收（三组场景：一页多样品、多页同样品、关键歧义走 Question）与重启重开、产物最小化核对见 [VERIFICATION.md](VERIFICATION.md) 2026-09-23 一节。已授权额度 G2 使用 8/10，S2 49/54。

## 使用边界（AI 导入）

- 识别结果必须对照原始记录核查；软件不判断科研结论。
- 关键歧义由模型发起 Question，回答前不会提交；不要把它当作自动批准权限的通道。
- 完成通知只提供「刷新样品」按钮，不会自动刷新列表，也不打开外部会话。
- 真实 macOS 中文输入法、真实 S3、旧工作区转换核对等仍为未验收项。

## 验证范围

2026-09-23 完整 gate（本轮一次执行）：`pnpm agent:knowledge:check` PASS（7 项，bundleHash `4b4afd85…`）；`pnpm typecheck` / `pnpm build` PASS；`pnpm test` = core16 / web14 / mcp4 / server221（真实 S3 2 项按设计跳过）；`pnpm test:e2e` 51 项通过；`pnpm api:spec` 无 diff；`git diff --check` PASS。更早的 46/107 项结果作为历史记录保留。

尚需人工或真实环境验证的内容包括：macOS 中文输入法选字、其余页面状态和长内容体验、实际旧工作区转换核对、真实 S3（需容器）。历史 S3 / OpenCode 冒烟仅代表当时环境，不保证所有服务版本或供应商兼容。

## 使用边界

- 当前主要在 macOS 验证；其他系统尚未完整验收。
- 默认用于个人本机浏览器，不提供已验收的公网多用户部署方案。
- 程序不执行科学事实核查；模拟样例不能用于论文或实验结论。
- 仓库公开，但尚未提供 LICENSE 文件。

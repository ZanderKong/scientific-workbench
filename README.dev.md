# 开发指南

先阅读仓库 [AGENTS.md](AGENTS.md) 和当前 [HANDOFF.md](HANDOFF.md)。产品规则见 [DESIGN_RULES.md](DESIGN_RULES.md)，不要用历史实现代替设计依据。

## 环境与结构

使用 Node.js 22.12+、pnpm 10.14.0。安装依赖：

```bash
pnpm install --frozen-lockfile
```

| 目录 | 职责 |
| --- | --- |
| `packages/core` | 领域类型、正文解析、操作机器契约与知识 bundle 逻辑 |
| `apps/server` | Fastify API、文件持久化、SQLite 索引、存储与 runtime adapter |
| `apps/web` | React / Tiptap 页面和编辑器 |
| `apps/mcp` | 桥接本机 API 的 MCP stdio 服务 |
| `docs/agent` | Agent Guide 与五组协议源文件 |
| `prototype` | 冻结视觉参考，不是运行中的应用 |

## 开发启动

从仓库根目录执行，并显式使用独立工作区：

```bash
WORKBENCH_DATA_DIR="$PWD/data/dev-workspace" pnpm dev
```

访问 **http://127.0.0.1:5173/**。Vite 开发服务器把 `/api` 代理到 **127.0.0.1:4317**。开发模式下应使用 5173 查看页面；4317 可能没有前端产物，或展示上一次构建。

当前 Vite 配置固定代理目标为 4317。不要只修改 `WORKBENCH_PORT` 就期望开发代理跟随变化；如默认端口已占用，可先使用下面的构建启动方式。

## 构建后启动

```bash
pnpm build
WORKBENCH_DATA_DIR="$PWD/data/manual-workspace" WORKBENCH_PORT=14321 pnpm start
```

访问 http://127.0.0.1:14321/ 。Server 同时提供 API 和 `apps/web/dist` 静态页面，无需另开 Vite。修改前端后需重新构建；`pnpm start` 不是开发热更新命令。

不要在开发或测试时使用默认 `~/ScientificWorkbench`，也不要停止用户已有服务。

## 验证

```bash
pnpm agent:knowledge:check
pnpm typecheck
pnpm build
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

- Playwright 使用 14317 和独立临时工作区，`reuseExistingServer: false`。先确保该端口可用。
- 普通测试中的真实 S3 集成项可能按配置跳过；跳过不代表验证通过。
- OpenCode 自动化使用假 runtime；真实模型调用不是普通测试前置条件。
- 当前 Spike 正向测试存在已观察到的时序不稳定，见[状态说明](docs/STATUS.md)。记录原始失败，不能通过删除断言或扩大阈值掩盖。
- 文档等低影响修改只运行相关检查；业务修改按涉及范围运行测试。

## 生成文件与契约

`packages/core/src/operations.ts` 及其引用 schema 是 REST/OpenAPI/MCP 的机器契约来源。

```bash
pnpm api:spec
pnpm agent:knowledge
pnpm agent:knowledge:check
```

OpenAPI 生成到根目录 `openapi.json`。知识 bundle 生成到被忽略的 `apps/server/src/generated/`；启动、构建和测试脚本已接入生成步骤。修改 `docs/agent` 时需要校验 bundle；普通使用文档不属于知识 bundle 源文件。

## 修改与贡献

1. 先核对当前任务范围和未完成工作，不覆盖用户修改。
2. 使用独立数据目录；用模拟资料写测试，不提交凭据或真实科研数据。
3. 保持文件为业务事实来源，SQLite 索引可重建；复用现有 parser 和事务层。
4. 针对行为变化补充必要测试，核对正文落盘、重开、版本冲突和恢复等受影响路径。
5. 检查 `git diff --check`，提交说明写清行为变化和实际验证结果。
6. 更新任务交接；未执行的人工、视觉及外部环境验证保持待验证。

`pnpm benchmark` 使用临时工作区测量保存、提取与补全性能。历史验收证据位于 [docs/VERIFICATION.md](docs/VERIFICATION.md)，不代表当前所有功能或平台均已验证。

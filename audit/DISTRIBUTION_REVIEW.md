# 对外分发与测试内容审查

日期：2026-09-21。检查基线：`8583539`，范围为当前 Git 跟踪树、本机构建产物、包清单预览和对外文档。没有发布 npm 包、创建安装包或改写 Git 历史。

## 结论

测试内容确实存在于源码仓库和部分构建目录中。当前没有独立的用户发行包配置；源码下载、网页静态产物和 npm 包预览必须分别理解。

| 范围 | 检查结果 | 影响 |
| --- | --- | --- |
| Git 跟踪树 | 59 个测试相关文件；audit 下 57 个历史证据文件，共 2,274,840 字节 | clone / 源码归档会包含测试与历史验收证据，这是源码内容，不是自动运行的业务数据 |
| server dist | 124 个 `.test.*` 文件，558,234 字节；另有 test-images 和 vision-spike 产物 | TypeScript 构建未排除测试，复制整个 dist 会携带测试代码 |
| MCP dist | 4 个 `.test.*` 文件，22,246 字节 | 同上 |
| core dist | 16 个 `.test.*` 文件，22,530 字节 | 同上 |
| web dist | 本地 3 个静态文件；所检查的 vitest、FakeRuntime、SENTINEL、PVA-01、验收路径和个人路径标记均未命中 | 未发现这些测试内容进入当前网页产物；不是对所有字节来源的形式化证明 |
| 临时数据 | Git 未跟踪 dist、node_modules、test-results、playwright-report、数据库、private 凭据目录或生成的 demo/workspace | 本地存在不等于上传到 GitHub |
| GitHub Releases | 查询时没有 release | 当前没有可供核查的已发布二进制发行附件 |

数字仅代表本次基线，不应当作长期固定的仓库统计。

## 构建与包清单问题

`apps/server/tsconfig.json`、`apps/mcp/tsconfig.json` 和 `packages/core/tsconfig.json` 均以 `include: ["src"]` 构建，测试与实现同目录，因此测试的 JS、声明及映射文件也会输出到 dist。

用 `npm pack --dry-run --json --ignore-scripts` 分别在根目录及各包目录预览，未创建或发布包：

| 目录 | 包内文件数 | 测试、audit 或 Spike 匹配文件数 |
| --- | ---: | ---: |
| 根目录 | 257 | 99 |
| apps/server | 267 | 165 |
| apps/mcp | 17 | 5 |
| packages/core | 83 | 20 |

各包未设置发行文件白名单。根目录 `private: true` 阻止普通 npm publish，但不使 pack 成为精简发行物；子包也不能直接当成现成的用户安装包。

当前 `pnpm start` 通过 tsx 运行 server 源码，core exports 也指向源码。不要只排除所有 src 或只保留 dist，就声称形成了可运行发行包。后续若需要发行，应先明确运行入口、workspace 依赖及资源路径，再建立独立构建配置和打包白名单。构建排除测试后还需清理旧 dist，避免旧文件残留。

Server 静态服务根目录为 `apps/web/dist`，不是仓库根目录；audit、测试源码和 server dist 不因其存在于仓库中就自动作为网页静态文件提供。首页使用源码启动说明，不承诺二进制安装包。

## 历史资料和本机信息

四份已跟踪文档包含维护者本机 `/Users/kong/` 路径：HANDOFF、VERIFICATION 和两份阶段计划。`audit/reproduction.json` 还包含历史临时目录。它们属于已经公开的历史执行资料，不是运行必需配置；对外示例 mcp.example.json 已使用通用路径。

本轮常见 token、云访问键和私钥头模式扫描未命中。该结果只覆盖当前跟踪文件及所列模式，没有完整扫描 Git 历史，也没有逐张审查所有历史截图，不能宣称不存在任何敏感信息。

本轮未删除历史证据、未移除正常测试源码、未改写历史。若后续需要精简 GitHub 源码归档，可单独制定 export-ignore 规则；Git clone 仍保留完整源码与历史。不要通过删除验证资产来掩盖先前问题。

## 文档修订与建议

- README 按背景与用途、快速启动、设计思想与优势重写。
- 开发指南补充分发边界，避免把源码构建当作精简发行包。
- OpenCode 文档明确目录分离不是操作系统沙箱，普通 ask/auto-allow 不代表 restricted import profile 已验证。
- 后续若正式发行：优先解决测试编译输出、包白名单和启动入口验证；无需为此改动科研实体架构或前端。

本轮属于分发检查与文档修改，不代表完整安全审计、完整业务回归或剩余 Spike 问题关闭。

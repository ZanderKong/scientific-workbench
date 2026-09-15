# 开发说明

首版代码位于 `packages/core`、`apps/server`、`apps/web` 和 `apps/mcp`。运行 `pnpm install && pnpm dev` 后，浏览器访问 `http://127.0.0.1:4317`。

服务会在启动时初始化数据目录。默认目录是 `~/ScientificWorkbench`，也可以使用 `WORKBENCH_DATA_DIR=/path/to/dir` 指定。完整备份恢复到新目录后，普通 macOS 启动会在下次重启时使用该目录；显式环境变量始终优先。原型 `index.html` 保持不变，仅用于视觉对照。文件格式见 [`docs/FILE_FORMAT.md`](./docs/FILE_FORMAT.md)，API/MCP 见 [`docs/API_MCP.md`](./docs/API_MCP.md)。

`pnpm demo` 只向不存在的 `demo/workspace` 写入完整 PVA 验收样例，不覆盖已有目录。`pnpm benchmark` 使用临时工作区测量 20/100/500 个操作和 5,000/50,000 个对象的保存、提取与补全耗时。

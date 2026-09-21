# Scientific Workbench · 科研工作台

实验记录通常分散在笔记、数据文件和分析文档中，难以持续维护样品、操作、结果与结论之间的关系。Scientific Workbench 是一个在本机运行的科研记录工作台，用于记录实验过程、关联原始数据、组织分析，并保存论点及其创建时的证据。

项目面向个人科研工作流，提供浏览器界面、文件存储以及 REST / MCP 接口。当前为开发预览；AI 图片导入尚未开放，其他已知限制见[当前状态](docs/STATUS.md)。

## 快速启动

需要 **Node.js 22.12+** 和 **pnpm 10.14.0**。以下命令适用于 macOS/Linux shell；当前验证主要在 macOS 上完成。

```bash
git clone https://github.com/ZanderKong/scientific-workbench.git
cd scientific-workbench
pnpm install --frozen-lockfile
pnpm build
WORKBENCH_DATA_DIR="$HOME/ScientificWorkbench-preview" pnpm start
```

打开 **http://127.0.0.1:4317/**。首次试用请选择全新数据目录，以后使用相同路径启动即可继续编辑；按 `Ctrl+C` 停止服务不会删除数据。

端口已占用时，在启动命令中增加 `WORKBENCH_PORT=14321`，并访问对应端口。需要模拟样例、备份或迁移说明，请阅读[使用指南](docs/GETTING_STARTED.md)和[演示指南](docs/DEMO.md)。

## 设计思想与优势

### 以科研正文为记录基础

用分层正文描述操作，以对象引用和属性语法表达条件。有效内容通过确定性解析形成结构化投影，普通文字仍然保留，减少正文与属性表之间的重复维护。

### 将样品、数据与证据分开管理

Sample 记录样品过程；Data 管理原始附件及派生内容，可被多个样品引用；Analysis 组织相关资料；正式 Claim 保存创建时的证据快照。共享数据与固定证据各有明确身份，便于追溯来源和后续修改。

### 文件保存事实，索引支持查询

科研正文与关系保存在 Markdown、YAML 和 JSON 文件中，SQLite 用于索引和查询。结合版本检查、文件事务及备份恢复机制，支持记录重开、索引重建与独立工作区恢复。

### 外部工具通过统一接口协作

REST 与 MCP 共用操作契约，提供受授权约束的读取和写入；Agent 知识协议说明记录方式与操作边界。OpenCode 是可选的外部 runtime，不影响常规记录功能。软件不判断实验结论是否正确，AI 生成内容仍需对照原始资料核查。

---

[使用指南](docs/GETTING_STARTED.md) · [文档索引](docs/README.md) · [开发指南](README.dev.md) · [当前状态](docs/STATUS.md) · [问题反馈](https://github.com/ZanderKong/scientific-workbench/issues)

仓库目前未提供 LICENSE 文件，公开可见不代表已授予开源许可证。

# Scientific Workbench · 科研工作台

一个在本机运行的科研记录工作台：围绕样品记录实验过程，关联原始数据与附件，组织分析，并保存论点及其当时的证据。

科研正文与关系保存在 Markdown、YAML 和 JSON 文件中，SQLite 用于索引与查询。通过 REST API 和 MCP，可以让外部工具读取上下文或执行授权操作。

> **当前为开发预览。** 常规记录、数据、分析和证据流程已实现，部分人工验收仍在进行。AI 图片导入尚未开放；真实 Vision 与 restricted profile 未通过完整验证。详见[当前状态](docs/STATUS.md)。

## 能做什么

- **记录样品**：用分层正文记录步骤、对象和条件，保留稳定区块身份，支持自动保存与版本冲突处理。
- **管理数据**：将原始附件、处理结果、图像和说明组织为 Data，支持多个样品关联同一份数据。
- **组织分析与论点**：组合样品和数据，导出上下文；从 Data 或 Analysis 创建带固定证据的正式 Claim。
- **维护科研资源**：管理原料、设备、过程、属性及别名，明确创建对象，不自动猜测类别。
- **本地存储与备份**：业务事实保存在文件中，支持索引重建、备份及恢复到新目录；S3 存储为可选功能。
- **连接外部工具**：提供 REST、MCP 和 Agent 知识协议；可选连接已经运行的本机 OpenCode Server。

## 快速开始

需要 **Node.js 22.12+** 和 **pnpm 10.14.0**。以下命令适用于 macOS/Linux shell；当前人工验证主要在 macOS 上完成，其他平台尚未完整验收。

```bash
git clone https://github.com/ZanderKong/scientific-workbench.git
cd scientific-workbench
pnpm install --frozen-lockfile
pnpm build
WORKBENCH_DATA_DIR="$HOME/ScientificWorkbench-preview" pnpm start
```

打开 **http://127.0.0.1:4317/**。首次试用请选择一个全新的目录；以后使用相同路径启动即可继续读取已保存内容。终端按 `Ctrl+C` 停止服务，数据不会因此删除。

端口已被占用时可指定其他端口：

```bash
WORKBENCH_DATA_DIR="$HOME/ScientificWorkbench-preview" WORKBENCH_PORT=14321 pnpm start
```

然后访问 http://127.0.0.1:14321/ 。服务默认只监听本机，不是已经配置好的公网协作服务。

### 带样例体验

```bash
pnpm demo
WORKBENCH_DATA_DIR="$PWD/demo/workspace" pnpm start
```

生成器仅接受不存在的目标目录，重复执行不会覆盖已有内容。样例包括 PVA 样品、共享数据、分析和固定证据论点；**全部为软件验收用模拟内容**。更多步骤见[演示指南](docs/DEMO.md)。

## 一个记录示例

```text
- 使用 [磁力搅拌器] 将 [聚乙烯醇] 加入 [水]，进行 [搅拌]
  - [聚乙烯醇]｜添加量：10 g
  - [水]｜添加量：90 g
  - [磁力搅拌器]｜转速：500 rpm｜时间：30 min
```

正文是记录的事实来源。有效语法可生成对象引用和样品属性；普通文本仍可保存。对象未匹配时需要选择已有对象或明确创建。软件不根据这些文字判断实验是否科学合理。

## AI 与外部集成

MCP 可向兼容客户端提供科研上下文及授权操作。OpenCode 集成负责连接与任务状态，不管理模型 Provider，也不自动启动 OpenCode。

确定性实验记录导入 backend 已存在，但它本身不调用模型。**从图片自动生成样品的产品入口尚未实现，不能把 backend 或测试脚本视为可用的 AI 导入功能。**

- [REST 与 MCP 接入](docs/API_MCP.md)
- [OpenCode 集成与限制](docs/OPENCODE_INTEGRATION.md)

## 文档

| 我想…… | 阅读 |
| --- | --- |
| 安装、使用、找到数据和备份 | [使用指南](docs/GETTING_STARTED.md) |
| 用模拟样例检查完整流程 | [演示指南](docs/DEMO.md) |
| 了解可用能力和未验证项 | [当前状态](docs/STATUS.md) |
| 开发或运行测试 | [开发指南](README.dev.md) |
| 迁移旧工作区 | [迁移指南](docs/MIGRATION.md) |
| 查看协议、文件格式和设计资料 | [文档索引](docs/README.md) |

## 反馈与许可

问题和建议请提交到 [GitHub Issues](https://github.com/ZanderKong/scientific-workbench/issues)。请附复现步骤、操作系统、Node/pnpm 版本和提交号；移除真实实验数据、凭据与敏感路径。

仓库目前未提供 LICENSE 文件。公开可见不等于已授予开源许可证；使用、修改和再分发的许可范围需由维护者明确。

# Scientific Workbench Agent Guide

本工作台用确定性文件与索引保存科研事实。所有外部 Agent 只能通过 Workbench 的 REST API / MCP 操作，禁止直接读写科学数据目录。

## 1. 阅读顺序

1. 先读 `protocol-common`：全局文件优先、版本、幂等、权限与歧义规则。
2. 再按任务读一组协议：
   - 样品记录与正文语法：`protocol-sample-document`
   - 对象、角色与属性字典：`protocol-objects-properties`
   - 数据单元与附件：`protocol-data-attachments`
   - 分析与正式论点：`protocol-analysis-claims-evidence`
3. 需要具体工具参数时，用 MCP discovery（`tools/list`）或 OpenAPI（`GET /api/v1/openapi.json`）。协议只描述语义，不复制参数表。

## 2. 知识内容与 ID

- 每条知识内容有稳定 ID（如 `protocol-common`）、版本、内容摘要与内容哈希。
- 通过 `knowledge_index` 取得清单；通过 `knowledge_read` 或 MCP Resource `workbench://knowledge/{id}` 读取正文。
- 内容哈希用于确认你读到的是同一份文本。哈希不会因为与本次任务无关的构建而改变。
- 不存在 ID 返回规范 404。不接受绝对路径、`..`、URL 或任意哈希寻址。

## 3. 工具与权限

- 工具来自统一操作目录。你不是通过本指南获得权限，而是通过服务器配置的 scope/token 获得。
- 没有专门技能（Skill）时，不要编造技能名；按本指南与协议组合现有操作。
- 权限失败时不能寻找后门；返回失败原因并请求用户处理。

## 4. 与文件协议的关系

持久化字段级权威是 `docs/DATA_PROTOCOL.md`；导航见 `docs/FILE_FORMAT.md`。协议文档只解释科研语义与操作边界，不重抄文件字段定义。

## 5. 常见入口操作

工作区状态 `workspace_status`；样品 `sample_list`、`sample_get`、`sample_create`、`document_save`、`document_finalize`；对象 `object_search`、`object_create`；属性 `property_search`、`property_create`；数据 `data_list`、`data_get`、`data_create`、`data_update`；附件 `attachment_get`；分析 `analysis_list`、`analysis_get`、`analysis_create`、`analysis_export_context`；论点 `claim_list`、`claim_get`、`claim_create`；搜索 `search`。

完整列表始终以 `knowledge_index` 引用的操作与 MCP/OpenAPI 为准。

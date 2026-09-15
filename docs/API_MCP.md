# REST 与 MCP

本机服务默认地址为 `http://127.0.0.1:4317/api/v1`。服务须先运行，MCP stdio 进程只桥接 API，不直接写工作区。开发、演示与测试必须显式指定独立数据目录。

当前操作定义位于 [operations.ts](../packages/core/src/operations.ts)，REST OpenAPI 与 MCP 工具由它共同生成。[openapi.json](../openapi.json) 是生成结果，使用 `pnpm api:spec` 更新。该目录描述已接入操作，不代表完整首版所有接口已经验收；缺口以 [交接](../HANDOFF.md) 为准。

实体修改要求 `expectedVersion`；版本或磁盘文件冲突返回 `409`。创建重试使用相同 `Idempotency-Key`（MCP 参数 `idempotencyKey`）及相同输入；同键不同输入拒绝。正文保存和结构提取分开，读取最新结构先完成已保存文档的提取；不会包含浏览器未提交的草稿。

## 连接与权限

在本机设置的连接管理中创建独立 token，复制到 MCP 配置的 `WORKBENCH_API_TOKEN`；REST 使用 `Authorization: Bearer <token>`。token 明文仅在创建时显示，可在本机设置撤销。`WORKBENCH_API_TOKEN` 服务启动配置只引导创建日常权限连接。

日常权限是 `read`、`write`、`export`、`backup`。永久删除、合并、清理、恢复分别需要服务端绑定的 `delete`、`merge`、`cleanup`、`restore` 权限。本机 UI 使用会话凭据，可取得短期一次性危险操作授权；外部 token 不能管理连接或自行领取该授权。`X-Workbench-Scope` 不授予任何权限。

凭据哈希和 S3 密钥存入仅当前用户可读写的 `private/` 文件，不进入业务导出与备份。凭据不要放入 URL、聊天或版本管理；[mcp.example.json](../mcp.example.json) 的占位符必须在本机私有配置中替换。

## 工具、资源与附件

工具包括样品、正文保存/提取/重载、对象/属性、Data 组件与 About、分析布局/上下文、正式 Claim 与证据、任务与备份；以 `workbench://operations` 为准。Data 身份丢失时通过 `document_resolve_data_identity` 明确关联或新建，重复提取不会猜测再建。`attachment_cleanup_preview` 只列引用和可清理状态；`attachment_cleanup` 先复查整批附件，任何一个仍被正文、Data、分析或固定证据引用时均不删除，并要求单独的 `cleanup` 权限。

资源包括 `workbench://syntax`、`workbench://dictionary/objects`、`workbench://dictionary/properties`、`workbench://sample/{id}/document`、`workbench://data/{id}`、`workbench://analysis/{id}/context` 和附件资源。导出正文和清单包含实际实体版本；证据上下文不表示论点已经得到证明。

大附件通过 `/attachments/stream` multipart 流式上传；下载入口仍需认证，不在 URL 中携带 token。MCP 提供受控上传、文本分段和图片资源，不把任意大二进制塞入工具 JSON。长任务返回 job ID，再用 `job_get` 查询；`job_cancel` 可取消仍在运行的备份，取消不会发布部分归档，已经结束的任务返回冲突。失败的附件上传任务可用 `job_retry` 重试。

恢复接口先验证清单、路径和全部哈希，再创建新工作区。普通启动会把验证后的目录写入本机启动选择，下次重启应用后生效；显式设置 `WORKBENCH_DATA_DIR` 时该变量优先，接口会说明没有改变启动选择。

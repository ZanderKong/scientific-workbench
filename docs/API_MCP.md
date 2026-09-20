# REST 与 MCP

本机服务默认地址为 `http://127.0.0.1:4317/api/v1`。服务须先运行，MCP stdio 进程只桥接 API，不直接写工作区。开发、演示与测试必须显式指定独立数据目录。

当前操作定义位于 [operations.ts](../packages/core/src/operations.ts)，REST OpenAPI 与 MCP 工具由它共同生成。[openapi.json](../openapi.json) 是生成结果，使用 `pnpm api:spec` 更新。该目录描述已接入操作，不代表完整首版所有接口已经验收；缺口以 [交接](../HANDOFF.md) 为准。

实体修改要求 `expectedVersion`；版本或磁盘文件冲突返回 `409`。创建重试使用相同 `Idempotency-Key`（MCP 参数 `idempotencyKey`）及相同输入；同键不同输入拒绝。正文保存和结构提取分开，读取最新结构先完成已保存文档的提取；不会包含浏览器未提交的草稿。

`document_save` 的 `bindings` 是正式声明的对象引用绑定数组，与实现语义一致：元素含稳定定位 `blockId`/`start`/`end`/`rawText`、状态 `status`、可选 `objectId`/`intentId`/`role`。越界位置拒绝；指向已不存在区块、缺失对象或伪造创建意图的绑定不会被采纳；它不能用于修改文件头、版本、提取结果或 Data 镜像基线。省略 `bindings` 保留原 references，传空数组清空。HTTP、OpenAPI 与 MCP 使用同一 schema。

## 连接与权限

在本机设置的连接管理中创建独立 token，复制到 MCP 配置的 `WORKBENCH_API_TOKEN`；REST 使用 `Authorization: Bearer <token>`。token 明文仅在创建时显示，可在本机设置撤销。`WORKBENCH_API_TOKEN` 服务启动配置只引导创建日常权限连接。

日常权限是 `read`、`write`、`export`、`backup`。永久删除、合并、清理、恢复分别需要服务端绑定的 `delete`、`merge`、`cleanup`、`restore` 权限。本机 UI 使用会话凭据，可取得短期一次性危险操作授权；外部 token 不能管理连接或自行领取该授权。`X-Workbench-Scope` 不授予任何权限。

凭据哈希和 S3 密钥存入仅当前用户可读写的 `private/` 文件，不进入业务导出与备份。凭据不要放入 URL、聊天或版本管理；[mcp.example.json](../mcp.example.json) 的占位符必须在本机私有配置中替换。

## 工具、资源与附件

工具包括样品、正文保存/提取/重载、对象/属性、Data 组件与 About、分析布局/上下文、正式 Claim 与证据、任务与备份；以 `workbench://operations` 为准。Data 身份丢失时通过 `document_resolve_data_identity` 明确关联或新建，重复提取不会猜测再建。`attachment_cleanup_preview` 只列引用和可清理状态；`attachment_cleanup` 先复查整批附件，任何一个仍被正文、Data、分析或固定证据引用时均不删除，并要求单独的 `cleanup` 权限。

资源包括 `workbench://syntax`、`workbench://knowledge`、`workbench://knowledge/{id}`、`workbench://dictionary/objects`、`workbench://dictionary/properties`、`workbench://sample/{id}/document`、`workbench://data/{id}`、`workbench://analysis/{id}/context` 和附件资源。导出正文和清单包含实际实体版本；证据上下文不表示论点已经得到证明。

## Agent 知识层

内建知识来自 `docs/agent/manifest.json` 与五组协议，由 `pnpm agent:knowledge`（`pnpm agent:knowledge:check` 校验）生成到编译进 server 的 bundle；运行时不读仓库文档。内容 ID 使用固定白名单：`guide`、`protocol-common`、`protocol-sample-document`、`protocol-objects-properties`、`protocol-data-attachments`、`protocol-analysis-claims-evidence`。

- REST：`GET /knowledge` 返回版本、bundle hash 与内容索引（含每项 content hash）；`GET /knowledge/:id` 返回正文、版本、hash 与依赖。未知或路径式 ID 返回 404，仍受原有认证约束。
- MCP：`workbench://knowledge` 索引、`workbench://knowledge/{id}` 内容模板；`workbench://syntax` 保留原 URI 与 Markdown MIME，正文改由 `protocol-sample-document` 承接，不再是手写常量。tools-only 客户端可用 `knowledge_index`/`knowledge_read` 取得同一正文与 hash。
- 服务器内建注入接口只做受控只读读取，不启动 runtime 或模型。知识版本在服务运行期间固定于构建 bundle。

## 确定性实验记录导入

- `document_bind_data`（`POST /documents/:id/blocks/:blockId/bind-data`）把正常 `[数据]` 区块正式绑定到现有 Data，携带 `expectedVersion` 与 `expectedDataVersion`；已绑定同一 Data 幂等，不同 Data 冲突，且不修改 Data 的 About。
- `sample_import_prepare` → `POST /sample-imports`：`importId` + 有序 `attachmentIds`。服务端按附件身份校验数量、单张/合计大小、真实文件头与声明 MIME，并创建一个 shared source Data 与 prepared 记录；相同 `importId` + 相同来源顺序幂等，顺序变化冲突。
- `sample_import_get` → `GET /sample-imports/:id`：未提交返回暂态 draft 与服务器规范化后的 block/occurrence，已提交只返回最小 receipt。
- `sample_import_save_draft` → `PUT /sample-imports/:id/draft`：attempt + record/draft CAS；返回 `recordVersion`、`draftVersion`、`draftHash`、`commitFingerprint`。未知字段与越界结构拒绝。
- `sample_import_commit` → `POST /sample-imports/:id/commit`：携带身份/hash/version/fingerprint，服务端重算比对后整批创建；相同 fingerprint 重试返回原 receipt，指纹变化冲突。
- `sample_import_cancel` / `sample_import_retry`：确定性撤销/重签 attempt，不启动模型。

这些确定性 API 服务普通授权调用者；模型侧的 restricted profile 只暴露 `sample_import_get/save_draft/commit` 与必要读取（见 B2 阶段）。长任务恢复期间，科学实体读取/导出/备份返回 `503 RECOVERY_REQUIRED`，`/health` 报 `degraded`。

大附件通过 `/attachments/stream` multipart 流式上传；下载入口仍需认证，不在 URL 中携带 token。MCP 提供受控上传、文本分段和图片资源，不把任意大二进制塞入工具 JSON。长任务返回 job ID，再用 `job_get` 查询；`job_cancel` 可取消仍在运行的备份，取消不会发布部分归档，已经结束的任务返回冲突。失败的附件上传任务可用 `job_retry` 重试。

恢复接口先验证清单、路径和全部哈希，再创建新工作区。普通启动会把验证后的目录写入本机启动选择，下次重启应用后生效；显式设置 `WORKBENCH_DATA_DIR` 时该变量优先，接口会说明没有改变启动选择。

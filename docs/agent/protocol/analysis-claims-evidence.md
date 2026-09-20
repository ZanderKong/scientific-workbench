# 协议：分析与正式论点（protocol-analysis-claims-evidence）

依赖：`protocol-common`、`guide`。字段权威见 `docs/DATA_PROTOCOL.md`。

## 1. Analysis 结构

- Analysis 引用 Sample、Data、Claim、Resource，但不拥有它们。
- `itemIds` 保存被组织条目的稳定顺序；空选择就是空分析。
- `layout` 保存 `visibleSections`（context/compare/data/artifacts/body/claims）、`hiddenColumns`、`columnOrder`；列键为 `objectId:propertyId`。
- `attachmentIds` 是分析产物附件的不可变 id 列表；解除引用不删除附件字节。
- 修改 Analysis 带 `expectedVersion`；`analysis_finalize` 记录正文历史。

## 2. 正式 Claim 的 host

- 正式 Claim 只从 Data 或 Analysis host 创建：`claim_create` 的 `hostType` 为 `data` 或 `analysis`，`hostId` 为对应实体 id。
- Sample 正文里的 `[论点]` 只是文本，绝不自动升级为正式 Claim。
- Claim 数据库没有全局“新建”按钮；host 表示来源/上下文，不等于论点已被证明。

## 3. 证据冻结

- 创建 Claim 时固定当前上下文：每个实体的实际版本、正文哈希、附件哈希与来源关系，形成证据快照；一并保存分实体阅读版正文。
- 修改 Claim 文字（`claim_update`）不刷新证据。
- 补充证据（`claim_supplement_evidence`）追加新的当前上下文快照，保留旧证据，不覆盖。
- 冻结内容与实时上下文不同：证据卡显示快照的标题/正文/版本，不读取当前内容伪装旧证据。

## 4. 版本、删除与恢复边界

- 每个实体用各自真实版本，不能用一个“最大版本”替代；上下文收集先固定参与样品与共享 Data 版本，再读取集合。
- 删除附件/Data 引用不回滚已存在的证据字节；旧证据引用仍可读取。
- 没有一键历史回滚：正文历史与证据快照只能查看、复制。

## 5. 导出

- `analysis_export_context` 返回去重后的实际正文、版本清单与分实体文档；未绑定项会列出。
- 导出前处理待更新文档；提取失败则导出失败，不能返回假装最新的旧索引。

## 6. 常用操作

`analysis_list`、`analysis_get`、`analysis_create`、`analysis_update`、`analysis_finalize`、`analysis_export_context`、`claim_list`、`claim_get`、`claim_create`、`claim_update`、`claim_finalize`、`claim_supplement_evidence`。参数以 MCP/OpenAPI 为准。

# 文件格式（swb/2）

当前完整协议与字段扩展见 [DATA_PROTOCOL.md](./DATA_PROTOCOL.md)。旧 `swb/1` 不是当前写入格式；旧目录需转换到新目录，不能原地启动或覆盖。使用[旧工作区转换指南](./MIGRATION.md)提供的专用转换器。

Markdown/YAML 和 JSON 清单保存业务事实，SQLite 只保存可重建索引。实体文件分别位于 samples、data、analyses、claims；稳定 UUID 决定文件名，显示名称与样品编号不是文件主键。

样品 YAML 保存 `schema: swb.sample/2`、entityType、id、code、contentVersion、bodyHash、extractionStatus、projectionVersion、updatedAt、blocks、references 与提取结果。每个 bullet 前以 `<!-- swb:block id="UUID" -->` 保存身份。编辑器隐藏头和标记，只显示正文；移动保留 ID，复制生成新 ID。

Data 的完整 About、组件及原始来源写入 `head.data`；分析条目、布局及产物写入 `head.analysis`；论点 host 与固定证据条目写入 `head.claim`。正文历史和证据实际内容独立存于 history 和 evidence。对象、属性、编号登记位于 registry；附件清单位于 attachments/manifest.json，字节按内容哈希定位，业务路径相对工作区。

应用写入前检查整个磁盘文件哈希，外部修改返回 EXTERNAL_CHANGE/409；显式重新加载后接纳正文及允许编辑的元数据。Data 身份标记丢失时要求明确关联，不能静默重复创建。正文提取失败保留已写盘内容及待处理状态。

写入通过单写进程锁、持久操作日志、临时文件与原子替换完成；启动先恢复未完成写入再重建索引。不要手工修改提取结果来提供属性事实，重新提取会覆盖它们。正文中的有效属性按文本保存，无效片段保留原文。完整备份排除索引、凭据与缓存，仍须能够在新目录恢复全部关系及附件字节。

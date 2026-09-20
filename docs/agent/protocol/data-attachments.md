# 协议：Data 与附件（protocol-data-attachments）

依赖：`protocol-common`、`guide`。字段权威见 `docs/DATA_PROTOCOL.md`。

## 1. Data、Attachment、DataComponent 的区别

- **Attachment**：不可变的字节对象，按 SHA-256 去重。身份是 attachment id，不含科研语义。
- **Data**：独立科学数据单元，有名称、描述、版本、About、组件。一个 Data 可引用多个 Attachment。
- **DataComponent**：Data 的组成部分，`kind` 为 `file` 或 `text`，有 `creator`（human/external）、`provenance`、`derivedFrom`。文件组件保存 `attachmentId`，文本组件保存 `content`。

`componentIds` 是兼容旧接口的附件 ID 投影，不是组件身份列表；真正的组件身份是 `components[].id`。不要用 componentIds 当组件主键。

## 2. About 与正式绑定

- `aboutSampleIds` 是 Data 声明的“关于哪些样品”，是科研归属。
- 一个 Sample 的 `[数据]` 区块是对该 Data 的**正式绑定**，与 About 相互独立。
- 将 Sample 数据区块正式绑定到现有 Data 的操作不修改 Data 的 About；需要归属时由调用方另行显式 `data_update` 更新 About。

## 3. 正文、组件与镜像

- Data 正文是 Markdown；Sample 中的 Data 区块保存一份镜像。
- 镜像保存 Data id、基线版本、基线内容哈希、名称和 block id 映射。未修改的镜像可刷新；双边都改则冲突，必须保留草稿并选择加载最新，不能自动合并。
- 删除 Sample 中的 Data 区块只移除引用，不删除独立 Data、附件字节或证据。

## 4. 原始与派生

- 原始图片/文件组件 `creator:human`、`derivedFrom:[]`，字节不可覆盖。
- OCR/转录等是 `creator:external` 的 derived 文本组件，`derivedFrom` 指向同一 Data 中原始组件 id。
- 修改 Data 必须带 `expectedVersion`；替换文件用新组件身份，不改原字节。

## 5. 页/行/表格 provenance 与正文

- 细粒度页/行/表格映射、model/knowledge 来源放在 derived 组件 provenance（版本化、可读、可解析的紧凑描述）。
- 不把结构化追溯信息重复灌入 Sample 正文；只有来源位置本身是科研事实时才保留为正文。

## 6. 附件安全

- 下载/读取附件通过 `attachment_get`、`attachment_text_read` 或内容路由，遵守认证；响应不暴露 `localPath` 或任意文件系统位置。
- 不要把附件二进制或 base64 塞进普通 JSON payload；上传走附件专用入口。
- 文本附件分段读取，避免一次性大文件。

## 7. 常用操作

`data_list`、`data_get`、`data_create`、`data_update`、`data_finalize`、`attachment_get`、`attachment_text_read`。参数以 MCP/OpenAPI 为准。

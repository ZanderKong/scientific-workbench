# 数据协议执行约束

完整规范见 IMPLEMENTATION_PLAN.md 第3–5节，本文件记录实现协议版本。当前旧 swb/1 实现不满足协议；新实现采用 swb/2，迁移不得原地覆盖。

- UUID 实体/区块主键；文件路径相对 workspace。Sample 文件头存版本、编号、区块身份与绑定、提取源版本/投影；Data存About/组件/来源/版本；Analysis存顺序/问题/布局/版本；Claim存host/证据清单/版本。
- registry 保存对象、属性、别名、生命周期、编号登记；attachments清单保存SHA256/显示名/MIME/尺寸/本地年龄/远端稳定位置。history和evidence独立完整文件。
- 保存操作日志记录目标版本、输入哈希、暂存文件与提交阶段；唯一写锁。启动完成日志恢复与索引校准后开放请求。
- 提取不能创造猜测对象类别；显式创建意图才创建对象。属性可按严格格式自动入字典。记录身份不能依赖行号，行号只作显示。
- Data镜像保存基线内容哈希与版本；已有Data更新必须CAS，不得finalize覆盖更新内容。冲突保留草稿，加载最新需用户明确动作。
- 全文和JSON协议须输入验证。REST修改必需版本条件，创建持久幂等键，409给当前版本及恢复信息；MCP使用同一服务，不直接操作文件。
- 上下文清单包含每个实体真实版本/正文哈希、附件哈希与关联来源。证据不可刷新覆盖；补充追加。
- 备份必须无需SQLite可重建；缺字节不报告完整，restore验证路径/哈希/空目录后切换，S3默认关闭。

任何具体字段增加必须更新本协议和对应测试，不把聊天作为唯一字段定义来源。

## 实验记录导入（2026-09-21，swb.import/2）

一次导入由调用方生成稳定 `importId`（UUID），服务器签发 `attemptId` 作为执行资格。暂态记录存 `registry/imports/<importId>.json`，不作为 SQLite 业务表；备份按 `registry` 目录递归纳入，恢复后仍可读最小 receipt。

状态只有 `prepared / draft / committed / cancelled`；`recordVersion` 控制 registry CAS，`draftVersion + draftHash` 控制草稿内容 CAS。draft 只含有序来源引用、转录与页/行/表格位置、样品候选（sampleKey/code/title/body）、显式 existing 对象选择与 new-object intent、局部 reference mapping、ambiguity/澄清；没有 properties/processes/observations 投影。所有字段限长、数组有界，未知字段拒绝。

`sample_import_prepare` 复用 `abort` 之后的上传附件：服务端按附件身份校验数量 1–10、单张 ≤10 MiB、合计 ≤30 MiB、实际文件头（JPEG/PNG/WebP）与声明 MIME 相符、哈希与登记一致；不接受本地路径或 URL。prepare 在同一个 Store.commit 中创建 shared source Data（原始 file 组件 `creator:human`、`derivedFrom:[]`、`aboutSampleIds:[]`）与 prepared 记录；相同 importId + source fingerprint 幂等，顺序不同即不同输入。

commit 前服务端重算并比对 import/source identity、draftHash、sourceDataVersion、选定对象版本与契约版本组成的 fingerprint；attempt eligibility 单独校验。提交在同一事务中创建显式允许的新对象、用现有 createSample 分配编号、保存规范正文与对象 bindings、给每个 Sample 绑定指向 shared source Data 的正常 `[数据]` 区块（首次 finalize 前绑定）并 finalize；转录作为 `creator:external` derived component 写入来源 Data，`derivedFrom` 指向原始组件，页/行/表格位置写 provenance，一次 `updateData`（带 expectedVersion）合并 About 与组件。

成功后把原文件替换为 committed 小型记录：仅保留身份/状态、来源 Data 与按需来源审计、实际 model/knowledge/契约版本、最小 receipt（createdSampleIds/sourceDataId/createdObjectIds/derivedComponentIds/fingerprint/版本/时间）与安全错误码。**同一事务内移除完整 draft、临时 object/reference mapping 和澄清全文**，不另建 archive/history 文件。长期内容只服务：证明 commit、相同重试返回原 receipt、防重复、响应丢失/重启对账、基本 audit。

`sample_import_cancel` 原子撤销 active attempt；`sample_import_retry` 撤销旧资格并签发新 attempt，复用来源 Data，旧 save/commit 均拒绝。journal 持久前失败不留部分 Sample/Object（来源 Data/附件保留）；journal 持久后失败由 FileRepository 重放整批，Store 暴露 recovery-required，业务读取/导出/备份在恢复完成前返回 503 RECOVERY_REQUIRED，health 报 degraded。正常 Data 绑定使用 `document_bind_data`：要求现存 `[数据]` 区块、文档与 Data 双版本匹配，写入镜像基线 metadata，不修改 Data 的 About，已绑定同一 Data 幂等、不同 Data 冲突，身份丢失仍走原 repair 操作。


## Analysis 文件扩展（2026-09-13，swb.analysis/2）

`head.analysis.layout` 保存 `visibleSections`、`hiddenColumns`、`columnOrder`；列键为 `objectId:propertyId`。可见区块为 context/compare/data/artifacts/body/claims，默认全显示，旧 /2 文件缺字段时使用默认值。布局更新与正文更新共用实体版本和文件事务，不存成只能从 SQLite 恢复的偏好。

`head.analysis.attachmentIds` 保存独立分析产物的不可变附件 ID，默认空数组。上传先落本地，随后带 expectedVersion 更新关联；解除引用不删附件。导出和 Analysis host 证据纳入这些附件的 ID/字节哈希，并记录 artifact 关系；既有证据不跟随解除引用修改。

REST `analysis_create` / `analysis_update` 与 MCP 共用这两个字段的协议。API 校验布局字段，写入前验证附件存在；SQLite 的 layout_json/attachment_ids 仅为文件索引。

## DataComponent（2026-09-14，swb.data/2 扩展）

`head.data.components` 保存完整组件数组：稳定 `id`、`kind`（file/text）、`name`、自由文本 `role`、`creator`（human/external）、`provenance`、`createdAt`、`derivedFrom`；文件组件保存 `attachmentId`，文本组件保存 `content`。`componentIds` 暂作为兼容旧接口的附件 ID 投影，不是组件身份列表。只有旧附件列表的 /2 文件在重建时补出 raw 文件组件，其 ID 使用已有附件 ID、来源写“文件上传”；不会伪造外部处理历史。新组件使用 UUID。

修改组件与 Data 共用 expectedVersion。文件组件原字节引用不可替换；替换时新增组件身份。原始文本内容、创建者与创建时间不可改写。组件可以解除引用，但仍被派生关系引用时须先处理来源关系；循环、悬空、缺文件与重复身份会拒绝。角色仅记录，不进行科学校验。

导出与证据包含组件实际文本、角色、创建来源和派生关系，附件仍按字节哈希复用。修改当前组件不改旧 Claim 证据。正式 API/MCP `data_update` 支持 components；旧 componentIds 更新通过同一验证路径。

## 独立文件外部编辑与重载

Data、Analysis、Claim 写前检查完整文件哈希。SQLite entity_file_state 只是可重建的磁盘基线，不能替代业务文件。外部变化返回 EXTERNAL_CHANGE/409，失败提交不更新基线；完成编辑与上下文导出同样不得以旧索引冒充最新。

`data_reload_file` / `analysis_reload_file` / `claim_reload_file` 对应 POST 实体 `/:id/reload`，要求 expectedVersion。显式接纳正文与可编辑元数据，并推进版本；Data 原始来源、Claim host/证据与实体 ID 不允许在重载中变更。浏览器提供复制正文、加载应用最新内容、重新加载文件三个动作。加载失败保留草稿。

Markdown 序列化原样保留开头空行和字面转义；元数据头兼容 CRLF。上下文收集先完成参与文档和共享 Data 镜像，使版本稳定后再捕获各实体，不在捕获一半后继续修改较早收集的样品。

## 引用创建意图与 Data 身份待关联（2026-09-14）

样品 `references` 中的 `status: create-intent`、`intentId`（UUID）、明确 role 和原文范围表示待创建引用。编辑器只写正文与该意图，完成编辑时校验区块、范围、原文仍匹配，随后在同一持久事务中创建对象并将引用改为 bound。对象使用 intentId 作为稳定身份；重试不重复创建。修改或删除文字即解除意图，普通未匹配文字不触发创建。创建类别限定原料、设备、过程；独立 Data/Analysis 文本编辑器不提供无法持久化的对象创建动作。

外部编辑删除 Data 的区块标记时，不能确认的新区块保存 `kind: data-unresolved` 和 `candidateDataIds`。有效属性继续提取，待关联 Data 不重复创建；导出列出待处理提示。`document_resolve_data_identity` 携带 expectedVersion，明确 dataId 或 createNew（二选一）；关联已有 Data 会加载其当前正文，新建意图保留当前区块文字。删除整个元数据绑定清单的情形仍需进一步保护。

正式论点未提交正文另以 host 隔离保存在浏览器草稿，包含各父 bullet 的幂等键；页面重开可继续。数据/分析附件上传进行中，离开、完成及导出屏障等待本地上传和组件关联完成，避免留下未关联附件而报告保存完成。

## 论点证据分实体正文（2026-09-14）

新增 ClaimEvidence.documents 保存同一次上下文收集器返回的分实体阅读版 Markdown，键与 manifest.entities.file 对应；完整合并正文仍为 content。字段与 manifest 一同保存到独立证据 JSON，SQLite documents_json 只作索引。重建检查分实体正文拼接与完整快照一致，备份包含它们。

论点证据卡使用快照 documents 的 Data 标题/正文及 manifest 版本和 About 身份，不读取当前 Data 内容来伪装旧证据。旧快照没有该字段时显示原完整快照，不补造过去的分实体信息。状态/置信度/作者来源暂按论点子行同名文本标注显示，未填写显示“未标注”；不增加自动推断。

## 对象展示信息与推荐属性（2026-09-14）

ResearchObject 增加可选 identityText 和 recommendedPropertyIds。前者是人工标识信息自由文本，后者引用共用属性字典，去重并校验所选属性存在，不按名称创建另一套定义。字段保存 registry/objects.json，SQLite 两列只作索引；旧文件缺字段按空处理。对象编辑同时校验 expectedVersion，失败不更改文件。重命名保留对象 ID；已合并对象不能被重新启用或改写，编辑其目标对象。

该推荐只在资源详情提供提示，不限制样品能写的属性，不把样品实际属性写回对象。引用列表同时检查实际对象引用和属性来源，单纯引用也可定位样品。

## 旧格式转换与证据缺口

专用转换器 `pnpm migrate:legacy` 只接受显式源目录和不存在的新目录。转换在隔离暂存目录执行，旧SQLite仅复制后打开；正文/附件逐项校验、索引重建、源文件未变化确认后再发布。原目录不修改，凭据不复制，S3默认关闭；具体输入、警告与启动方式见 MIGRATION.md。

旧 Claim 的 `legacyEvidenceWarning` 持久保留在文件头；普通编辑和补充证据不清除这个历史缺口标记。已留存证据内容原样保存；没有留存的证据不生成。旧 Sample/Document ID 不同时记录映射；Data来源、历史归属同步转换，正文区块身份保持。

### 样品 Data 附件正文协议
Data 子级使用 `[显示名称](swb-file:附件ID)`；文件名中的反斜线和方括号按字面转义，其他正文中的协议文本不擅自变成附件节点。上传字节先可靠保存，再把标记插入原Data的稳定区块；上传期间删除原区块则提示重新关联，已落盘字节保留。每个Data按附件ID去重，正文生成组件标记bodyLinked；移除对应正文标记仅移除该自动组件，不删除手动组件、附件字节或证据快照。无法找到附件的标记保留原文并给出提示。

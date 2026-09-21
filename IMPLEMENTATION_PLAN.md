# 完整首版实施契约

状态：进行中；无阶段因早期演示或 build 成功自动通过。2026-09-12 建立。

## 1. 已批准范围
个人本机浏览器应用；Node 22.12+、React 19、Tiptap 3、Fastify 5、SQLite WAL、Markdown/YAML、JSON 字典/清单、MCP stdio、S3 SDK。端口默认 4317，数据目录默认 ScientificWorkbench；开发测试必须另外指定。原型视觉严格迁移，无新主题、内置 AI、科学核查、聚合函数或历史回滚。

正文是事实源：Sample 一对一 Document，操作父 bullet 与属性子 bullet。属性属于 Sample，记录对象 ID、属性 ID、文本值及来源区块。重复引用过程可分别定位；同操作父子声明合计一次。值用 · 展示，无数值推断。全局属性字典、手工别名、标准名输出。

对象支持 [名称]、【名称】、［名称］；允许空格，禁止错配/嵌套。编辑名称解除绑定；无匹配不自动创建，选择已有对象或明确创建类别。行首数据/论点为类型标记，不允许同名普通对象。样品所有论点仅文本；正式 Claim 仅从 Data/Analysis host 创建。

属性子行以一个对象开始，竖线和冒号接受全半角，首个冒号拆分，名称和值 trim 非空；值可含冒号不可含竖线。无效段保留文字，多对象歧义不提取；标准名匹配否则创建属性。补全按光标：空查询最近 10 再高频、去重最多 20；精确/前缀/别名/包含/模糊排序。composition 不刷新候选或抢键，单位灰色装饰不持久化。

## 2. 原型与页面
冻结根 index.html 的字节副本与 SHA-256；干净 Chromium 默认实际渲染作为参考，不启用未生效主题变量。1440×1000 主视口及 980/640 断点。相同数据下关键几何差≤2 CSS px，截图差异目标≤0.5%，仅光标/时间可屏蔽。合法语法变化单列，禁止提高阈值规避结构差异。

直接迁移原型 DOM、有效 CSS、图标、尺寸及弹窗/抽屉；React 只替换数据与事件。样品居中正文不加右侧 inspector。Data/Analysis/Claim 按专用页面布局。表格保留搜索、筛选、排序、动态列、拖序、多选、卡片、来源跳转。分析由实际选择创建，空选择为空分析。

五类导航样品/分析/数据/论点/资源，底部搜索设置；可返回来源。资源含原料设备过程、属性字典、别名/单位和生命周期。Data 有 About、组件/文件预览、来源和 Claim。分析有条目排序、比较、产物、Claim、导出。设置显示路径、存储、任务、备份恢复、连接、历史、帮助。开发设计说明不暴露到正常运行。

## 3. 内容可靠性
UUID 为主键，样品编号 YYMMDD-最大流水+1，不复用删除编号。复制生成区块新 ID，去除 Data/组件/Claim；批量一行一个样品。移动保留节点 ID，撤销重做一致。编辑器只显示正文，隐藏头和注释；不另存可独立编辑的编辑器 JSON。未知 Markdown 原文保留，不能全局删除转义。

正文 500ms debounce、持续输入最长 2s 保存；按文档串行，使用成功返回版本，失败保留 IndexedDB 草稿并允许重试。完成/切页/开关联数据/导出/最新读取先保存后整篇提取。成功且有提示与失败区分，失败不能报告最新。内容版本与投影版本返回调用方。

区块 ID/对象绑定/创建意图/Data ID/基线存文件头；HTML 注释编码节点身份。外改检查完整磁盘哈希，reload 显式接纳基线；有草稿提供复制和加载磁盘。失去 Data 身份提示重新关联，不猜测再建。解析更新稳定记录、删除移除引用和属性但留字典/独立数据。过期解析不提交。正文完成时按去标记哈希生成快照，四种实体支持查看复制，无恢复按钮；证据独立保留。

目录 samples/data/analyses/claims/registry/attachments/history/evidence/index/jobs/private/cache。所有业务路径相对目录。文件头及 JSON 包含完整实体关系；数据库可从文件独立重建。唯一写进程锁、fsync 临时文件、原子替换与持久多文件操作日志；启动先恢复未结束操作再接收业务。旧数据只在新目录转换，保留原文件，缺失内容/证据明确报告，不伪造历史。

## 4. Data、分析、证据
Data 独立 Markdown、版本、About 列表、组件和原始来源。多样品引用不自动改变 About。样品镜像保存 Data ID/基线版本/内容哈希；未修改镜像刷新，双边修改冲突，复制草稿或加载最新，无自动合并。删除镜像只移除引用。上传先本地流式落盘 SHA-256，再关联不可变附件；替换新 file ID，旧证据继续读取原字节。

组件含类型、角色、creator/provenance、派生来源；AI 不覆盖 raw。图片/PDF/文本/CSV 可预览，其他下载，不执行上传文件。外部图表作为产物，无内置计算。

导出与证据共用收集器：Analysis 直接条目、直接样品 Data、涉及字典和必要 About 说明；其他 Sample 只身份不递归，全 ID 去重。先提取，执行失败导出失败；未绑定项列出。导出 context.md、manifest.json、分实体阅读版，可选附件。manifest 有实际版本/来源/附件 ID 类型大小哈希。

Data Claim 固定当前 Data；Analysis Claim 固定上述集合；每实体实际版本，不能用一个最大版本替代。正文/清单快照独立落盘，附件字节复用不可变存储。修改 Claim 不刷新证据，补充追加；host/context 不代表已证明。

## 5. 接口、权限与存储
/api/v1 全组覆盖：Workspace、对象/属性、文档/样品、Data/组件、附件、分析、Claim、Storage/Backup、Search/Jobs。修改必须 expectedVersion，409 冲突；创建支持持久幂等键，输入验证和错误码一致。列表分页；长任务异步 job ID、查询/重试/取消。

OpenAPI/MCP 从统一操作定义生成；stdio 仅桥接同一本机 API，无直接文件/数据库业务写入。提供正文/语法资源、文本分段、图像/下载，不把大二进制塞 JSON。无 sampling/内置模型。真实 MCP 客户端覆盖完整流程。

UI 会话、可撤销外部 token；服务端 scope 绑定。日常读写导出备份默认允许，永久删除/合并/清理/恢复额外授权；请求头不能自授予权限。Host/Origin 本机限定。凭据仅 private 0600，日志/导出/备份排除。

S3 默认关闭，阈值严格 >100000000 字节，保存年龄≥15×24h；启动/每小时扫描，无常驻后台。并发2，失败1m/5m/30m/6h退避，可手动重试。endpoint/region/bucket/path-style；workspace 前缀+稳定哈希键，multipart 上传、流式回读 SHA-256，非 ETag。默认保留本地，验证后可 remote-only。位置持久保存，不随改配置错位；缓存2GB LRU、读中不删。策略变更不隐式全量迁移。

ZIP64 全量备份固定业务文件/清单集合，保护不可变附件；远端唯一附件取回验哈希，缺件失败。含全部字典/历史/证据/附件，不含索引/凭据/缓存/锁。新目录验证路径和全部哈希、重建索引后切换；原目录保留，恢复本地附件齐全，S3 默认关闭。

## 6. 稳定任务与验收
|任务|依赖|交付与完成条件|验证|
|---|---|---|---|
|BASE-001|无|执行资料、冻结原型、页面矩阵、交接|资料链接/原型哈希检查|
|BASE-002|BASE-001|独立临时目录、独立端口测试入口|启动器安全边界测试|
|UI-001|BASE-001|原型外壳和样品列表所有状态|原型同数据截图/几何|
|UI-002|UI-001|原型居中编辑器/折叠/附件呈现|空白与完整记录截图|
|UI-003|UI-002|Data/分析/Claim/资源/设置专用页与面板|逐页矩阵截图|
|DOC-001|BASE-002|完整业务文件、锁、操作日志、独立索引重建|无索引/写入故障测试|
|DOC-002|DOC-001|旧目录转新目录、缺件报告|原目录不可用重开|
|DOC-003|DOC-001,UI-002|节点身份、编解码、绑定与IME|插入移动复制撤销外改/中文|
|DOC-004|DOC-003|保存队列/草稿/提交屏障/提取/历史|断网切页2s保存与磁盘断言|
|DOC-005|DOC-004,UI-001|字典/动态列/定位/复制批量|完整样品闭环|
|DATA-001|DOC-004|多Data/基线冲突/About/组件/预览|两入口及MCP并发|
|CLAIM-001|DATA-001,UI-003|分析组织比较/收集器/导出/证据|范围去重/旧证据不变|
|API-001|DOC-001|统一操作协议、权限、幂等/版本/分页|越权/重试/冲突|
|API-002|API-001,CLAIM-001|完整MCP及资源|真实客户端科研全流程|
|STORE-001|DATA-001,API-001|S3持久队列/校验/远端缓存|真实S3兼容服务/测试时钟|
|STORE-002|STORE-001,DOC-002|完整备份与独立恢复|无原目录/无凭据附件全读|
|VERIFY-001|所有实现|完整PVA样例/性能/逐页复核/指南|全规则映射+人工IME记录|

任务状态只在 HANDOFF 与验收矩阵维护。无证据不标已验证。视觉夹具与科研样例分开，PVA 三次冻融须三个实际操作；CSV/PNG 明确模拟。性能20/100/500操作、5000/50000对象实测。依赖版本 lockfile 固定。迁移先保留旧目录。最终交付全部实现+证据；未验人工项明确保留，不以第一轮完成结束任务。

## 附：2026-09-21 通宵计划“Agent Knowledge Layer 与实验记录导入”状态

- Phase A（Agent Knowledge Layer）：PASS，提交 `c9842cd`。见 `docs/agent/`、`packages/core/src/document-contract.ts`、`packages/core/src/agent-knowledge.ts`、`scripts/build-agent-knowledge.ts`、`apps/server/src/knowledge.ts`、`docs/API_MCP.md`。
- Phase B1（Deterministic Sample Import Backend）：**上一轮 PASS 结论已被修订**。原始实现提交 `099b40f`，但 2026-09-21 审核复现出 8 个问题（F02 覆写科研正文、F03 prepare 长期缓存完整 draft、F04 待确认值成为正式属性、F05 位置映射丢失、F06 假图片通过魔数校验、F07 已提交记录接受不同请求、F08 receipt/镜像版本落后）。修复见 `docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_REVIEW_FIX_PLAN.md` 与 `docs/VERIFICATION.md` 2026-09-21 审核问题修复段：`sourceBlockId` 显式来源身份、prepare 最小确认 + 限定范围缓存清理、不确定属性值阻断、`import-provenance` 组件与提交顺序统一版本、`sharp` 真实像素解码、`submissionHash` 精确 replay。B1 修复后的 gate 证据为 core16 / web14 / mcp3 / server152 + playwright 46。
- Vision Spike（第二轮收紧）：图片校验增加解码期间与提交前的**内容级**复核；CLI 不再自行解析 server-only 的 `sharp`；图片答案要求请求关联 + 完成状态 + 严格单整数；allow/deny 需要真实调用与拒绝证据（含七个必需范围与副作用检查），隔离失败即停止；泄漏检查区分 report 与 Workbench 产物。七项合取现为「每项证据充分」而非「非噪音」。真实 V1/V2 仍为 NOT VERIFIED，缺项逐条列出。
- Vision Spike：harness 已重写为七项证据合取（`apps/server/src/vision-spike.ts`、`vision-spike.test.ts` 18 项负向矩阵），真实 V1/V2 状态仍为 NOT VERIFIED，缺项已逐条列出，不得因为“设置 URL 即可”而记为支持。
- Phase B2（AI / Runtime / UI）：BLOCKED。前置 Vision Spike V1/V2 均为 NOT VERIFIED，未启用任何 AI 导入入口/readiness，A/B1 不回滚。证据见 `docs/VERIFICATION.md`、`docs/OPENCODE_INTEGRATION.md` 与 `scripts/spike-opencode-vision.mts`。
- 本状态不改变第 6 节既定任务门槛，也不把完整首版标记完成。

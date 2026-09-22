# 当前接续入口

> 最新接续（2026-09-23）：`docs/plans/AI_IMPORT_DEEPSEEK_HANDOFF_PLAN.md` 已执行完毕，见文末「2026-09-23 计划执行」一节。基线 `a3f73e6` 加当时全部未提交/未跟踪工作已按阶段提交；AI 图片导入在「V1 1.18.31 + deepseek/deepseek-v4-flash-vision-exp + 受限 profile」验证组合下可用，并在真实页面完成三组场景与重启重开核对。完整首版仍未完成，其余未验收项见文末与 docs/STATUS.md。

更新：2026-09-13。总体：完整首版未完成。以下历史记录按日期保留，以末尾最新接续为准。

## 必须先知道

此前两轮成功声明不等于已验收。压缩代码已格式化，样品猜类别创建已移除，新稳定编辑器局部行为通过。文件独立重建、证据范围、权限与备份仍有重大缺口。以 IMPLEMENTATION_PLAN.md 的约束继续。

## 当前任务

- BASE-001：执行资料完成；冻结原型哈希 fe2c41e76c2de262c6520fc55d1eed46e8e3679e4486d4be0e0198da32a0f1bb。
- BASE-002：Playwright 使用14317及每轮独立 mkdtemp，旧4317服务未操作。
- UI-001a：直接迁移 CSS/DOM，原型同数据几何与像素通过。像素差126/1440000=0.00875%。证据 audit/2026-09-12/UI-001a。
- UI-001b：筛选/排序/列隐藏拖序/多选/表卡已写，状态交互仍待测试；依赖底层的定位/导出/分析还须最终闭环验证。
- 旧详情页暂存 legacy-pages.tsx，App已不再引用。新增独立Data/Analysis/Claim列表和详情、ResourcesPage、SettingsPanel；均按原型DOM/CSS迁移但尚未完成逐状态像素验收。
- ResearchEditor/SaveQueue已接样品；修复StarterKit trailingNode导致空bullet外输入。3项浏览器测试验证键盘/落盘/重开/ID/断网屏障。重新加载更新基线、历史仅finalize生成的服务端测试通过。
- DataDetail/useEntityDraft/ClaimComposer已接Data版本保存/About/上传/正式论点。`test/e2e/data.spec.ts` 2项通过，涵盖重复字节附件身份和API冲突草稿。
- DATA-001：Data镜像baseVersion/baseHash/baseName，多入口冲突保护、未修改引用刷新与重复解析版本稳定；`data-sync.test.ts`3项通过。完整文件事务仍待重做。
- parser现在保留Data子树Markdown和ID，不再生成猜类别intent；歧义行/Claim与Data子级不提取样品属性。
- 下一步：完成新页面的交互/视觉状态验收并补UI缺项（样品菜单、复制批量、绑定装饰、IME、附件子级、分析布局持久化等），再按DOC-001重建文件内核。当前Settings明确标出备份/恢复和权限未验收，不把旧备份成功作为可信能力。
- 最近启动 `pnpm build` session 10238 待确认，随后运行新页面E2E。旧Settings是页面，现恢复原型Modal，导航测试应断言dialog而非内部旧h1。
- 本轮没有宣称旧测试代表新计划通过。

## 运行与安全

工作目录 /Users/kong/ZanderProject/工作台。旧服务上轮使用4317和用户默认目录，不将它用于测试。检查端口后使用独立测试端口及 mkdtemp 目录。不要执行原 demo 生成器到用户目录；不要删除旧工作区。

## 验证/交接

本轮证据见 docs/VERIFICATION.md。每项任务通过后更新本文件与矩阵。记录下个任务具体操作和未通过原因，不能用总结回复替代未完成工作。

## 2026-09-12 后续进展（覆盖上面的旧接续细节）

- 所有页面已拆独立模块并停止引用 legacy-pages.tsx；当前仍只有样品列表默认视觉通过，其他页面不可宣称对齐完成。
- 新增 completion.ts 标准名/前缀/别名/包含/模糊排序、最近10/高频20；装饰性单位与引用样式；synthetic composition E2E通过。完整浏览器最近7项通过，真实macOS选字仍未验收。
- DOC-001开始接入：FileRepository持久日志、原子替换/fsync、SQLite独立EXCLUSIVE进程锁（jobs/.writer-lock.sqlite），失败意图重启重放后重建索引。5项日志故障/锁测试通过。
- 新文件schema swb.* /2；完整Data/About/组件/来源、Analysis顺序、Claim host/证据ID写YAML，历史/证据JSON单独落盘，registry对象/属性与attachments/manifest.json为相对路径。旧工作区无registry/workspace.json会拒绝原地打开，迁移工具尚待实现，不能启动默认目录。
- file-rebuild.test.ts移除临时index后重建全部四类实体、别名、属性、About/组件/顺序/证据/历史通过。不是完整备份恢复验收。
- context.ts统一导出/证据收集，版本来自各实体而非max Data；ContextManifest含entities/attachments/identities/relations/warnings；context.test.ts已通过一次，随后新增镜像刷新/属性字典/关系字段待复测。
- 最新 server19项通过（在最后ensureLatest/复制/历史改动前）；完整 pnpm test session62438待收结果。
- 新增finalizeEntity三类正文历史，前端useEntityDraft.flush会调用对应finalize。HistoryDrawer已接样品，另三类页面尚待接。
- 最新copySample保留共享Data镜像、区块ID全部重建；新增resolveDataMirror显式用最新Data替换冲突呈现；样品Data冲突modal已写，需新测试。默认样品编号改为持久registry/numbers.json与SYYMMDD-##。
- 剩余重点：稳定对象ID绑定尚未完整（当前装饰基于名称），样品附件子级/拖动/复制/菜单批量，分析布局持久化，全部视觉状态；文件外部Data/Analysis/Claim编辑接纳，旧数据转换，API/MCP全权限/幂等，S3持久任务/位置/缓存，完整备份恢复。Settings对未验收备份和权限明确说明，尚无正式恢复入口。
- 没有更改用户数据，没有把本轮进展标为完整首版完成。继续执行用户“直到前端满足原型、底层满足要求”的任务。

## 2026-09-12 23:04 当前接续（优先于上文）

- 用户要求持续完成完整首版，没有授权缩减。不得派生子代理；原型保持未改。
- UI：SampleDocument 顶栏加入真实关联 Data/Claim 计数、编号编辑、原型 popover；新增 BatchSamplesPage 直接迁移原型表格，逐行改属性、增删行、独立编号与版本检查。App 增加返回路径栈。四类实体均接 HistoryDrawer。
- 纠正复制规则：DESIGN_RULES SAMPLE-001 明确不复制 Data/组件/Claim；上文“保留共享 Data 的复制”是实现错误，已改为 sample-template.ts 剔除结果子树、保留操作属性并分配新 ID。bindings.test 对齐确认规则，新增真实 batch E2E。
- Batch E2E 初次失败是详情 API 漏 contentVersion，已使 getSample 与列表一致，复测通过。7 项原有浏览器通过＋新增 batch 单独通过（尚待最终全套一起执行）。
- Stable ReferenceMark/encodeBindings、Data mirror canonical↔mirror ID map 和 bindings.test 已接；SaveQueue 增加 revision 使同名对象换绑定即便文本不变也保存；新增测试通过。
- DOC/STORE：新 backup.ts 固定 inode 集合、递归包含历史/证据、ZIP64、流式哈希和解包、manifest/path/size/hash 检查、新目录重建后原子发布。backup3项通过：原目录不可访问恢复、缺件失败、路径攻击拒绝。旧 backupManifest 方法仍待替换/删除，不用于新 StorageService.createBackup。
- S3：StorageService 重写公共设置文件持久化、private/s3-UUID.json 0600、远端位置含 endpoint/region/bucket/key/credentialId（改配置不改旧位置）；任务队列并发2、重试1m/5m/30m/6h、startup/hour扫描及retry timer；remote内容API改返回实际流。2GB LRU cache lease 防读中清理；backup期间持有 lease。仍需真实S3实测和复核边界。
- store新增 saveSetting/setting、locateAttachment、updateJob；附件清单持久 remoteLocation；启动从settings文件恢复。restore关闭S3并清除credentialId；private无凭据。构造失败关闭索引与目录锁。
- 最近 pnpm build 全部通过；server backup+file-rebuild 5项通过。最新 storage.test 调度边界/并发与backup测试 session11385 待收；Docker pull quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z session94216 长时间无输出待确认。Docker daemon 可用（29.7.2），只有postgres镜像先前存在；MinIO测试须独立容器/本地随机端口/无用户volume。官方源 https://github.com/minio/minio/blob/master/docs/docker/README.md。
- 下一步：收storage tests和image拉取，修复失败；完成真实S3 multipart/回读/远端位置/备份恢复测试，再继续其他页面逐状态原型对照和全部API/MCP权限/幂等。整个首版仍未完成。
- 仍缺：除默认样品列表外所有像素对照；样品附件节点/拖动/完整IME、分析布局持久化/附件、资源完整生命周期、外部多实体重载、旧数据新目录转换、API/MCP全契约/真实权限/幂等/分页/长任务、真实S3兼容与恢复切换UI、PVA/性能/最终帮助。不要误报这些通过。

## 2026-09-13 当前接续（优先于上文）

- 已核对上一上下文成果：真实 MinIO 两项（multipart、回读失败保留本地、稳定位置、远端附件备份恢复）通过；真实 MCP 客户端一项完整流程通过。普通 pnpm test 不执行真实 S3，不能把跳过视为通过。
- 新 private/api-tokens.json 持久凭据哈希、UI 会话、撤销、服务端 scope 与一次性危险授权；OpenAPI/MCP 共用 operations.ts，正文版本、持久幂等、分页与异步备份已接。仍未覆盖全部契约和危险生命周期。
- UI-002a 空编辑器七处几何通过，尚非像素通过；UI-001a 仍是唯一完整像素基线。最新浏览器 test-results/.last-run.json 为 passed，旧 PTY 已过期，不能再从旧 session 收结果。
- 新 Settings 中 ConnectionSettings/BackupSettings 已接真实接口。恢复可验证并生成新目录，运行中切换工作区仍未完成。设置入口仍需提交屏障。
- 当前继续 UI-003b / CLAIM-001：分析布局、比较列持久化和产物附件；随后 UI-003a 与原型逐区域对照。此前正文编解码保留多行、空行与字面转义的测试已补。
- 当前未启动新的常驻服务，不访问 ~/ScientificWorkbench。测试继续用临时目录及14317；旧默认4317服务不操作。
- 未完成：其余页面视觉及窄屏、Data组件角色与来源、附件节点、完整区块操作/真实IME、外部多实体重载、旧格式转换、API完整覆盖、恢复切换、PVA/性能及最终文档。首版不可标记完成。

## 2026-09-14 当前接续（优先于上文）

- 2026-09-13新增 Analysis layout/attachmentIds 写入文件并重建，比较列隐藏/排序/显示区块、附件上传/预览/解除引用；分析 Data 列表包含直接样品中的 Data。相关服务端与浏览器重开测试通过。
- UI-003a 描述型 Data：修复多余空组件框122px偏移、标题与正文指标、论点字体与空白。1440×1000六区几何一致、无任何遮罩像素差0.266875%；980/640几何通过。证据 audit/2026-09-13/UI-003a-description。其他 Data 状态仍待对照。
- ClaimComposer 按每个明确提交父bullet创建独立论点，保留子级文字，重试带幂等键，提交期间的新输入不清空。尚未实现既有论点原位编辑与完整属性模型；不能把它标为全功能完成。
- Data components 字段落文件，含id/kind/name/role/creator/provenance/createdAt/derivedFrom/attachmentId/content；旧componentIds兼容规范化。文件替换必须新组件，派生悬空/循环拒绝；原型组件行与编辑弹窗已接。导出/证据纳入组件文本与关系。重建/旧证据稳定/浏览器组件来源测试通过。
- EntityFileGuard：Data/Analysis/Claim写前完整文件哈希校验，EXTERNAL_CHANGE；显式reload API/MCP及三页入口，校验身份、固定Claim host/evidence。失败不改变基线。独立实体、Data同步、重建、备份11项通过；后续components合并后相关8项再次通过。
- collectContext先完成参与样品/镜像并稳定版本，再读取集合；Markdown序列化不再删开头空行，支持CRLF元数据头；新增2项正文往返测试通过。S3集成测试普通skip不再创建空临时目录。
- 最近完整 `pnpm test`：core6/server30/web12/MCP1，共49通过；真实S3两项在普通test中跳过。最近浏览器5项（analysis/data/data-visual）通过。最后context/Markdown调整后需重新build及浏览器相关复测。MCP真实客户端已随完整test通过。
- 当前下一步 UI-003a：附件型FTIR同内容对照，接续 UI-003b 分析页视觉；补充最新协议、验收映射及前述进展文档。未启动新的常驻服务；旧默认工作区与原型均未修改。
- 仍缺：其余页面/状态逐像素、空Data/上传节点/完整区块与真实IME、字典生命周期、旧格式转换、全部API权限/任务取消/幂等覆盖、恢复工作区切换、PVA/性能/最终指南。完整首版未完成。

## 2026-09-14 10:50 接续（优先于上文）

- 上下文恢复后核对Data身份待关联保护：server identity/context 3项、markerless E2E1项通过。修改/删除标记时有效属性正常提取，显式关联或新建，重复不创建。删除整个YAML绑定清单仍待保护。
- 此前完整浏览器16项通过；FTIR和分析像素分别0.43757%/0.43840%。分析证据 audit/2026-09-14/UI-003b-analysis。FTIR最近图被下一次E2E清掉，需复跑并归档。没有扩大到全部视觉通过。
- DOC-003：创建对象改成样品正文References的create-intent，Tiptap mark保存intentId；完成提取原文校验后同持久事务创建，重试复用UUID，修改/删除取消。取消独立文本编辑器不能保存的即时创建菜单；样品只明确创建原料/设备/过程。6项server、6项codec、1项真实浏览器通过。build通过。
- 修正 docs/API_MCP.md 错误的 X-Workbench-Scope自授权说明；更新swb/2文件文档和MCP占位凭据，新增pnpm api:spec生成openapi.json。
- Claim草稿按host缓存、保存幂等键；Data/Analysis离开屏障等待上传及关联；前述完整16项含此验证。
- 下一任务 UI-003c：Claim原型对照。当前论点页有写死“待验证”、缺相关样品、用整包快照替代原型Data证据卡；必须显示实际已保存内容，不能伪造支持关系。准备以固定快照内实体正文显示卡片，并保留完整快照查看。
- 无新增常驻服务；测试临时目录/14317，旧用户目录未访问。完整首版仍未完成，DOC-002迁移等原有缺口继续有效。

## 2026-09-14 10:54 接续

- UI-003c固定论点页几何8区≤2px，像素0.32542%，已看图；实际Claim流程E2E1通过。证据 audit/2026-09-14/UI-003c-claim；FTIR图也已归档UI-003a-FTIR。
- ClaimEvidence.documents保存收集器实际分实体正文，证据JSON/索引重建/备份完整保留。卡片用冻结Data的名称/正文/版本，旧快照缺字段显示完整原快照，不虚构旧信息。Claim状态/置信度/作者来源从手工子行文本显示，去除写死状态；相关样品由固定manifest跳转。
- 新构建通过，context/rebuild/backup6项通过；完整unit/E2E需在本轮后续变更完成后再跑一次。未启动常驻服务。
- 下一项 UI-003d资源：当前资源详情把原型推荐属性区替换成别名、对象标识信息缺失、属性与量纲页结构混用；列表排序/列可见性仍未接。需按原型与规则补齐实际模型/交互再视觉验收。DOC-002等原有完整首版缺口未关闭。

## 2026-09-14 11:03 当前接续

- UI-003d原料列表与详情视觉/几何通过，证据audit/2026-09-14/UI-003d-material；资源真实推荐/别名/废弃/纯引用/列设置E2E通过。
- ResearchObject identityText/recommendedPropertyIds写registry，引用全局属性字典，版本冲突和重建测试通过；不给样品属性加限制。列表排序与列可见性接通；对象合并/永久删除UI和量纲页仍待做。
- 修复样品列表API遗漏document.head，真实资源纯引用、分析间接Data都已补浏览器断言。
- 最新 pnpm test 57通过（含真实MCP），S3集成2跳过；全套Playwright22通过；pnpm build通过。原型哈希/日常目录未修改，无新常驻服务。
- 下一任务 DOC-002：开始实现旧swb/1目录到全新目录转换器；禁止原地迁移。须从旧Markdown与SQLite恢复所有关系，输出缺件/不完整证据报告，并在移除旧目录与索引后验证。其余缺口见IMPLEMENTATION_STATUS，不宣称完整首版完成。

## 2026-09-14 11:14 当前接续

- DOC-002转换器已写：apps/server/src/migration/source.ts/convert.ts，命令pnpm migrate:legacy需显式source/destination，目标必须全新。只对旧DB隔离副本用SQLite，原目录逐文件哈希不变；保留文件优先正文、所有关系/字典/历史/原证据/附件，无法确认Data待关联，旧Claim持久legacyEvidenceWarning。
- migration3项通过：旧目录不可用＋无新索引重建；缺件不发布/目标不覆盖；独立历史/证据文件及未登记附件保留；旧凭据不复制。未在日常目录执行。MIGRATION.md写使用与限制。
- 当前build session72854待收（在重复ID检查和legacy warning样式后）。此前unit57、浏览器22全通过；新增migration3使预期完整unit60，但未合并复跑。
- 下一步：补转换路径/源变化/发布可靠性检查，收构建并跑相关CLI与回归；随后继续UI-002附件节点/完整区块及UI-003e设置/历史等未通过状态。所有原计划剩余任务继续有效，首版未完成。

## 2026-09-14 16:40 当前接续（优先于上文）

- DOC-002迁移源目录变化与路径保护补齐，source1＋convert3共4项通过；全构建通过（上文pending旧session已收）。专用转换器未接触日常目录。
- UI-002 / DATA-001：样品Data子级增加真实附件选择、拖放与文件标签；上传先本地落盘，逐文件插入稳定file ID，完成屏障等待上传。Markdown使用swb-file协议，附件节点往返保留字面转义，组件随正文引用同步；删引用不删字节或旧证据。
- 最新局部验证：body-attachments＋data-sync4项、codec7项、sample-attachments浏览器1项通过；build四包通过。最新完整套件仍是unit57/browser22，新增项尚未合并全跑，不报新的总数。
- 当前UI-002b正在新增完整样品页同内容原型对照，先保存原图与真实几何失败，再按原型修正。空编辑器几何通过不代表完整正文已对齐。空附件提示对原子节点误判已修，待包含本次调整的构建与复测。
- 没有常驻新服务；测试14317＋临时目录，原型/用户目录未修改。下一步收sample-visual测试、修复差异并更新逐状态验收。完整首版其他缺口仍见IMPLEMENTATION_STATUS。

## 2026-09-15 最终自动验收接续（优先于上文）

- 已完成批准计划的功能编码。最终 `pnpm build` 通过；`pnpm test` 为core6/server51/web14/MCP1，共72项通过；完整Playwright 28项通过；隔离MinIO真实S3两项再次通过。普通测试按设计跳过需要容器的S3两项。Vite仍报告React插件弃用和约731KB单包警告。
- UI严格迁移：样品列表、完整样品、描述/FTIR Data、分析、固定论点、原料资源已有冻结原型几何/像素证据；设置/搜索/帮助弹窗外框数值一致，设置正文因新增首版真实能力列为必要差异。最终样品页面已人工查看。原型与index哈希均仍为`fe2c41e76c2de262c6520fc55d1eed46e8e3679e4486d4be0e0198da32a0f1bb`。
- 新增完整PVA演示与安全生成器：三次冻融是六个独立操作；Import-01多样品Data、组件角色、Analysis导出和正式Claim固定证据落文件，无索引可重建。生成器拒绝覆盖已有目录。
- 文件/存储最后闭环：创建Data保留组件元数据；对象/属性别名查询批量化；备份可取消且不发布partial；恢复验证后写0600启动选择，下次普通启动切换；附件清理先预览并整批复查正文/Data/分析/固定证据，再用单次cleanup权限删除本地、缓存与稳定S3位置。
- 性能证据：20/100/500操作整篇提取61.97/122.12/395.21ms；50,005对象读取74.27ms，5k/50k补全3.63/16.15ms，见`audit/2026-09-15/VERIFY-001-performance.json`。
- 没有运行日常`~/ScientificWorkbench`，没有修改旧4317服务；最终验证只使用临时目录和14317，当前无测试服务监听。没有更改冻结原型。
- 仅剩人工验收：在真实macOS中文输入法中测试数字/英文/符号后继续中文选字；若用户有实际旧工作区，再运行转换到全新目录并人工核对报告；可继续巡检极端长内容和非默认空态。下一步不是重做设计或缩减功能。

## 2026-09-16 UI-DENSITY-001 Design v2 可读性（优先于上文）

- 执行 `/Users/kong/Downloads/Scientific_Workbench_Design_v2_UI_Readability_EPLAN.md` 首次可读性/控件密度迁移：新增 `apps/web/src/density.css` Design v2 覆盖层并在 `main.tsx` 最后加载；冻结 `prototype.css`/`reference.html` 未改。
- 放大持久 UI（导航13、按钮/工具条12、次级11、表格正文12、微文字≥10），保持侧栏168px、topbar48px、840/980内容宽、980/640断点与样品正文15/13px不变；未用根级缩放/zoom/scale，未改业务逻辑。
- 视觉测试从“与冻结原型逐像素一致”迁移为“布局不变量+Design v2排版值+无溢出”，移除整页 pixelmatch 但保留截图；新增 `test/e2e/design-v2.ts` 与 `test/e2e/density.spec.ts`。
- 本机结果：typecheck通过；`pnpm test` 72通过（真实S3 2项按设计跳过）；`pnpm build` 通过；`pnpm exec playwright test` 30项全部通过；1600/1440/1280/980/640 无页面级横向溢出（640仅表内滚动）。见 docs/VERIFICATION.md 2026-09-16 段。
- 停止了一个上一上下文遗留、占用14317且工作目录在 `/private/tmp` 的临时测试服务；未访问 ~/ScientificWorkbench、旧4317服务或用户数据。
- 下一步仍为既有待验收项：真实macOS中文输入法选字、实际旧工作区DOC-002转换核对、极端长内容/非默认空态巡检，以及其余页面的进一步人工视觉确认；完整首版未完成。

## 2026-09-18 OpenCode 外部 Agent Runtime 集成（优先于上文）

- 执行 `/Users/kong/Downloads/SCIENTIFIC_WORKBENCH_OPENCODE_CODING_PLAN_FINAL.md`。实际实现：`agent-run` Job、OpenCode V2 HTTP 适配器、AgentRunService（Session/提示/权限/Question/事件/轮询/Recovery/Cancel/TaskStack snapshot）、Settings → OpenCode、全局 Task Stack、Jobs 历史 Session 跳转、Fake OpenCode 测试与文档。
- 版本判定：本机 opencode CLI 1.18.31 二进制包含 V2 `/api/session`、`/api/model`、`/api/permission/request`、`/api/event` 等路由，确认为 V2；依赖锁定 `@opencode/client@2.0.7`，仅 `apps/server/src/opencode.ts` 导入。未安装 legacy 客户端。
- 依赖：`apps/server/package.json` 新增 `@opencode/client@2.0.7`，`pnpm-lock.yaml` 已更新。
- 新增文件：`apps/server/src/opencode.ts`、`opencode.test.ts`、`agent-runs.ts`、`agent-runs.test.ts`、`apps/web/src/components/OpenCodeSettings.tsx`、`TaskStack.tsx`、`test/e2e/fake-opencode.ts`、`test/e2e/opencode.spec.ts`、`docs/OPENCODE_INTEGRATION.md`。
- 修改：`packages/core` 未改领域模型；`apps/server/src/main.ts`（集成 routes、Job cancel 分派、startup recovery、shutdown、Settings、asset 凭据）、`store.listJobs` 兼容旧 `canceled`→`cancelled`、`SettingsPanel.tsx`（OpenCode tab、agent-run 历史、s3-upload retry 修复）、`App.tsx`（挂载 `<TaskStack />`）、`workbench.css`（作用域 TaskStack 样式）、`playwright.config.ts`（测试用 agent 轮询间隔）。
- 未改：`prototype/reference.html`（哈希仍 `fe2c41e…f1bb`）、`packages/core/src/operations.ts`、`apps/mcp`、科研领域模型。未访问 `~/ScientificWorkbench`，未修改真实 OpenCode 配置，测试只用临时目录/独立端口/Fake OpenCode，未调用真实模型。
- 测试结果：`pnpm typecheck` 通过；`pnpm build` 通过；`pnpm test` 为 core6/server78（含新增 opencode 12 + agent-runs 15；真实S3 2项按设计跳过）/web/mcp 通过；完整 `playwright test` 40 项通过（含新增 opencode 10 项，Fake V2 HTTP 服务）；prototype hash 未变。
- 剩余限制：业务科研页面尚未增加 AI 任务入口（任务经 `POST /api/v1/agent-runs` 创建）；未对真实 OpenCode 做端到端人工验证（自动测试只针对 Fake OpenCode）；真实 macOS 中文输入法等原有待验收项继续有效。完整首版未完成。
- 服务状态：e2e 结束后无测试服务监听；未启动常驻服务。

## 2026-09-18 OpenCode 异步运行与真实验收修订（优先于上文）

- 执行《Scientific Workbench × OpenCode 下一步修订与真实验收计划》。仅修可靠性，未加业务 AI 入口。
- 环境判定：本机 `opencode 1.18.31` 同时提供新 `/api/*` 与 legacy `/session/*`，但 prompt 契约与 `@opencode/client@2.0.7` 不一致（新 `/prompt` 需要 `{prompt:{text}}`），且没有 `promptAsync`。最终实现 V2-first + V1 兼容，全部收敛在 `apps/server/src/opencode.ts`：`detectOpenCodeFlavor()` 优先 `/api/info`（V2 `@opencode/client`），否则 `/global/health`（V1 原生 HTTP），`CompatOpenCodeAdapter` 对外仍是同一个 `OpenCodeAdapter`。
- J1：V1 `submitPrompt` 改用真正的 `POST /session/:id/prompt_async`（实测约 10ms 返回 204）；发送 `msg_` 前缀持久 message id；`POST /agent-runs` 改 `202`。Workbench 不调用 `session.wait`/`generate`/`POST /session/:id/message` 等阻塞入口。
- Fake 强化：`test/e2e/fake-opencode.ts` 改为真实 V1 契约，暴露 `asyncPromptCalls` 与 `syncPromptCalls`，阻塞 `POST /session/:id/message` 直接 500 失败；新增 E2E 断言 `asyncPromptCalls===1 && syncPromptCalls===0`，并断言 “POST 返回时 Agent 仍 busy”。`opencode.test.ts` 新增 `LegacyOpenCodeAdapter` 5 项与 flavor 检测。
- J2：TaskStack 完成条幅改为由 `state.notices` 驱动，新增 `seenNoticeIds` 与 banner 定时清理；离场后调用 dismiss。新增 E2E “完成通知在 TTL 内刷新后恢复显示”。
- J3：Server 在存在 `queued/running` agent-run 时锁定连接身份（baseUrl/username/password/executionDir），返回 `409 OPENCODE_CONFIG_IN_USE`；permissionMode/textModel/visionModel 可改。`GET /integrations/opencode` 返回 `connectionLocked`，Settings 相应禁用连接输入。新增 E2E 覆盖。
- J4：`createRun` 去掉未使用 baseUrl 变量。
- 回归：`pnpm typecheck`/`pnpm build` 通过；`pnpm test` = core6 + web14 + MCP1 + server83（新增 V1 适配器 5 项；真实S3 2项跳过），共104通过；`pnpm exec playwright test` 44 项通过（opencode 由 10 增到 14）。
- 真实验收（隔离环境，未访问 ~/ScientificWorkbench、未改用户 OpenCode 配置、未用 4317）：真实 OpenCode 1.18.31 连接/版本/7 模型/MCP 已连接；POST agent-runs 148ms 返回 202 且立即黑色方块；真实完成结果落盘；深链返回 Web HTML；运行中改 baseUrl 409、改 permissionMode 成功；浏览器刷新后条幅恢复；重启 Server 后 running 恢复并最终 succeeded；OpenCode 经 scientific-workbench MCP 读取临时 Sample 返回标题 `Smoke Sample`。Permission 真机未触发（默认策略放行工作目录写）与“真实 OpenCode 临时不可达”未人工验证，已在文档标记。
- 未改：`prototype/reference.html` 哈希未变；`packages/core/src/operations.ts`/MCP 无 Agent 入口；未改科研领域模型。完整首版未完成。

## 2026-09-18 OpenCode 基础层封板修订（优先于上文）

- 执行《OpenCode Final Stabilization Plan》。仅修两个已确认问题，未加业务 AI 入口。
- L1 目录路由：Legacy V1 所有实例请求（含 SSE `/event`）统一携带 `x-opencode-directory: <executionDir>`；`createSession` 不再向 `POST /session` body 传 `directory`（该字段被忽略）。V2 仍用 `session.create({location:{directory}})`。
- L2 状态快照：V1 `getSessionStatuses()` 与 V2 `session.active()` 改为**权威快照**（每次重建、clear+set），不再 merge 旧事件缓存，避免丢失 idle 事件后 stale busy 永久保留。`retry` 仍视为 running。
- L3 Fake 强化：E2E Fake 与单测 `FakeV1` 记录 `x-opencode-directory`（`requestDirectories`）、`POST /session` 忽略 `body.directory` 并根据 header 保存 `session.directory`；保留 active-set 语义（idle 不出现）。
- 新增测试：Legacy 请求均带 executionDir 路由 header（`/session`、`/session/status`、`/mcp`、`/event`）且 `session.directory===executionDir !== serverCwd`；V1/V2 stale busy 快照不残留；`agent-runs` 服务层“丢失 idle 事件后 polling 仍 succeeded”；E2E `legacy requests route to executionDir` 与 `polling recovers completion when the idle event is lost`。
- 回归：`pnpm typecheck`/`build` 通过；`pnpm test` = core6 + web14 + MCP1 + server87（新增4项；真实S3 2项跳过），共108通过；`pnpm exec playwright test` 46项通过（opencode 16项）。
- 真实三目录 smoke（workbench/agent/server-cwd 三者不同，隔离 XDG，独立端口，未访问 ~/ScientificWorkbench、未改用户 OpenCode 配置、未用 4317）：真实 1.18.31；POST 0.5s 返回 running；`session.directory=agent`；`cwd-smoke.txt` 只在 agent 目录；Job succeeded。
- 未人工验证项继续保留：真实 Permission、真实 OpenCode 临时不可达、真实 V2 Server。冻结原型未改；`operations.ts`/MCP 无 Agent 入口。
- 状态：OpenCode External Agent Runtime v1 基础层封板；下一阶段另行讨论业务页面如何创建 Agent Task。

## 2026-09-21 通宵计划 Phase A：Agent Knowledge Layer（优先于上文）

- 执行 `docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_OVERNIGHT_PLAN.md`。基线 HEAD `310551d`，Node v22.22.3 / pnpm 10.14.0；开工时工作树仅新增 `docs/plans/`。基线记录：typecheck/build PASS，`pnpm test` = core6 / web14 / mcp1 / server87（真实 S3 2 项按设计跳过）。
- A1 机器契约：新增 `packages/core/src/document-contract.ts`，`document_save` 正式声明 `bindings` 数组 schema；`onRoute` 改为按 operation 声明挂载 body schema（不再只在 required 非空时挂载），旧操作保持 `additionalProperties: true`。`saveDocument` 用纯函数 `sanitizeDocumentBindings` 校验：越界位置拒绝（INVALID_INPUT），指向不存在区块/缺失对象/伪造 create-intent 的绑定不被采纳，保留旧客户端容忍行为；空数组清空 references、省略保留。新增/扩展测试：`packages/core/src/document-contract.test.ts`、`apps/server/src/bindings.test.ts`。
- A2/A3 知识层：新增 `docs/agent/guide.md`、`manifest.json` 与五组协议 `protocol/common|sample-document|objects-properties|data-attachments|analysis-claims-evidence.md`。新增纯生成/校验函数 `packages/core/src/agent-knowledge.ts` 与 `scripts/build-agent-knowledge.ts`（`--check`），生成物 `apps/server/src/generated/agent-knowledge.ts`（已加入 `.gitignore`，不提交）。验证重复 ID/缺文件/非法路径/符号链接逃逸/循环依赖/非法版本/坏链接/未知操作引用；内容 UTF-8/LF 末尾换行，SHA-256 基于发布文本，重复构建字节一致。root/server 的 typecheck/build/test/start 脚本显式先执行幂等生成，脚本用 `import.meta.url` 定位仓库。
- A4 暴露：`knowledge_index`/`knowledge_read` 进入 operations；新增 REST `GET /knowledge`、`GET /knowledge/:id`（保留 auth）；`apps/server/src/knowledge.ts` 只读 loader（未知/路径式 ID 规范 404）。MCP 新增 `workbench://knowledge` 与 `workbench://knowledge/{id}`，`workbench://syntax` 保留 URI/Markdown MIME 但正文改由 `protocol-sample-document` 承接（不再手写常量）。
- 本轮证据（2026-09-21）：`pnpm typecheck` PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp2 / server94（真实 S3 2 项跳过）；`pnpm agent:knowledge:check` PASS（6 项，bundleHash `2a7a070120736d62b378b44ccc10148ab9da9dfef6bfafd1c8462ff7068b0d0e`）；`pnpm api:spec` 已更新 openapi.json；`git diff --check` PASS。
- 未修改冻结原型 `prototype/reference.html`（哈希仍 `fe2c41e…f1bb`）、未访问 `~/ScientificWorkbench`、未改用户 OpenCode 配置；测试只用临时目录/独立端口。
- 下一步：Phase B1 Deterministic Sample Import Backend（`sample-import.ts`、prepare/图片来源校验/source Data、`document_bind_data`、draft 校验与引用物化、whole-batch commit 与最小 receipt、recovery/cancel/backup、API/MCP 暴露与五 Sample 人工 fixture）。A 已可独立使用；B1 不依赖模型。

## 2026-09-21 通宵计划 Phase B1：Deterministic Sample Import Backend（优先于上文）

- 依赖 Phase A PASS，无 OpenCode/模型依赖；所有核心验收使用人工构造 draft。
- 契约（`packages/core/src/sample-import.ts`）：暂态 draft DTO + 严格 JSON schema（限长/有界/未知字段拒绝）、来源 fingerprint、canonical draftHash、commit fingerprint、图片头嗅探、`assertKnownKeys`。operations 新增 `document_bind_data` 与 `sample_import_prepare/get/save_draft/commit/cancel/retry`，strict import body 使用 `additionalProperties:false`；Fastify 改为 `removeAdditional:false`，未知字段在 HTTP 层真实拒绝。
- 服务器（`apps/server/src/sample-import.ts` + `store.ts` 具名方法）：prepare 校验真实图片数量/单张/合计/文件头/哈希并创建 shared source Data（原始 file 组件 `creator:human`、`aboutSampleIds:[]`）；`registry/imports/<importId>.json` 存 prepared/draft/committed/cancelled + attempt + record/draft CAS + fingerprint + 最小 receipt。save_draft 服务器规范化 block ID；commit 在同一次 `Store.commit` 中重算 fingerprint、匹配 parser occurrence、创建显式新对象、分配 sampleKey→ID、保存正文与对象 bindings、`bindDataBlock` 绑定 source Data 后 finalize、写 derived transcription 组件并一次 `updateData` 合并 About/组件，最后把原文件替换成 committed 小型记录（同一事务移除完整 draft/reference mapping/澄清全文，无 archive）。`document_bind_data` 独立可用且不改 About。
- 恢复/资格：`FileRepository.recoveryRequired()` + Store 包装；journal 前失败不留部分实体，journal/file/index checkpoint 失败后重开由 FileRepository 重放整批；HTTP 对科学实体读取/导入/导出/备份返回 `503 RECOVERY_REQUIRED`（health 报 degraded）；cancel 原子撤销资格、retry 重签新 attempt，旧 save/commit 拒绝。backup 递归包含 `registry/imports`，恢复后无 jobs 缓存仍可返回原 receipt。
- 测试：`apps/server/src/sample-import.test.ts`（prepare 幂等/图片边界/五 Sample 提交/最小 receipt/关键歧义/CAS/未知字段/资格/三阶段故障恢复）、`document-bind-data.test.ts`、`backup.test.ts` 新增恢复 receipt 用例、`apps/mcp/src/workflow.test.ts` 新增真实 HTTP 确定性导入用例。五 Sample fixture：5 个样品共享 1 个 source Data、1 张原图、1 个显式新过程对象、现有材料/设备复用、页/行 provenance 与 derivedFrom、About=5、每个 head 绑定同一 Data、正文无自动页行。
- 本轮证据（2026-09-21）：`pnpm typecheck` PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server106（真实 S3 2 项跳过）；`pnpm exec playwright test` 46 passed；`pnpm agent:knowledge:check` PASS；`pnpm api:spec` 已更新；`git diff --check` PASS。
- B1 独立交付（PASS）。未改冻结原型、未访问 `~/ScientificWorkbench`、未改用户 OpenCode 配置。下一步：真实 Vision Spike（隔离 temp + 独立端口 + 显式 opt-in）；Spike 失败不回滚本阶段。

## 2026-09-21 通宵计划 Spike / B2 / 回归与最终交接（优先于上文）

- Spike：`scripts/spike-opencode-vision.mts` 隔离 opt-in harness（计划中写 `.ts`，因仓库 scripts 为 CJS 而改名 `.mts` 以保持 ESM，不影响既有脚本）。无 opt-in 时 exit 1；opt-in 但无隔离端点 `SWB_SPIKE_OPENCODE_URL` 时 exit 0 且 `NOT VERIFIED`。未读取/修改用户全局配置，未启动或借用 OpenCode 服务。
- Spike V1：**NOT VERIFIED**。Spike V2：**NOT VERIFIED**。原因：缺隔离的真实 runtime 端点/凭据；为守规未自行获取秘密或改配置。未证明真实图片 transport、异步时序、restricted profile allow/deny 与无泄漏。
- Phase B2：**BLOCKED**（前置 Spike 未 PASS）。未实现任何 B2 Skill/profile/readiness/UI，因此产品内不存在可开启的 AI 导入路径（fail closed）；A/B1 未回滚。
- 完整回归 R1（clean build 后）：`pnpm agent:knowledge:check` PASS；`pnpm api:spec` 更新；`pnpm typecheck` PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server106（真实 S3 2 项按设计跳过）；`pnpm exec playwright test` 46 passed；`git diff --check` PASS。
- R2 静态审核：仅新增 knowledge / 正常 bind / 确定性 import 操作，无 runtime start/orchestration/任意文件读工具；协议不复制参数 schema；无 `await` 在 `Store.commit` 内；新 import 未直接写 SQLite 属性或另写 Markdown parser；committed registry 无 draft/正文/属性/OCR/prompt/凭据；未新增 UI receipt-ID 高亮/自动刷新。

### 交接字段

```text
本轮开始/结束时间与本地基线：2026-09-21；HEAD 310551d，Node v22.22.3 / pnpm 10.14.0，开工时工作树仅新增计划文件
实施范围：Phase A（Agent Knowledge Layer）、Phase B1（Deterministic Sample Import Backend）、Vision Spike harness 与受阻分支、回归与交接；未实施 B2
实际 commits：b670fb3 计划、c9842cd Phase A、099b40f Phase B1、（本文件所在）Spike/回归交接提交
Phase A：PASS，证据见 docs/VERIFICATION.md 2026-09-21 段（core16/web14/mcp2/server94，bundleHash 2a7a07…，OpenAPI/MCP/REST 同源，legacy syntax 兼容）
Phase B1：PASS，五 Sample 人工 fixture + 三阶段故障恢复 + 最小 receipt + backup/restore receipt 对账；core16/web14/mcp3/server106 + playwright 46
Spike V1：NOT VERIFIED，实际 version/flavor/model/contract/profile 未取得（无隔离真实端点）
Spike V2：NOT VERIFIED，未执行 restricted allow/deny
Phase B2：BLOCKED，启用 flavor：无
typecheck/build/unit/MCP/web/E2E：命令与通过数如上；skip：真实 S3 2 项（按设计）
真实 import smoke：NOT VERIFIED
历史证据（仅引用，不当本轮执行）：2026-09-13~18 OpenCode runtime/S3/MCP 结果
受阻行为和关闭方式：AI 图片导入 flavor 未启用任何入口/readiness（B2 未实现），fail closed
数据/凭据/原型保护情况：未访问 ~/ScientificWorkbench、未改用户 OpenCode 配置、未改冻结原型（fe2c41e…f1bb）
仍运行服务/端口/PID与原因：无本轮创建的服务；未操作 4317/5173 既有进程
临时目录清理或保留说明：测试 mkdtemp 与 spike temp 均在 finally 删除；无保留
下一项最小可执行步骤：在有合法凭据的隔离 temp 中启动真实 OpenCode 服务，设 SWB_SPIKE_OPENCODE_URL 重跑 scripts/spike-opencode-vision.mts，先证 flavor/models/supportsImage，再证图片 transport，之后才评估 B2
```

- 完整首版仍未完成；未执行项（真实 IME、真实 S3、真实 Vision、旧目录实际转换核对、其余页面人工视觉）保持 NOT VERIFIED。

## 2026-09-21 审核问题修复 F01–F08（优先于上文）

- 执行 `docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_REVIEW_FIX_PLAN.md`。基线 HEAD `abe00d2`，Node v22.22.3 / pnpm 10.14.0。**修订上一条记录**：Phase B1 的“PASS”证据不足——上一轮 44 项断言建立在错误行为上；历史记录保留，但 B1 结论以本轮为准。
- 先复现再修：临时 R0 探针在修复前代码上 7/7 失败（F02 覆写科研正文、F03 prepare 返回完整 draft、F04 待确认值进入 property_values、F05 positions-only 无正式映射、F06 12 字节伪 JPEG 通过、F08 receipt 来源版本落后、F07 换 attemptId 仍 success）；`sample-import-http.test.ts` 修复前 3/4 失败。探针已删除，反例保留在正式测试中。
- F02：`sourceBlockId` 显式来源身份；删除 Data 正则，改由 `ensureBlockIds` + `parseBody` 判定；无 `[数据]` 时后端追加专用 placeholder；已有 `[数据]` 未指定、多个 `[数据]`、错误 ID、非空未知子树全部拒绝且零实体写入。
- F03：prepare 只返回小型确认且不再走通用 `Idempotency-Key` 响应缓存；启动时按 `POST:/api/v1/sample-imports:` 命名空间限定清理旧缓存（无匹配不写、损坏 JSON 抛错、其他缓存保留）。
- F04：全批预检查用真实 parser 检查 `PropertyValue.valueText`，「待确认/无法辨认/无法识别/未确认」拒绝整批；改写为普通观察可提交；critical `resolved=true` 需非空 resolution。
- F05/F08：新增每 import 一个 `import-provenance` 组件（`swb.import-provenance/1`，只存 sampleId/componentId/page/positions）；提交顺序改为「先 updateData → 再按最终版本绑定 → 再 finalize」，`receipt.sourceDataVersion` = `Data.version` = 每个镜像 `baseVersion`；不再写虚构的 `model: "sample-import"`。
- F06：新增 `sharp@0.35.4`（仅 server），`verifyImageAttachment` 完整解码像素 + 像素预算 50MP + 符号链接拒绝 + 验证后替换复核；旧假 PNG/魔数 JPEG/WebP 夹具全部换成真实 16×16 图（`apps/server/src/test-images.ts`），MCP workflow 夹具同步替换。
- F07：新增 `submissionHash` + `replayProofVersion`；已提交记录只按该 hash 返回原 receipt，任一身份/版本/hash 变化 409；实体事后编辑不影响原 receipt；缺 proof 的旧记录 POST 返回 409 并提示 GET 对账。
- F01：`scripts/spike-opencode-vision.mts` 改为薄 CLI，逻辑移入 `apps/server/src/vision-spike.ts`；transport 走边界内实验接口并按 flavor 选端点；结论是七项检查的合取（isolation/runtimeIdentityAndModel/asyncSubmission/correlatedImageAnswer/restrictedAllow/restrictedDeny/noSensitiveWorkbenchLeakage），metadata、prompt 回显、旧消息、其他 session 都不能产生 PASS。
- 本轮证据（2026-09-21）：`vitest` 目标 10 文件 60 passed；`pnpm test` = core16 / web14 / mcp3 / server152（真实 S3 2 项跳过）；`pnpm exec playwright test` 46 passed；`pnpm typecheck` / `pnpm build` / `pnpm agent:knowledge:check`（bundleHash `2a7a0701…8b0d0e`）/ `pnpm api:spec` / `git diff --check` 全部 PASS。测试计数较上轮新增 45 项（regression 24 + http 4 + vision-spike 18，扣除并入旧文件的调整）。
- Spike 真实状态：V1 **NOT VERIFIED**、V2 **NOT VERIFIED**（无合法隔离端点/凭据，未发出任何真实调用）；Phase B2 仍 **BLOCKED**，产品内无 AI 导入入口。
- 未改：冻结原型 `prototype/reference.html`（哈希仍 `fe2c41e…f1bb`）、`packages/core/src/operations.ts` 的既有操作语义、用户 OpenCode 全局配置；未访问 `~/ScientificWorkbench`；未使用 4317。测试只用 mkdtemp 与随机空闲端口。
- 下一项最小可执行步骤：在隔离 temp 中启动使用合法凭据的真实 OpenCode 服务（独立目录/端口/PID 追踪），设 `SWB_SPIKE_OPENCODE_URL` 重跑 `scripts/spike-opencode-vision.mts`，先取得 session directory 证据与 `supportsImage` 模型，再确认图片 transport，之后才评估 B2。其余待验收项（真实 IME、真实 S3 之外的核对、旧目录转换核对、页面人工视觉）继续有效，完整首版未完成。

## 2026-09-21 第二轮审核问题最小修补 R1–R5（优先于上文）

- 执行第二轮审核问题最小修补计划（R1 图片异步竞态、R2 CLI 依赖边界、R3 消息关联与最终答案、R4 权限证据、R5 泄漏检查范围）。基线 HEAD `1e3d5dc`，Node v22.22.3 / pnpm 10.14.0；开工时工作树干净。**修订上一条记录**：上一轮「无关消息不能导致 PASS」的说法已被反例否定，且上一轮图片替换测试只覆盖验证后替换、未覆盖解码期间替换；历史记录保留，结论以本轮为准。
- R0 复现（确定性，无 sleep）：解码期间同长度覆盖 → 旧实现仍返回 `prepared` 并创建 source Data；验证后同长度覆盖 → `assertVerifiedImageUnchanged` 不抛错；无关新消息 `Unrelated metadata: 3 4 5 6 7 8` → 旧 `correlatedImageAnswer: PASS`；marker 只在旧消息 → 旧 `restrictedAllow: PASS`；deny 探针静默 → 旧 `restrictedDeny: PASS`；report 干净且无产物 → 旧 `noSensitiveWorkbenchLeakage: PASS`；CLI 配到假端点 → `Cannot find package 'sharp'` 且零请求。临时探针已删除，反例固化进正式测试。
- R1：字节/sha256/文件身份改为同一 fd 一次读出；解码后与提交前各**重新读取并重新哈希当前文件内容**；保留解码、MIME、登记哈希、大小、像素预算与符号链接拒绝；异步解码仍在同步事务外。测试注入仅为最窄暂停点（`StoreOptions.imageVerificationPhase`）。
- R2：CLI 改用 server 导出的 `countRegionsInPng`，不再自行解析 `sharp`；依赖与 lockfile 未变。
- R3：`NormalizedMessage` 增加可选 `parentId`/`tools`（既有 runtime 字段）；只接受本次请求关联、`completed` 已置位、严格单个整数的最终回复；旧消息、其他请求、其他 session、回显、未完成片段一律不采信；同一消息流式更新后重新检查；多图各自关联、不互相借用。
- R4：allow 需「关联调用 + 声明内工具 + 成功 + 返回与受控读取一致」且拒绝声明外调用，证据不足保持 NOT VERIFIED；deny 需七个必需范围各自的拒绝证据或副作用检查，静默/自述/待处理权限都不 PASS；隔离失败立即停止后续提交（断言 `asyncPromptCalls === 0`）。
- R5：泄漏检查拆为 report 脱敏与产物两段，无产物采集即 NOT VERIFIED；采集失败或为空同样 NOT VERIFIED；泄漏只输出类别与产物标签；CLI 支持 `SWB_SPIKE_ARTIFACT_DIR`。
- 本轮证据：`pnpm agent:knowledge:check` PASS（bundleHash `2a7a0701…8b0d0e` 未变）；`pnpm typecheck` / `pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server169（真实 S3 2 项跳过）；`pnpm exec playwright test` 46 passed；`git diff --check` PASS。
- 未变：`apps/web`、`index.html`、冻结原型（`fe2c41e…f1bb`）、科研文件 schema、`operations.ts`/OpenAPI、MCP 操作、依赖与 lockfile。未访问 `~/ScientificWorkbench`，未改用户 OpenCode 全局配置，未使用 4317；测试只用 mkdtemp 与随机空闲端口。

### 交接字段（第二轮）

```text
基线 / 最终 HEAD：1e3d5dc → 本轮提交（见下）
修改文件与范围：apps/server/src/sample-import.ts（R1）、apps/server/src/store.ts（R1 校验接线）、apps/server/src/vision-spike.ts（R3/R4/R5）、apps/server/src/opencode.ts（R3/R4 可选证据字段）、scripts/spike-opencode-vision.mts（R2/R3/R4/R5 接线）、apps/server/src/sample-import-regression.test.ts、vision-spike.test.ts、vision-spike-cli.test.ts（新增）
本地提交：见本文件末尾「本轮提交」

R1：修复内容——单 fd 读取 + 解码后重读重哈希 + 提交前重读重哈希；旧实现反例——解码期间同长度覆盖仍 prepared / 验证后覆盖不抛错；修复后结果——两例均拒绝，零新增 import/Data，多图整批拒绝，正常 PNG/JPEG/WebP 成功且源字节不变
R2：修复内容——CLI 调用 server 的 countRegionsInPng，不自行解析 sharp；CLI 实际执行结果——假端点收到 /global/health、/config/providers，asyncPromptCalls>0，输出无 sharp 解析错误
R3：消息关联与最终答案证据——图片只接受本次 messageId 关联（parentId 或提交顺序）、completed 已置位、严格单整数；无关新消息/其他请求/其他 session/回显/历史/未完成片段均不采信
R4：已验证范围——allow 关联调用+声明内工具+成功+返回一致；deny 七范围拒绝证据与 file-write 副作用检查；NOT VERIFIED 项——真实 runtime 的工具调用证据与全部七范围（未取得真实端点）
R5：已检查范围——harness report 自身（脱敏）与 SWB_SPIKE_ARTIFACT_DIR 指定的产物；未检查范围——真实运行的 Workbench Job/日志（本轮为假服务，未产生）

实际运行命令与结果：局部 7 文件 108 passed；pnpm test = core16/web14/mcp3/server169（S3 2 skipped）；pnpm exec playwright test 46 passed；typecheck/build/agent:knowledge:check/git diff --check 全部 PASS
跳过项及原因：真实 S3 2 项（需容器，按设计跳过）
未运行项：真实 Vision V1/V2、真实 restricted profile 全范围、真实 IME、旧目录实际转换核对

Phase A：PASS（本轮未改，bundleHash 未变）
Phase B1：PASS（上一轮修复结论保持；本轮 R1 进一步关闭图片竞态）
Spike harness 自动化：PASS（27 项负向矩阵 + 5 项真实 CLI 子进程集成）
真实 Vision V1：NOT VERIFIED（无隔离端点/凭据；未发出任何真实调用）
真实 Vision V2：NOT VERIFIED（同上）
Phase B2：BLOCKED（前置真实 Spike 未 PASS，产品内无 AI 导入入口）

前端 / 原型 / 数据格式是否改变：均未改变（apps/web、index.html、prototype/reference.html、科研文件 schema、OpenAPI 无 diff）
用户目录及配置保护情况：未访问 ~/ScientificWorkbench，未改用户 OpenCode 全局配置
剩余服务 / 端口 / PID：无本轮创建的服务；未操作 4317 或用户既有进程
临时资源清理情况：CLI 集成测试的 success/failure 路径均清理；所有测试用 mkdtemp 临时目录，测试结束删除
下一项最小可执行步骤：在隔离 temp 中用合法凭据启动真实 OpenCode（独立目录/端口/PID 追踪），设 SWB_SPIKE_OPENCODE_URL 与 SWB_SPIKE_ALLOW_TOOLS，并用 SWB_SPIKE_ARTIFACT_DIR 导出本次 Job/日志后重跑 CLI；先取得 session directory 证据、supportsImage 模型与工具调用轨迹，再逐项评估七项合取
```

## 2026-09-21 GitHub 公开与人工验收实例

- 用户明确授权将本地 main 上传 GitHub 并将仓库设为公开；已推送实现 HEAD `4f3bafb`，远端默认分支 main，visibility PUBLIC。此次未修补或宣称关闭最新审查问题。
- 最新审查：R1 图片竞态与 R2 CLI 修复可接受；R3 顺序匹配降级、R4 普通工具错误误认权限拒绝、R5 产物来源/范围证据不足仍待处理。局部 108 项首次 107 通过/1 失败，失败的 Spike 正向测试单跑通过，存在 10ms busy 定时器时序不稳定。真实 Vision 仍 NOT VERIFIED，B2 BLOCKED。
- 本次 `pnpm build` PASS。为人工验收创建独立持久目录 `ScientificWorkbench-manual-review-20260921-14321`（仓库同级），通过现有 demo 脚本生成 4 个模拟样品及关联 Data/Analysis/Claim；仅用于软件验收，不是真实实验数据。
- 程序在 http://127.0.0.1:14321/ 运行；启动时 WORKBENCH_DATA_DIR 指向上述独立目录，WORKBENCH_HOST=127.0.0.1；本次监听进程 PID 4184，有意保留供用户操作。health 返回 ok=true/degraded=false，首页 HTTP 200。原有 4317/5173 服务未操作，未访问默认用户工作区。
- 下一步：用户手动检查当前产品页面与编辑流程。人工验收数据保留，不自动删除；AI 导入未开放。

## 2026-09-21 Public documentation refresh

- User requested a new README and public-facing documentation. Rewrote README, development and demo guides; added docs/GETTING_STARTED.md, docs/STATUS.md and docs/README.md; updated API/MCP, migration and OpenCode guidance. Historical implementation records remain, with a current-status pointer.
- Corrected development URL to 5173 (API proxy to 4317), documented built-server startup, and replaced the personal path in mcp.example.json with a portable placeholder. No license was selected or added.
- Public status explicitly retains the latest Spike R3-R5 findings and the flaky positive test; AI image import remains unavailable and B2 blocked.
- Validation: relative links in 10 documents exist; shell examples pass bash -n; MCP JSON parses; git diff --check passes. An isolated pnpm demo -> pnpm start smoke returned healthy status and HTTP 200 with built assets. Its service and temporary workspace were cleaned up. No full business regression rerun for this documentation-only change.
- The user's manual review instance at http://127.0.0.1:14321/ remains healthy and running, with its data unchanged. Next: user manual checks; remaining Spike issues require a separate implementation task.

## 2026-09-21 Distribution review and concise README

- User requested an audit of test material in public files/builds and a README ordered as background/use, quick start, design/benefits. README rewritten accordingly; developer guide now distinguishes source checkout from release artifacts. OpenCode documentation clarifies that directory separation is not an OS sandbox.
- Review baseline 8583539. Findings recorded in audit/DISTRIBUTION_REVIEW.md: tracked audit assets total 2,274,840 bytes; server/MCP/core dist include compiled tests; npm pack dry-run includes test material without a release whitelist. No GitHub releases existed at query time. Tests and audit assets are source evidence, not automatically served web files.
- Tracked temporary databases/reports/private directories were not found; common credential patterns did not match current tracked files. This was not a full Git-history or screenshot privacy audit. Historical documents still contain local paths.
- Validation: changed-document links and bash examples pass; git diff --check clean. npm pack was dry-run only, with scripts disabled, and nothing was published. No production code/build configuration changed; no full business regression rerun.
- Manual review instance at 127.0.0.1:14321 remains healthy and running. Next: if a distributable package is needed, isolate build/test output and specify package contents without deleting normal tests or historical evidence. Remaining Spike findings are unchanged.

## 2026-09-21 Next end-to-end AI import delivery plan

- User requested a coding plan for DeepSeek V4.1 Flash that ends with the expected usable product flow. Added docs/plans/AI_RECORD_IMPORT_DELIVERY_PLAN.md, based on local HEAD 69ad417 and the approved B2 scope.
- Plan explicitly requires early authorized real-runtime/model setup, closure of remaining Spike evidence issues, one genuinely verified target configuration, complete restricted runtime/MCP lifecycle, Samples import UI, manual refresh action, and real browser-to-persisted-entity acceptance. Partial backend or mock completion is not overall delivery.
- Documentation-only planning turn: no implementation, model calls, service changes, commits or push. Existing manual review instance and user data left untouched. Next action is execution of the plan; missing real credentials/endpoint must be surfaced early, not after claiming completion.

## 2026-09-21 AI 记录导入交付计划：S1 完成，S2 起被真实环境阻塞

- 执行 `docs/plans/AI_RECORD_IMPORT_DELIVERY_PLAN.md`。基线 HEAD `69ad417`（与计划一致），Node v22.22.3 / pnpm 10.14.0，工作树仅新增计划文件与其规划记录。
- **D0 环境核对（如实记录缺项）**：本机 `opencode` 1.18.31 已安装，但**没有任何 OpenCode server 在监听**（`lsof` 只有 Workbench 的 14321/4317 与 5173 vite）；没有可用的隔离 endpoint、没有已授权的视觉模型/凭据、也没有用户对真实调用的显式 opt-in。因此 **S2 无法开工，B2 不能启用**（B2 依赖目标组合 Spike PASS）。未读取或搜索任何用户凭据，未改动用户 OpenCode 全局配置，未触碰 14321 人工实例。
- S1 反例复现（基线模块 + 注入式 deps）：无关联字段的正确答案 → `correlatedImageAnswer=PASS`；七个 deny 范围由普通工具错误作答 → `restrictedDeny=PASS`；allow 无成功状态 → `restrictedAllow=PASS`；无关非空产物数组 → `noSensitiveWorkbenchLeakage=PASS`。四项均已固化为正式测试。
- S1 修复：删除按顺序/时间猜测的 positional 关联降级；拒绝证据改为 policy / incidental / none 三级分类（普通工具错误、找不到文件、未知工具、连接失败不算策略拒绝）并要求拒绝指向该能力的目标；allow 缺成功状态不再默认成功；禁止动作实际发生优先于同回复内的拒绝；产物证据要求 runId 一致、采集时间属于本次 run、覆盖 job/log/notice、无截断；fake runtime 改为受控同步点（去掉 `setTimeout`）。
- 本轮证据：局部 7 文件 114 passed；`pnpm test` = core16 / web14 / mcp3 / server175（S3 2 项跳过）；`pnpm exec playwright test` 46 passed；typecheck/build/agent:knowledge:check（bundleHash 未变）/`git diff --check` 全部 PASS。
- 未变：`apps/web`、`index.html`、冻结原型、科研文件 schema、`operations.ts`/OpenAPI、MCP 操作、依赖与 lockfile。未访问 `~/ScientificWorkbench`。
- 状态：**整体任务未完成**。S1 完成；S2 因缺少隔离真实端点/视觉模型凭据/opt-in 而未开始；S2 之后还有 B2.1–B2.6、UI、G2 真实端到端与 D1 交付实例。下一步唯一可行动项见下方交接。

### 交接字段（AI 导入交付计划 · 当前轮）

```text
基线 / 最终 HEAD：69ad417 → 本轮 S1 提交
修改文件与范围：apps/server/src/vision-spike.ts（S1.1/S1.2/S1.3 判定）、apps/server/src/opencode.ts（工具调用有界 input 证据）、scripts/spike-opencode-vision.mts（产物范围/截断）、apps/server/src/vision-spike.test.ts（受控同步点与 33 项矩阵）、docs/VERIFICATION.md、HANDOFF.md、IMPLEMENTATION_PLAN.md
实际运行命令与结果：局部 114 passed；pnpm test = core16/web14/mcp3/server175（S3 2 skipped）；pnpm test:e2e 46 passed；pnpm typecheck / pnpm build / pnpm agent:knowledge:check / git diff --check 全部 PASS
跳过项及原因：真实 S3 2 项（需容器，按设计跳过）
未运行项：S2 真实 transport/profile、B2 全部子阶段、UI、G2 真实端到端、D1 交付实例

Spike harness 自动化：PASS（33 项，含新收紧项）
真实 Vision V1：NOT VERIFIED（无隔离端点/凭据/opt-in；未发出任何真实调用）
真实 Vision V2：NOT VERIFIED（同上）
Phase B2：BLOCKED（前置 S2 未完成）

前端 / 原型 / 数据格式是否改变：均未改变
用户目录及配置保护情况：未访问 ~/ScientificWorkbench，未改用户 OpenCode 全局配置，未读取/搜索用户凭据，未操作 14321 人工实例
剩余服务 / 端口 / PID：无本轮创建的服务；14321/4317/5173 为用户既有进程，未触碰
临时资源清理情况：R0 临时 probe 模块与脚本已删除；测试全部使用 mkdtemp 临时目录；fake runtime 不再依赖定时器
下一项最小可执行步骤（需要用户提供，见下）：在隔离运行目录/端口用合法凭据启动一个真实 OpenCode 实例，并给出 endpoint、目标 flavor（V1 或 V2）、具备图片能力的 provider/model 标识，以及「同意进行有限真实调用」的显式 opt-in；随后按 S2 七项依次取证。
```

## 2026-09-21 S2 阶段 1：真实 V1 图片 transport 已取证（用户已提供隔离环境）

- 用户提供隔离服务：`http://127.0.0.1:4199`、V1 legacy、`opencode 1.18.31`、模型 `deepseek/deepseek-v4-flash-vision-exp`；Basic Auth 从 `/Users/kong/.opencode-acceptance/server.env` 私密读取（新增 `SWB_SPIKE_ENV_FILE`，不进 argv、不打印、不写报告）。授权预算 S2 ≤15 / G2 ≤10 次真实模型请求；本轮 S2 已用 8 次。
- 许可边界：不重启、不修改该隔离服务的全局配置；未触碰 14321 人工实例；未访问 `~/ScientificWorkbench`。
- **已取得真实证据（S2 第 1–4 项）**：session 实际 `directory` 等于专属 Agent 目录；runtime/model 身份明确；`prompt_async` 3ms 返回 204 且返回时无最终回复；两张数量不同（4/7）的随机夹具经 `parentID` 关联读出正确数量。未使用同步 `/message`，未验证 `/api/*`（按要求不扩大范围）。
- 修正：`asyncSubmission` 改用直接判据（返回时是否已存在最终回复），不再依赖滞后的 `/session/status` busy 映射——真实运行时曾因此被误判 FAIL。
- **仍未取证（NOT VERIFIED，B2 不得开放）**：`restrictedAllow`、`restrictedDeny`（七范围）、Workbench 产物泄漏检查。该隔离服务未连接任何 MCP（`/mcp` 为空）且没有受限 permission profile，因此 allow/deny 无法在这台服务上取证；需要按 B2.2 自建专属 managed runtime（独立目录/端口 + workbench MCP + 受限 profile）后再取证。
- 预算状态：S2 剩余约 7 次；一次完整的 allow(1)+deny(7)+图片(1) 取证约需 9 次，超出剩余额度。已向用户申请追加（见下）。
- 下一步：先实现 B2.2 的窄接线（`sample-import-agent.ts`：import scope、MCP 工具过滤、受限 profile、readiness），自建专属 managed 实例，再用追加额度完成 allow/deny/产物取证；之后进入 B2.3–B2.6 与 UI。

## 2026-09-21 S2 阶段 2：受限 runtime 与权限取证（预算用尽）

- 用户追加 S2 预算至 30 次；本轮阶段 1 用 8、阶段 2 用 22，**已全部用尽**。G2 的 10 次额度未动。
- 新增：`apps/server/src/sample-import-agent.ts`（专属 profile + attach/自建两种 managed runtime + readiness）、`apps/mcp/src/main.ts` 导入作用域过滤（强制 scoped importId、隐藏非导入工具与资源）、harness 支持固定目标模型与「已验证 profile 的有效 deny + 无副作用」第二类证据。
- 真实证据：attach 模式 profileHash `8806206f…`；`isolation`/`runtimeIdentityAndModel`/`asyncSubmission`/`correlatedImageAnswer` PASS；**`restrictedAllow` PASS**（runId `c511a509…`，请求关联的 `scientific-workbench_knowledge_read` 成功且返回与受控知识片段一致）。
- `restrictedDeny` 仍未取证，并出现一次 FAIL（runId `41ae5618…`）：根因是**探针缺陷**——shell 探针把哨兵放进 prompt，模型复述指令被判为泄漏。已修正（哨兵只存在于临时文件与受控本地服务），修正后尚未复跑。
- 未取证：`restrictedDeny`（需一次 7 范围复跑，约 7 次请求）、`noSensitiveWorkbenchLeakage`（需 Workbench 侧导入 Job/日志产物，属 B2.3/B2.6 之后）。
- 未触碰用户隔离实例的配置与生命周期；未访问 `~/ScientificWorkbench`；未改 14321 实例。
- 下一步（需追加预算）：复跑 deny 七范围 → 若通过则 S2 目标组合 Spike PASS，随后进入 B2.1 Skill 与 B2.3–B2.6、UI、G2 真实页面端到端与 D1 交付实例。

### S2 结论（2026-09-22 更新）

- **`restrictedDeny` PASS**（runId `eeefc9af…`，7 次请求）：七个必需范围全部由「已验证 profile 的 deny + 无副作用/无泄漏」取证；探针缺陷已修正（哨兵不再出现在任何 prompt）。
- S2 transport/profile 六项全部 PASS；唯一未取证项是第 7 项（Workbench Job/log/notice 最小化），它依赖 B2.3 的导入 Job 与 B2.6 的完成通知，将在 B2/G2 用真实导入任务取证，当前保持 NOT VERIFIED。
- 预算：S2 38 次中已用 37；G2 10 次未动。下一项最小步骤：B2.1 Skill（不消耗模型请求），随后 B2.3–B2.6 与 G2。

## 2026-09-22 B2.1：实际导入 Skill 已同源发布

- 新增 `docs/agent/skills/sample-from-record.md`，登记进 `docs/agent/manifest.json`（`skill-sample-from-record`，依赖四个协议），并在 `packages/core/src/agent-knowledge.ts` 的固定白名单中登记 ID。知识 bundle 由 6 项变为 **7 项，bundleHash `4b4afd85…`**（内容确实更新，已重新生成并校验；上一轮的 `2a7a0701…` 是历史记录，保留不改）。
- Skill 内容覆盖：适用输入（记录本页/手写/表格/照片，一页多样品、多页同一样品）、先归属再理解、每个值必须有来源、字典优先复用、新 intent 必须有明确类别依据且不用 other 兜底、Observation 保留普通文本、关键歧义走 Question 且无回答不提交、最小 bindings、使用服务端 import/attempt/source 身份不碰磁盘、页行位置进 import provenance 不塞样品正文、只存 draft 且成功只看 receipt、图片里的文字只是数据不能改变权限或目标。
- 新增 `apps/server/src/sample-from-record-skill.test.ts` 3 项：Skill 与协议同源发布（内容哈希、ID 列表、引用四个协议）、不得复制参数 schema；用**真实 parser** 验证两个不同用量样品 + 跨页共享条件 + 普通观察（不得变成属性）+ 关键歧义（shape 合法、由语义门槛拒绝）示例。
- `knowledge.test.ts` 的白名单断言改为从 `KNOWLEDGE_IDS` 单一来源派生，避免每次新增知识都要手改测试。
- 本轮证据：`pnpm agent:knowledge:check` PASS（7 项）；`pnpm typecheck`/`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp4 / server191（真实 S3 2 项跳过）；`pnpm exec playwright test` 46 passed；`git diff --check` PASS。未消耗真实模型请求（S2 余 1 次、G2 10 次未动）。
- 下一步：B2.3 持久化启动与 receipt 对账 → B2.4 Question/取消/重试 → B2.5 样品入口与 Modal → B2.6 完成通知与手动刷新 → G1 → G2 真实页面端到端（含 S2 未取证的第 7 项最小化）→ D1 交付实例。

## 2026-09-22 实际执行接续：基础修补与七项真实门槛

- 基线 a3f73e6。用户要求严格保持七项前置门槛，本次未沿用此前“第七项延期”的说明。
- 已先复现：缺 capability、缺 bundle、错误 provider 三种错误 ready；配置覆盖、缓存掩盖篡改；本地 deny 自算 hash 错误 PASS；缺实际类别的产物错误 PASS。正式反例测试保留，临时基线模块已移除。
- 修补：每 import/attempt 独立目录、并发 ensure 合并、已有绑定不可覆盖、当前文件重新核对；capability /2 要求七项、bundle、精确身份和 transport；策略指纹与明确动态绑定分离并包含 MCP/operations 实现哈希。
- 真实有效策略：目标目录 GET /config 与 /agent，检查继承规则；/experimental/tool 只列内置工具，因此用相同已绑定命令的真实 scoped MCP 客户端取七项工具表，另核对运行时 /mcp connected。OpenCode 末尾自带 tool-output 的 external_directory 允许不会放开 read/edit/write/bash，其他继承 allow/ask 仍拒绝。本地文件 hash 本身不算有效权限证据。
- 新最小接线 scripts/verify-import-artifacts.mts：实际 main HTTP server、Store Job、真实 MCP/B1、现有通知路径；父进程捕获真实 stdout/stderr，不用文件名或扫描时补身份。产物逐项需 run/session/job/时间/范围；普通载荷禁止 draft/OCR/prompt/body/images 字段。
- 真实复验：profile run 2377956c-6acf-4897-9b2c-ce192301b5c3 前六项 PASS（10 次）；artifact run 2f5af60d-3a9d-4dec-b938-dbac8c8bf012 第七项 PASS（1 次）。同一策略与 bundle，摘要见 audit/2026-09-22/ai-import。模拟图六个方块，正式正文记录六个，Data/镜像/receipt v2，Store 重开可读。
- 首次 artifact run cf221650-12cc-430b-a5e9-336f7e4b9849（1 次）未 commit：接线误把完成的工具步骤当最终回答，已修正并补回归；没有样品写入，不抹除失败。CLI 旧测试的“所有能力都用 bash 拒绝”不再能证明科学写入拒绝，断言改为 NOT VERIFIED 并检查缺项。
- 用户回复“继续”后按已提出申请执行 S2 总上限54次；目前累计49次，剩5次；G2 10次未动。所有调用先持久记账，不隐式重发。
- 状态：七项真实前置门槛 PASS，B2 现在具备开工条件，产品仍未交付。下一步 B2 生命周期、UI、回归、真实页面 G2。尚未修改原型、用户科研目录、14321实例或用户全局配置；验收子进程关闭，证据临时目录保留，专属 OpenCode directory disposed（服务本体未重启）。

## 2026-09-22 DeepSeek 接续交接：停止新增实现，转入收尾计划

- 用户本轮要求核对未完成事项并制定交给 DeepSeek 的执行计划。已生成 `docs/plans/AI_IMPORT_DEEPSEEK_HANDOFF_PLAN.md`；该文是本次增量接续入口，不重新设计 A/B1。
- HEAD 仍为 a3f73e6，基础修补、真实证据和 B2 初稿均未提交，包含未跟踪文件。不得 reset/clean 或只按 HEAD 接续。此交接阶段只写文档，没有继续修代码、模型调用、提交、push 或 PR。
- 新 `sample-import-runs.ts` 已接 start/readiness、dispatch、轮询、cancel/retry/recover 初稿；main/auth 已接 UI 路由及 scoped token。仍需处理失败后撤销资格、retry 并发、session 响应丢失对账、receipt 优先、重启私密输入、shutdown 异步生命周期并补专项测试。具体风险与验收在新计划 C1。
- 样品菜单和 SampleImportModal 是初稿；TaskStack 和 App 尚未接齐导入取消/重试/刷新动作。真实页面 G2、最终实例均未完成。
- 本次重新运行 `pnpm --filter @workbench/web exec tsc --noEmit`：FAIL，SampleImportModal.tsx:20 TS2554（useRef 缺初始值）。`git diff --check`：PASS。此前服务端类型检查和局部 77 项通过不代表后续 B2 全树通过；当前完整 gate 尚未执行。
- 七项前置证据仍见 audit/2026-09-22/ai-import；仅证明目标组合与最小真实接线，不能代表新产品链路通过。S2 累计49/54，余5；G2 0/10，余10。此次交接未消耗额度。
- 服务：本次计划核对没有启动或停止服务；上一执行阶段验收子进程已结束，原始证据临时目录保留。4199 隔离 OpenCode 是否仍在运行须接手时确认，不擅自重启；14321/4317/5173 既有实例及用户科研目录未操作。
- 下一步：按新计划 D0 核对工作树和证据 → C1 编译/生命周期 → C2 TaskStack/Modal → T1 → G2 → D1。不要重新跑没有相关变化的全部 Spike，也不要停在 mock 通过。

## 2026-09-23 计划执行：生命周期、UI、自动化、真实 G2 与交付实例（优先于上文）

- 执行 `docs/plans/AI_IMPORT_DEEPSEEK_HANDOFF_PLAN.md`（D0 → C1 → C2 → T1 → G2 → D1）。基线为 HEAD `a3f73e6` 加当时全部未提交/未跟踪工作；未 reset/clean，未覆盖任何既有改动。冻结原型未改。
- **C1 编译与生命周期**：修复 `SampleImportModal.tsx` 的 `useRef` 类型错误并整理为明确类型，全树 typecheck 恢复通过。`sample-import-runs.ts` 由初稿重写为完整生命周期：终态统一「先对账 receipt → 持久撤销 attempt 资格 → 尽力 abort → 再对账」，撤销失败只进 `uncertain` 而绝不宣称终态；start/retry/cancel 共用每 import 互斥与 CAS，两个相同 retry 返回同一新 Job/attempt，旧事件与旧取消不能改动新 attempt；`recover()` 不再对创建阶段直接失败，改用持久 Job 行里的确定性关联（session 标题）+ 运行时 session 列表对账，无法唯一确认时进 attention/uncertain 且禁止重发；发送前持久 messageId，已发送任务只恢复监听；成功/失败/取消/重试的私密输入保留策略一致（成功删除、失败与取消保留以便重试还原用户说明，重试迁移到新 attempt）；`shutdown()` 排空在途 dispatch/reconcile 并在 `stopped` 后不写 Store；`scopeState` 每个请求复核磁盘 profile 绑定，端点或 profile 漂移立即吊销 scoped token。
- **C1 关键修补**：完成通知此前会先经 `AgentRunService` 以「无 action」的形态到达客户端，客户端按 id 去重后再也拿不到 `refresh-samples`；现在通知在源头就带 action。`importReplyEnded` 修正真实 V1 语义：`/session/status` 只列非 idle 会话，因此「不在快照里」等价 idle，且仍需本次请求关联的 completed 无工具最终回复。
- **C2 UI**：`SampleImportModal` 补齐缩略图、页序、移除、单项上传重试、可选说明、真实模型与 readiness 原因、StrictMode/关闭后异步更新/object URL 释放、连续选图与上传返回竞态、prepare/start 防重复与「查询并重试启动」；`SamplesPage` 新建菜单可发现且有遮罩/Escape 关闭；`TaskStack` 对导入任务提供可发现的取消、澄清与重试入口（普通任务行为不变）；完成通知只调用 `App.refresh`，不打开会话、不导航、不自动刷新，hover/focus/pending 暂停消失。
- **T1 自动化**：新增 `sample-import-runs.test.ts` 15 项（真实 Store/B1 + 真实 HTTP 授权层，只替换 runtime 与 submit）、`import-artifact-leak.test.ts` 5 项（用真实图片字节、真实凭据形态、真实 draft/OCR 文本反向证明最小化检测，并覆盖采集不完整/陈旧/越界一律 NOT VERIFIED）、`test/e2e/sample-import.spec.ts` 5 项（真实 UI、HTTP、上传、parser、B1 commit、文件持久化，只替换 runtime）。gate 见本节末。
- **G2 真实页面验收**：`scripts/g2-import-acceptance.mts` 独立数据目录 `~/ZanderProject/ScientificWorkbench-g2-20260923`、独立端口 14323、attach 既授权隔离 OpenCode 4199（V1 1.18.31 + `deepseek/deepseek-v4-flash-vision-exp`），真实 readiness（profileHash 与 capability 一致、bundle 一致、scoped MCP 七工具表）。三组场景全部从页面上传开始：①一页多样品不同用量 → R1/R2/R3 三个样品，2.5/5.0/7.5 g 与 10/20/30 mL、30/45/60 min 各自成对、零串样，原料/坩埚为共享对象，备注进入各样品正文且正文无页码；②两页同一样品 → 只建 1 个样品 T7，两页内容与页序（page 1、2）正确合并，来源图片两张；③关键歧义 → 真实进入 Question（模型明确说明 5 g/8 g 冲突且「未确认前不作为已确认属性提交」），回答后按选定值 8 g 提交。真实模型在场景 1/2/3 都主动提问（原料身份、备注归属、产物归属、跨页归属），全部经产品澄清入口回答，问答与回答内容取自运行时 session 历史而非自报。
- **G2 重启与最小化**：停止并重启同一实例后，5 个样品、3 个 Data、4 个附件全部可读，正文与磁盘一致、Data 绑定与 receipt 版本对齐、重复实体数为 0。三组场景分别用真实 Job 行、真实服务日志（约 300 KB，含 redact 后的请求日志）与由持久 Job 行派生的完成通知做最小化检查，均 PASS（未发现图片字节、内联载荷、凭据、工作区路径、draft/OCR/prompt 字段）。通知项标注 `noticeSource: derived-from-durable-job`。
- **G2 预算与失败记账**：G2 额度 10 次，本轮累计使用 **8 次**（余 2）。前三次为真实失败并保留计数：第 1 次因验收脚本场景轮询窗口过短放弃；第 2 次回答 payload 形状不符（400）；第 3 次用错 question 路由（V2 路由看不到 legacy 会话，404）。修正为 V1 `/question/{id}/reply` 与逐子问题选项后才取得三组结果。S2 仍为 49/54，未动。
- **已知未取证/弱点（不得当作通过）**：完成通知产物在重启核对时已过 TTL，采用由持久 Job 行派生的等价记录（产品通知本身就是该行的纯函数）；「回答前无 commit」本轮为运行期现场观察，持久化形式是单次 receipt 内含回答后的 8 g（若回答前已 commit，replay-proof 规则会拒绝其后提交）与 question 时间早于 `committedAt`；澄清回答使用运行时自身 V1 question-reply 契约（其 UI 同路由）提交，未在 OpenCode Web UI 内点击。场景 3 正文里模型自行写了一行未绑定的 `[数据] 2026-09-20 实验记录图片`（真实来源 Data 仍正确绑定在追加的占位块上），属模型侧写法问题，记为待改进而非程序缺陷。真实 macOS 中文输入法、真实 S3、旧目录实际转换核对等既有未验收项不受本轮影响。
- **交付实例**：`pnpm import:instance`（等价命令见 README/HANDOFF 文末），数据目录 `~/ZanderProject/ScientificWorkbench-g2-20260923`，端口 14323，非敏感示例图 `audit/2026-09-22/ai-import/g2/fixtures`，菜单位置「样品 → ＋新建样品 右侧箭头 → AI 从实验记录新建样品」。既有 14321 人工实例、4317/5173、用户科研目录与用户 OpenCode 全局配置均未操作。

## 2026-09-23 计划执行：生命周期、UI、自动化、真实 G2 与交付实例（优先于上文）

- 执行 `docs/plans/AI_IMPORT_DEEPSEEK_HANDOFF_PLAN.md`（D0 → C1 → C2 → T1 → G2 → D1）。基线为 HEAD `a3f73e6` 加当时全部未提交/未跟踪工作；未 reset/clean，未覆盖任何既有改动。冻结原型未改。
- **C1 编译与生命周期**：修复 `SampleImportModal.tsx` 的 `useRef` 类型错误并整理为明确类型，全树 typecheck 恢复通过。`sample-import-runs.ts` 由初稿重写为完整生命周期：终态统一「先对账 receipt → 持久撤销 attempt 资格 → 尽力 abort → 再对账」，撤销失败只进 `uncertain` 而绝不宣称终态；start/retry/cancel 共用每 import 互斥与 CAS，两个相同 retry 返回同一新 Job/attempt，旧事件与旧取消不能改动新 attempt；`recover()` 不再对创建阶段直接失败，改用持久 Job 行里的确定性关联（session 标题）+ 运行时 session 列表对账，无法唯一确认时进 attention/uncertain 且禁止重发；发送前持久 messageId，已发送任务只恢复监听；成功/失败/取消/重试的私密输入保留策略一致（成功删除、失败与取消保留以便重试还原用户说明，重试迁移到新 attempt）；`shutdown()` 排空在途 dispatch/reconcile 并在 `stopped` 后不写 Store；`scopeState` 每个请求复核磁盘 profile 绑定，端点或 profile 漂移立即吊销 scoped token。
- **C1 关键修补**：完成通知此前会先经 `AgentRunService` 以「无 action」的形态到达客户端，客户端按 id 去重后再也拿不到 `refresh-samples`；现在通知在源头就带 action。`importReplyEnded` 修正真实 V1 语义：`/session/status` 只列非 idle 会话，因此「不在快照里」等价 idle，且仍需本次请求关联的 completed 无工具最终回复。
- **C2 UI**：`SampleImportModal` 补齐缩略图、页序、移除、单项上传重试、可选说明、真实模型与 readiness 原因、StrictMode/关闭后异步更新/object URL 释放、连续选图与上传返回竞态、prepare/start 防重复与「查询并重试启动」；`SamplesPage` 新建菜单可发现且有遮罩/Escape 关闭；`TaskStack` 对导入任务提供可发现的取消、澄清与重试入口（普通任务行为不变）；完成通知只调用 `App.refresh`，不打开会话、不导航、不自动刷新，hover/focus/pending 暂停消失。
- **T1 自动化**：新增 `sample-import-runs.test.ts` 15 项（真实 Store/B1 + 真实 HTTP 授权层，只替换 runtime 与 submit）、`import-artifact-leak.test.ts` 5 项（用真实图片字节、真实凭据形态、真实 draft/OCR 文本反向证明最小化检测，并覆盖采集不完整/陈旧/越界一律 NOT VERIFIED）、`test/e2e/sample-import.spec.ts` 5 项（真实 UI、HTTP、上传、parser、B1 commit、文件持久化，只替换 runtime）。gate 见本节末。
- **G2 真实页面验收**：`scripts/g2-import-acceptance.mts` 独立数据目录 `~/ZanderProject/ScientificWorkbench-g2-20260923`、独立端口 14323、attach 既授权隔离 OpenCode 4199（V1 1.18.31 + `deepseek/deepseek-v4-flash-vision-exp`），真实 readiness（profileHash 与 capability 一致、bundle 一致、scoped MCP 七工具表）。三组场景全部从页面上传开始：①一页多样品不同用量 → R1/R2/R3 三个样品，2.5/5.0/7.5 g 与 10/20/30 mL、30/45/60 min 各自成对、零串样，原料/坩埚为共享对象，备注进入各样品正文且正文无页码；②两页同一样品 → 只建 1 个样品 T7，两页内容与页序（page 1、2）正确合并，来源图片两张；③关键歧义 → 真实进入 Question（模型明确说明 5 g/8 g 冲突且「未确认前不作为已确认属性提交」），回答后按选定值 8 g 提交。真实模型在场景 1/2/3 都主动提问（原料身份、备注归属、产物归属、跨页归属），全部经产品澄清入口回答，问答与回答内容取自运行时 session 历史而非自报。
- **G2 重启与最小化**：停止并重启同一实例后，5 个样品、3 个 Data、4 个附件全部可读，正文与磁盘一致、Data 绑定与 receipt 版本对齐、重复实体数为 0。三组场景分别用真实 Job 行、真实服务日志（约 300 KB，含 redact 后的请求日志）与由持久 Job 行派生的完成通知做最小化检查，均 PASS（未发现图片字节、内联载荷、凭据、工作区路径、draft/OCR/prompt 字段）。通知项标注 `noticeSource: derived-from-durable-job`。
- **G2 预算与失败记账**：G2 额度 10 次，本轮累计使用 **8 次**（余 2）。前三次为真实失败并保留计数：第 1 次因验收脚本场景轮询窗口过短放弃；第 2 次回答 payload 形状不符（400）；第 3 次用错 question 路由（V2 路由看不到 legacy 会话，404）。修正为 V1 `/question/{id}/reply` 与逐子问题选项后才取得三组结果。S2 仍为 49/54，未动。
- **已知未取证/弱点（不得当作通过）**：完成通知产物在重启核对时已过 TTL，采用由持久 Job 行派生的等价记录（产品通知本身就是该行的纯函数）；「回答前无 commit」本轮为运行期现场观察，持久化形式是单次 receipt 内含回答后的 8 g（若回答前已 commit，replay-proof 规则会拒绝其后提交）与 question 时间早于 `committedAt`；澄清回答使用运行时自身 V1 question-reply 契约（其 UI 同路由）提交，未在 OpenCode Web UI 内点击。场景 3 正文里模型自行写了一行未绑定的 `[数据] 2026-09-20 实验记录图片`（真实来源 Data 仍正确绑定在追加的占位块上），属模型侧写法问题，记为待改进而非程序缺陷。真实 macOS 中文输入法、真实 S3、旧目录实际转换核对等既有未验收项不受本轮影响。
- **交付实例**：`pnpm import:instance`（等价命令见 README/HANDOFF 文末），数据目录 `~/ZanderProject/ScientificWorkbench-g2-20260923`，端口 14323，非敏感示例图 `audit/2026-09-22/ai-import/g2/fixtures`，菜单位置「样品 → ＋新建样品 右侧箭头 → AI 从实验记录新建样品」。既有 14321 人工实例、4317/5173、用户科研目录与用户 OpenCode 全局配置均未操作。

### gate（2026-09-23，代码改动完成后一次完整执行）

```text
pnpm agent:knowledge:check  PASS（7 项，bundleHash 4b4afd8536809476859f32bf3e6867d55db2d14c43eb86fa76e0677189c3ad7b）
pnpm typecheck              PASS（core / mcp / web / server）
pnpm build                  PASS（core / mcp / web / server）
pnpm test                   PASS：core 16 / web 14 / mcp 4 / server 221（真实 S3 2 项按设计跳过）
pnpm test:e2e               PASS：51 passed（含新增 sample-import 5 项）
git diff --check            PASS
pnpm api:spec               无 diff（UI-only 的 readiness/start 未进入科学 operations）
```

### 交接字段（本轮）

```text
基线 / 最终状态：HEAD a3f73e6 + 全部未提交工作 → 本轮分阶段本地提交（未 push、未建 PR）
修改范围：apps/server/src/{sample-import-runs.ts,sample-import-agent.ts,agent-runs.ts,auth.ts,main.ts,opencode.ts,import-observation.ts} 与其测试；
          apps/web/src/{components/SampleImportModal.tsx,components/TaskStack.tsx,components/sample-import.css,pages/SamplesPage.tsx,App.tsx,workbench.css}；
          test/e2e/{sample-import.spec.ts,fake-opencode.ts}、playwright.config.ts；scripts/{g2-import-acceptance.mts,g2-instance.mts}、package.json
自动化：unit 255 通过（含 2 项真实 S3 跳过）；E2E 51 通过；api:spec 无 diff
真实 G2：三组场景全部提交（R1/R2/R3、T7、Q1），重启重开一致，最小化三组 PASS；证据 audit/2026-09-22/ai-import/g2/{g2-report.json,budget.json,fixtures,scenario1-completed.png,scenario3-question.png}
预算：S2 49/54 未动；G2 8/10（余 2），三次真实失败已计数
跳过项及原因：真实 S3 2 项（需容器，按设计跳过）
未运行项：真实 macOS 中文输入法、旧工作区实际转换核对、完整首版其余页面人工视觉
用户目录与实例保护：未访问 ~/ScientificWorkbench；未操作 14321/4317/5173；未改用户 OpenCode 全局配置与原型
剩余服务：4199 隔离 OpenCode（既有，未重启）；交付实例见 URL 与端口
```

### 交付实例启动/停止

```bash
# 启动（前台，Ctrl-C 即停止）
pnpm import:instance
# 等价显式命令
WORKBENCH_DATA_DIR=/Users/kong/ZanderProject/ScientificWorkbench-g2-20260923 \
WORKBENCH_PORT=14323 WORKBENCH_HOST=127.0.0.1 \
WORKBENCH_IMPORT_OPENCODE_URL=http://127.0.0.1:4199 \
WORKBENCH_IMPORT_ENV_FILE=/Users/kong/.opencode-acceptance/server.env \
WORKBENCH_IMPORT_CAPABILITY_FILE=$PWD/audit/2026-09-22/ai-import/capability.json \
npx tsx apps/server/src/main.ts
```

- 入口：http://127.0.0.1:14323/ → 样品 → ＋新建样品 右侧箭头 → AI 从实验记录新建样品
- 模型：`deepseek/deepseek-v4-flash-vision-exp`（V1 legacy 1.18.31，`/session/:id/prompt_async`）
- 示例图：`audit/2026-09-22/ai-import/g2/fixtures/*.png`（合成记录，非真实实验数据）
- 日志：前台 stdout；验收运行日志归档在 `audit/2026-09-22/ai-import/g2/workbench.log`（未提交）

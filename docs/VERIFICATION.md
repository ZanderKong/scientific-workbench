# 验收记录

## 2026-09-12 执行起点

- 完整首版：未完成。
- 原有9项单测与2项E2E为历史结果，不替代本计划门槛。
- 已确认既存缺口：UI未严格迁移，自动猜测创建对象、节点身份丢失、文件独立重建、Data CAS、证据范围和存储授权未闭环。
- BASE-001 文档建立；冻结哈希和资料链接验证待执行。
- BASE-002/UI/DOC/DATA/CLAIM/API/STORE/VERIFY：未验证。

### BASE-001/BASE-002/UI-001a

- `node scripts/freeze-prototype.mjs`：通过 SHA-256 检查，原型只读副本已建立。
- `pnpm --filter @workbench/web build`：通过；已有 Vite 插件兼容警告保留待整治。
- `pnpm exec playwright test test/e2e/prototype.spec.ts`：1通过；独立14317/临时目录启动。
- 9类区域几何≤2px及字号/padding/radius一致；截图126像素差异（0.00875%）。只遮罩原型写死的顶栏保存状态，不遮结构。证据 audit/2026-09-12/UI-001a。
- 仅列表默认状态通过，不扩大为全部页面/控件/底层通过。

追加结果必须写任务ID、执行命令、实际结果及证据位置。失败保留复现方法。禁止以未执行人工IME标通过。

### UI-002 / DOC-003 / DOC-004 局部行为验证

- `pnpm test`：core 3、server 8、web 6，共17项通过；MCP尚无测试，不能视为通过。
- `pnpm exec playwright test test/e2e/workbench.spec.ts`：3通过。包含真实键盘Enter/Tab、属性落盘/重开/来源跳转/区块ID、断网阻止切页并重试，以及导航。
- 初次浏览器失败：StarterKit trailingNode 在空 bullet 后生成段落，点击后文字进入列表外，Tab离开编辑器。现禁用 trailingNode 后上述真实文件断言通过。没有删掉文件断言。
- 修复外部重新加载未更新基线、每次自动保存生成历史、未匹配对象猜类别创建。新增服务端复现测试。
- UI-002视觉仍未验收；剪贴板/IME/所有区块操作仍待补充，不扩大声明。
- UI-003列表和Data详情迁移正在进行。新Data详情已接版本保存/多样品About/附件/共同论点编辑组件，仍待端到端及逐状态像素验收。

### DATA-001 / UI-003 局部验证

- `pnpm --filter @workbench/server test`：11通过（store8＋data-sync3）。Data独立更新不被重复finalize覆盖；双方修改冲突；仅删引用、保留两个独立Data。
- parser改为保留Data子树Markdown及稳定ID，新增歧义/类型标记/无猜测意图测试；core4通过。
- `pnpm exec playwright test test/e2e/data.spec.ts`：2通过。UI写正文/About、重复字节上传保留一个附件、创建host为Data的正式Claim；并发API修改后UI冲突保留草稿，可加载最新。
- `pnpm exec playwright test`（在Resources/Settings最新替换前）：4通过，包含UI-001a默认视觉、样品保存闭环及导航。后续改动须跑相关页面回归。
- Analysis/Claim详情、Resources和Settings新组件未完成视觉验收。旧legacy-pages.tsx不再由App引用。

### DOC-001 / CLAIM-001 新协议局部门槛

- FileRepository 5项通过：单写入锁、journal/file/index三处注入失败后的文件恢复、路径越界拒绝。
- 文件独立重建2项通过：移除测试index，重新打开后所有四类实体、字典、属性、Data关联及组件、分析顺序、Claim证据、正文历史及附件字节恢复；旧目录拒绝原地迁移。
- context.test.ts 1项通过：直接样品所含Data、对象、去重与不递归展开，导出与证据共用集合，旧证据不可变、补充新证据。
- 最近server19项通过。随后对ensureLatest与复制/冲突恢复/历史API的改动仍须复测。
- 原型其他页面像素、旧格式迁移、真实进程kill恢复、磁盘故障、完整S3与备份恢复、真实MCP流程和性能仍未验收。

### 2026-09-12 UI-002 / DOC-005 / STORE-002 后续

- `pnpm test`：core4、server21、web9通过（34项；MCP仍无测试）。随后新增备份与S3测试单独记录。
- 浏览器7项原有回归通过。新batch E2E首次暴露详情缺contentVersion，修复后 `playwright test workbench.spec.ts -g 'batch template'` 通过：逐行修改为60min，原正文不改、不复制实验Data。
- 复制实现原先误保留Data，按SAMPLE-001改正，测试改为验证结果剔除、操作属性与新ID。此为规则纠偏，旧“共享Data复制通过”不再是有效验收结论。
- `vitest run src/backup.test.ts src/file-rebuild.test.ts`：5通过；恢复新目录后，原目录不可访问且无private凭据，证据正文/附件字节可读；缺件和路径越界失败，不发布完整结果。
- 最新 `pnpm build` 通过。S3队列/稳定位置/缓存已写，真实兼容服务验收仍待执行，不能由本地backup通过推断S3通过。

### 2026-09-13 UI-003 / CLAIM-001 / DOC-001

- `vitest run src/analysis.test.ts src/file-rebuild.test.ts src/context.test.ts`：4通过。分析布局/列顺序/产物写文件、无索引重建、解除产物引用不改旧证据。
- `playwright test analysis.spec.ts data-visual.spec.ts data.spec.ts`：4通过（浏览器重开布局/列/附件、Data保存/冲突、描述型Data几何）。随后带像素和980/640检查的 `playwright test data-visual.spec.ts`：1通过。
- UI-003a描述型Data：从122px信息区偏差修复到六区几何一致，未遮罩像素差0.266875%，门槛0.5%；证据 [对照目录](../audit/2026-09-13/UI-003a-description/README.md)。不是所有Data状态通过。
- `vitest run src/editor/claim-draft.test.ts`：1通过；正式提交分别生成父级论点，子级文字不丢失，内部标记不进入论点文字。完整创建重试浏览器测试待补。
- 最近全构建通过；新增独立实体外部文件保护/重载仍在验证。此前真实MinIO2项、真实MCP1项通过来自上一上下文；完整协议覆盖仍未完成。

### 2026-09-14 DOC-004 / DATA-001 / UI-003a

- 最近完整 `pnpm test`：core6、server30、web12、MCP1，共49通过；真实S3的2项明确跳过。
- Data组件8项相关服务端测试通过：角色/来源/派生文本落盘、无索引重建、旧证据不变、外部修改防覆盖、同步与上下文。浏览器analysis/data/data-visual共5项通过，新增文本组件派生与解除来源保护。
- `pnpm exec playwright test test/e2e/data-visual.spec.ts`：2通过。FTIR多组件页六区几何≤2px；无任何遮罩像素差6301/1440000=0.43757%。只作为该固定状态通过，不等于其他页面已完成。
- 修复文件序列化删除开头空行、仅支持LF头的问题；新增正文哈希/CRLF往返测试2通过。

### 2026-09-14 UI-003b

- `pnpm exec playwright test test/e2e/analysis-visual.spec.ts`：1通过；1440×1000八区几何一致，无遮罩像素6313/1440000=0.43840%。夹具明确保存为正文区关闭的布局，不把它称为所有分析状态通过。
- 初次测试因视觉夹具缺Sample.createdAt导致无效列表输入，补齐完整夹具后通过，未修改应用排序或放宽断言。
- 新增真实图表附件内嵌预览、产物管理面板、手选资源/论点上下文与资源跳转。文件本身未变化，图表来自实际附件；测试图表来自原型渲染，仅用于视觉夹具。

### 2026-09-14 DOC-003 / DOC-004 / DATA-001 最新回归

- 上一轮完整浏览器回归16项通过，涵盖样品、Data、分析、IME composition与固定视觉状态；其后新增Data身份保护，markerless浏览器测试1项通过。
- `vitest run src/data-identity.test.ts src/context.test.ts`：3项通过，包括待关联警告出现在导出，重复提取不新建Data。
- `pnpm build`：全部四包通过；Vite插件弃用及大包警告仍存在，未隐藏。
- `vitest run src/create-intent.test.ts src/bindings.test.ts`：6项通过。明确创建意图落正文但不入对象字典，重启/无索引重建后只创建一次，修改/删除/无效类别不创建。
- `vitest run src/editor/codec.test.ts`：6项通过，含创建意图往返与改字解除。
- `playwright test workbench.spec.ts -g 'explicit object creation'`：1项通过；浏览器中检查真实文件与API，完成前无对象、完成后有正确设备身份和属性，重复完成不重复，编辑意图后不创建。
- 已纠正过时 API 文档中的可选版本与请求头自授权说明；OpenAPI 改为 `pnpm api:spec` 从共用操作定义生成。接口完整覆盖仍待补齐。

### UI-003c / CLAIM-001

- `playwright test claim-visual.spec.ts`：1通过，八区≤2px，无遮罩像素0.32542%；已实际看图。证据 audit/2026-09-14/UI-003c-claim。初次因测试导航图标写错而超时，纠正选择器后通过，未改视觉断言。
- `playwright test claim.spec.ts`：1通过，Data改名改正文后卡片仍显示旧证据，编辑论点不刷新证据，补充追加新快照，固定正文可展开、相关样品可跳转。
- `vitest run context.test.ts file-rebuild.test.ts backup.test.ts`：6通过，证据分实体正文随文件重建与独立备份恢复保留。
- Data两项视觉重跑通过；FTIR对照已归档 audit/2026-09-14/UI-003a-FTIR。

### UI-003d / DOC-005 资源局部验收

- `vitest run resource-metadata.test.ts create-intent.test.ts file-rebuild.test.ts`：7通过，验证标识/推荐属性无索引重建、版本冲突和无效推荐拒绝；给设备填写非推荐的添加量仍正常提取。
- `playwright test resource-visual.spec.ts`：原料列表和详情1项通过，5/7区域≤2px，像素分别0.01292%/0.12201%。证据 audit/2026-09-14/UI-003d-material，已实际看图。
- 资源列表接通排序与列可见性；移除原型没有的表卡切换，保留五个默认资源分类；有旧other对象时额外显示该分类，避免隐藏既有内容。量纲页暂沿用全局属性信息，原型自动换算不实现；完整量纲展示仍待验收。

### 2026-09-14 11:03 综合回归

- `pnpm test`：core6/server37/web13/MCP1，共57通过，S3集成2项明确跳过。
- `pnpm exec playwright test`：完整22项通过，独立临时目录/14317。
- 资源真实测试初次发现样品列表API未返回文件头，导致纯引用与分析内样品Data漏显。修复API返回head并补两处UI实际断言后，resources/analysis2项及完整22项通过。未弱化检查。
- 构建通过，原型文件及用户工作区未修改。

### 2026-09-14 DOC-002 旧格式转换

- `vitest run src/migration/convert.test.ts`：3通过。旧Markdown＋旧SQLite转换后移走旧目录、删除新索引，样品属性/Data来源与组件/分析顺序/论点旧证据/正文历史均可重建；原目录逐文件哈希不变，凭据不复制。
- 缺附件出失败报告且不发布目标，已有目标/内嵌源目录拒绝覆盖；文件独占的历史/证据与未登记附件保留。
- 初次失败为macOS /var与/private/var路径别名，修复为按显式源路径及真实源路径校验内部相对路径，未放宽越界保护。
- 实际用户目录未执行迁移。转换后可能仍有待关联或旧证据不完整提示，不把报告verified等同于科学内容已核查。

### 2026-09-14 DOC-002 / UI-002 附件

- 迁移source1＋convert3共4项通过：增加读取期间目录/文件变化、符号链接与越界路径拒绝验证。全构建通过。
- body-attachments＋data-sync4项通过：两个Data共享附件、重复提取不重复、删正文附件仅解除对应组件、旧证据及无索引重建保留字节。
- codec7项通过，含带转义方括号文件名及普通正文不误识别协议的往返。
- sample-attachments真实浏览器1项通过：中文文件名、两文件上传/预览、真实Markdown落盘、重开标签、重复提取与独立Data组件读取。
- 本轮尚未合并运行完整unit/E2E；完整样品视觉正在对照，不因附件交互通过宣称视觉完成。

### 2026-09-15 UI-002 / UI-003d/e / VERIFY-001 / STORE-003

- 完整样品状态在1440×1000逐区≤2px；仅归一化已确认的括号语法后，无遮罩像素差3938/1440000＝0.273472%。980/640及折叠状态通过。区块实际移动、拖放、浏览器剪贴板复制新ID、撤销重做、完成编辑、落盘重开均由 `editor-identity.spec.ts` 验证。
- 资源对象合并和永久删除已接服务端一次性危险授权、双版本条件和二次确认。合并会把样品文件头中的稳定引用改到目标ID并随无索引重建保留；纯引用对象也不能删除。`resource-metadata.test.ts` 2项、`resources.spec.ts` 2项通过。
- `overlay.spec.ts` 验证全局搜索的初始焦点与真实跳转、帮助中的现行括号语法、设置的真实数据目录/S3默认边界/OpenAPI入口和640窄屏；设置弹窗外框四区与原型位置、宽度、padding、圆角一致。设置内容扩展为首版要求的五个面板，记录为必要功能差异。
- PVA演示生成器不再删除目标目录，且拒绝覆盖。`demo-workspace.test.ts` 2项验证三次冻结/解冻各为独立稳定操作、Import-01多样品Data与组件角色、Analysis导出、样品论点仅文本、正式Claim固定证据及删除SQLite后的完整重建。
- `createData` 修复为从创建时保存完整组件角色、来源和附件身份；OpenAPI同步更新。
- `pnpm benchmark` 使用临时目录实测：20/100/500操作的整篇提取分别61.97/122.12/395.21ms；50,005对象批量读取74.27ms，5,000/50,000项补全3.63/16.15ms。证据见 `audit/2026-09-15/VERIFY-001-performance.json`；为本机观测值。
- 对象和属性搜索移除逐项别名SQL查询。完整备份加入AbortSignal，取消不发布partial/完整包；`backup.test.ts` 4项通过。恢复后写入0600启动选择并在下次普通启动切换，显式数据目录不被覆盖；`workspace-location.test.ts` 2项通过。
- 附件清理增加只读预览、证据/正文/Data/分析引用保护、整批预检、S3稳定位置删除和一次性`cleanup`授权。设置页可明确勾选无引用附件后执行；`attachment-cleanup.test.ts` 2项及设置页真实清理流程通过。
- 2026-09-15最终串行 `pnpm test`：core6、server51、web14、MCP1，共72项通过；普通测试仍明确跳过需容器的真实S3两项。`WORKBENCH_S3_INTEGRATION=1 ... s3.integration.test.ts` 使用隔离MinIO再次2项通过。`pnpm exec playwright test` 最终28项全部通过。`pnpm build`和OpenAPI生成通过；保留Vite React插件弃用提示及731KB单包警告，不将其隐藏为成功。
- 最终轮曾把单元与浏览器并行：PVA完整生成测试因资源竞争在5.4秒超过默认5秒，断言未失败；该真实工作流显式采用15秒预算，串行全套用3.0秒通过。设置附件清理按钮最初在超高内容中位于视口外，修复为弹窗正文滚动后，真实点击、授权、删除和复查通过。

### 2026-09-16 UI-DENSITY-001 Design v2 可读性

- 任务：`/Users/kong/Downloads/Scientific_Workbench_Design_v2_UI_Readability_EPLAN.md`，首次可读性/控件密度迁移。新增 `apps/web/src/density.css`（Design v2 覆盖层，`prototype.css` 冻结未改），`main.tsx` 按 `prototype.css → workbench.css → density.css` 顺序加载。
- 改动文件：`apps/web/src/density.css`（新增）、`apps/web/src/main.tsx`、`test/e2e/design-v2.ts`（新增共享断言）、`test/e2e/density.spec.ts`（新增）、`test/e2e/prototype.spec.ts`、`test/e2e/sample-visual.spec.ts`、`test/e2e/data-visual.spec.ts`、`test/e2e/analysis-visual.spec.ts`、`test/e2e/claim-visual.spec.ts`、`test/e2e/resource-visual.spec.ts`、`test/e2e/overlay.spec.ts`、`DESIGN_RULES.md`、`HANDOFF.md`、`docs/VERIFICATION.md`。
- 主要排版前→后：导航/品牌 12→13px；侧栏动作 10→12px；topbar 10→11px；主按钮 11→12px 且 min-height≈32px；工具条/分段控件 10→12px；表格正文 10→12px、表头 9→10px；objToken/propText/sortMark 8→10px；pill/status 9→10px；miniProps 9→10px；Data/Analysis/Claim/Resource 8–9px 微文字统一到 10–11px；弹窗字段标签 9→11px、输入 10→12px；样品编辑器辅助信息 9–10→11px。样品一级正文保持15px、二级13px；侧栏168px、topbar 48px、840/980内容宽、980/640断点均未变。
- 未采用任何根级 `font-size` 百分比、`zoom`、`transform: scale()` 或加宽容器；未改业务逻辑、API、解析、持久化与 Tiptap 模型；未改 `prototype/reference.html` 与 `prototype.css`。
- 视觉测试迁移：移除与冻结原型的整页 `pixelmatch` 断言（保留截图产物），改为断言已批准的水平布局不变量（元素 x/宽度对照冻结原型，≤2px）、Design v2 排版值、无页面级横向溢出和控件不裁切；`sample-visual` 额外锁定样品`.directEditor`高度与冻结原型一致（正文排版未变）。原功能断言（折叠、文件数、Data/Claim 语义、附件、冲突、导航、设置真实数据）全部保留，未放宽。
- 新增 `density.spec.ts` 2项：校验 `.sidebar`168px、`.topbar`48px、品牌/导航13px、侧栏动作12px、topbar 11px、主按钮12px、工具条按钮12px、表格正文12px、表头/token/属性≥10px、miniProps≥10px、侧栏标签单行、按钮不裁切；以及样品一级15px/二级13px保持。
- 命令与结果：`pnpm typecheck` 4包通过；`pnpm test` = core6 + web14 + MCP1 + server51（真实S3 2项按设计跳过），共72通过；`pnpm build` 通过；`pnpm exec playwright test` 30项全部通过（原28项迁移后+新增2项 density）。
- 视口矩阵：在 1600×900、1440×1000、1280×800、980×1000、640×1000 逐页复查无页面级横向溢出；640 下侧栏/顶栏折叠行为与 980 断点未变；窄屏仅允许 `.tableWrap` 内部横向滚动。1600×900 截图覆盖样品表格、样品编辑器、描述型Data、FTIR Data、分析、论点、资源列表/详情、设置弹窗（见各测试 `test-results/**/actual-1600x900.png`）。
- 已知告警：Vite React 插件弃用提示与约731KB单包告警仍存在，未隐藏。
- 运行环境：测试端口14317与临时目录。发现上一上下文遗留的 14317 测试服务（工作目录为 `/private/tmp/scientific-workbench-live.aeI1NQ` 临时工作区）占端口，已停止该临时测试进程；未访问或修改 `~/ScientificWorkbench`、旧默认4317服务或用户数据。
- 人工验收仍待：真实 macOS 中文输入法选字、实际旧工作区转换、极端长内容/非默认空态巡检（与本次可读性无关的既有待验收项继续有效）。

### 2026-09-18 OpenCode 外部 Agent Runtime 集成

- 任务：`/Users/kong/Downloads/SCIENTIFIC_WORKBENCH_OPENCODE_CODING_PLAN_FINAL.md`。范围：`agent-run` Job、OpenCode V2 Adapter、AgentRunService、Settings→OpenCode、全局 Task Stack、Jobs 历史 Session 跳转。未新增领域对象，未改 `operations.ts`/`apps/mcp`/冻结原型。
- 版本判定：本机 opencode CLI 1.18.31 二进制包含 V2 路由（`/api/session`、`/api/model`、`/api/mcp`、`/api/permission/request`、`/api/event`），确认 V2；依赖锁定 `@opencode/client@2.0.7`，仅 `apps/server/src/opencode.ts` 导入。
- `opencode.test.ts` 12项：loopback URL 校验、目录重叠/symlink 校验、凭据 0600 与解析、Basic Auth 覆盖全部请求、model normalize（含 `supportsImage` true/false/unknown）、session/prompt/abort、permission `once`、question、事件 normalize、Session 深链、不可达/认证错误码、执行目录 0700、MCP operations 无 agent 入口、完整备份排除 `private/` 与 opencode 凭据。
- `agent-runs.test.ts` 15项：完整生命周期（busy→idle+对应本次 `promptMessageId` 的 assistant→succeeded→resultText）、`retry` 保持 running、permission ask→attention→allow once、auto-allow 仅 `once` 且不发 `always`、未知 Session 不批准、child 归属 root、question 不被自动回答、事件丢失由 list/reconcile 恢复、unreachable 保持 running、Session missing 才 failed、cancel abort 且不删 Session、queued 无 Session 恢复为 failed 且不 replay、Job payload 不含 prompt/密码/Authorization、dismiss 后保留 Job 历史、事件连接状态。
- `test/e2e/opencode.spec.ts` 10项（Fake OpenCode V2 HTTP 服务 + 临时工作区 + 独立端口14317）：Settings→OpenCode 连接/模型/权限/MCP 与保存测试、密码不回显、running 黑色 30×30 无动画、permission 黄色→hover 文案→click once→恢复黑、auto-allow 不变黄且无 `always`、question 黄色且 click 不回复、完成条幅 5 秒后消失、failed 橙红 >5 秒且 dismiss 后 Job 仍 failed、长按 450ms 打开正确 Session 深链、多任务最新在上且完成后补位、任务历史 OpenCode 名称且无 Retry。
- 命令与结果：`pnpm typecheck` 4包通过；`pnpm build` 通过；`pnpm test` = core6 + web14 + MCP1 + server78（含新增 opencode 12 + agent-runs 15；真实S3 2项按设计跳过），共99通过；`pnpm exec playwright test` 40项通过（原30 + 新增 opencode 10）。
- 安全：全仓搜索确认密码只存 `private/opencode-<id>.json`（0600），不进入 settings/SQLite/Job/API/日志/备份；`operations.ts` 与 MCP 无 `agent_run`/`opencode`；业务科研页面未增加 AI 按钮。冻结原型哈希仍为 `fe2c41e76c2de262c6520fc55d1eed46e8e3679e4486d4be0e0198da32a0f1bb`。
- 未访问 `~/ScientificWorkbench`，未修改真实 OpenCode 全局配置，未调用真实模型；自动测试只使用 Fake OpenCode。真实 OpenCode 端到端人工验证与业务页面 AI 入口仍未实现，完整首版未完成。

### 2026-09-18 OpenCode 异步运行与真实验收修订

- 任务：《Scientific Workbench × OpenCode 下一步修订与真实验收计划》，仅修可靠性。
- 环境与契约实测：`opencode 1.18.31` 的新 `/api/session/:id/prompt` 需要 `{prompt:{text}}`，与 `@opencode/client@2.0.7` 扁平 `{text}` 不一致，且两者都没有 `promptAsync`。真实异步入口是 legacy `POST /session/:id/prompt_async`（实测 204，约 10ms）。据此在 `apps/server/src/opencode.ts` 内实现 `detectOpenCodeFlavor()`（`/api/info`→V2，`/global/health`→V1）与 `LegacyOpenCodeAdapter`，业务层只看到 `OpenCodeAdapter`。
- `prompt_async`/同步守卫：`LegacyOpenCodeAdapter.submitPrompt` 使用 `/prompt_async` 并发送 `msg_` 持久 id；`opencode.test.ts` 新增 5 项 legacy 测试（flavor 检测、health/models/image 能力、prompt_async 且 syncPromptCalls=0、消息升序、permission `{response:"once"}`、question、深链、工厂选择）。E2E Fake 改为真实 V1 契约并记录 `asyncPromptCalls`/`syncPromptCalls`，阻塞 `POST /session/:id/message` 返回 500。
- 非阻塞回归：E2E `POST /agent-runs returns while the OpenCode agent is still busy` 断言 HTTP `202`、耗时 <3s、Agent 仍 busy、`asyncPromptCalls===1`、`syncPromptCalls===0`。
- Terminal notice 恢复：TaskStack 完成条幅改由 `state.notices` 驱动，`seenNoticeIds` 防重播，5 秒后离场并 dismiss；E2E `completion notice survives a page refresh within its TTL` 通过（真实浏览器冒烟同样通过）。
- 连接锁定：Server 在存在 `queued/running` agent-run 时对 `baseUrl/username/password/executionDir` 变更返回 `409 OPENCODE_CONFIG_IN_USE`；`permissionMode/textModel/visionModel` 允许；`GET /integrations/opencode` 返回 `connectionLocked` 且 Settings 禁用连接输入。E2E `running agent locks connection identity but allows defaults` 通过。
- 自动回归结果：`pnpm typecheck` 通过；`pnpm build` 通过；`pnpm test` = core6 + web14 + MCP1 + server83（真实S3 2项按设计跳过），共104通过；`pnpm exec playwright test` 44项通过（opencode 14项）。
- 真实隔离冒烟（`XDG_*` 与 `WORKBENCH_DATA_DIR` 均为临时目录，独立端口 14318/45997，未访问 `~/ScientificWorkbench`，未改用户 OpenCode 配置，未用 4317）：真实 1.18.31 V1；连接/版本、7 个模型、MCP 已连接；`POST /agent-runs` 148ms 返回 202；黑色方块立即出现；真实 completion 文本；深链返回 OpenCode Web HTML；运行中改 baseUrl 409、改 permissionMode 200；浏览器刷新条幅恢复并在 5 秒消失；Server 重启后 running 立即恢复并最终 succeeded（约 1246 字）；OpenCode 经 scientific-workbench MCP 返回临时 Sample 标题 `Smoke Sample`。未触发项：真机 permission（默认策略放行工作目录写）与真实 OpenCode 临时不可达，均标记 NOT MANUALLY VERIFIED。
- 安全：密码仍只在 `private/opencode-<id>.json`（0600）；`operations.ts`/MCP 无 agent 入口；`prototype/reference.html` 哈希未变。完整首版未完成。

### 2026-09-18 OpenCode 基础层封板（directory routing / stale status）

- L1：`LegacyOpenCodeAdapter` 统一附带 `x-opencode-directory=<executionDir>`（`request` 与 `/event` SSE 共用同一 header 集合）；`createSession` body 只传 `title`。V2 路径不变。
- L2：`getSessionStatuses()` V1/V2 均改为权威快照重建（`clear`+`set`，不 merge 事件缓存）；`retry` 仍为 running。
- Fake：E2E `fake-opencode.ts` 与单测 `FakeV1` 记录 `requestDirectories`、以 header 决定 `session.directory`、忽略 `body.directory`；保留 idle 不入 status 的 active-set 语义。
- 新增测试：`routes instance requests to executionDir and ignores a body directory`、`treats /session/status as an authoritative snapshot without stale busy`、`does not keep stale busy sessions in the V2 active snapshot`、`recovers completion through polling after the idle event is lost`（agent-runs）、E2E `legacy requests route to executionDir and not the server cwd`、`polling recovers completion when the idle event is lost`。
- 回归：`pnpm typecheck`、`pnpm build` 通过；`pnpm test` = core6 + web14 + MCP1 + server87（真实S3 2项跳过），共108通过；`pnpm exec playwright test` 46项通过。
- 真实三目录 smoke（`/tmp/swb-opencode-final-smoke/{workbench,agent,server-cwd}`，隔离 XDG，端口14319/45996，未访问 `~/ScientificWorkbench`、未改用户 OpenCode 配置、未用 4317）：真实 1.18.31；POST 0.5s 返回 running；`GET /session/:id` 的 `directory=/private/tmp/swb-opencode-final-smoke/agent`；`cwd-smoke.txt` 只在 agent 目录，server-cwd 与 workbench 目录无该文件；Job succeeded。
- 未人工验证保留：真实 Permission、真实 OpenCode 临时不可达、真实 V2 Server。冻结原型哈希未变；`operations.ts`/MCP 无 Agent 入口；Workbench dataDir 未被 Agent shell/file tool 直接访问。

### 2026-09-21 通宵计划：Agent Knowledge Layer、Deterministic Import、Vision Spike

- 计划：`docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_OVERNIGHT_PLAN.md`。基线 HEAD `310551d`，Node v22.22.3 / pnpm 10.14.0；开工时工作树仅新增计划文件。基线记录：typecheck/build PASS，`pnpm test` = core6 / web14 / mcp1 / server87（真实 S3 2 项跳过）。
- Phase A（PASS，提交 `c9842cd`）：
  - `document_save` 正式声明 `bindings`（`packages/core/src/document-contract.ts`）；`onRoute` 按 operation 声明挂载 body schema，旧操作保持宽松；`sanitizeDocumentBindings` 拒绝越界位置、忽略不存在区块/缺失对象/伪造意图，空数组清空 references、省略保留。
  - `docs/agent/guide.md` + `manifest.json` + 五组协议；`packages/core/src/agent-knowledge.ts` 生成/校验（重复 ID、缺文件、非法路径、符号链接逃逸、循环依赖、非法版本、坏链接、未知操作引用、UTF-8/LF、内容 SHA-256、重复构建字节一致）；`scripts/build-agent-knowledge.ts`（`--check`）生成被 gitignore 的 `apps/server/src/generated/agent-knowledge.ts`；root/server 脚本显式先执行幂等生成。
  - `knowledge_index`/`knowledge_read` 操作；REST `GET /knowledge`、`GET /knowledge/:id`（保留 auth）；MCP `workbench://knowledge`、`workbench://knowledge/{id}`、`workbench://syntax` 改由 `protocol-sample-document` 承接。
  - 证据：`pnpm typecheck` PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp2 / server94（S3 2 跳过）；`pnpm agent:knowledge:check` PASS（bundleHash `2a7a070120736d62b378b44ccc10148ab9da9dfef6bfafd1c8462ff7068b0d0e`）；`pnpm api:spec` 更新；`git diff --check` PASS。
- Phase B1（PASS，提交 `099b40f`）：人工 draft 五 Sample fixture 通过（5 Sample 共享 1 个 source Data、1 张原图、1 个显式新过程对象、现有材料/设备复用、About=5、每 head 绑定同一 Data、真实 parser PropertyValue、最小 receipt）。prepare 图片来源/数量/大小/哈希校验与幂等；draft/commit CAS + fingerprint；`document_bind_data` 独立可用且不改 About；cancel/retry 资格；journal/file/index 三阶段故障恢复与 HTTP `503 RECOVERY_REQUIRED`；backup 递归含 `registry/imports` 且恢复后无 jobs 缓存仍返回原 receipt；committed registry 无 draft/正文/属性副本。
  - 证据：`pnpm typecheck` PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server106（S3 2 跳过）；`pnpm exec playwright test` 46 passed；`pnpm agent:knowledge:check` PASS；`git diff --check` PASS。
- Vision Spike（V1/V2 NOT VERIFIED，提交见 Spike checkpoint）：
  - 新增 `scripts/spike-opencode-vision.mts`：默认拒绝真实调用，仅 `SWB_VISION_SPIKE=1` + 显式 `SWB_SPIKE_OPENCODE_URL` 才运行；创建隔离 temp dataDir/executionDir/独立端口，验证目录分离，图片答案仅在像素；不读取/修改用户全局配置，不输出二进制/base64/token/路径。
  - 实际执行：无 opt-in 时 exit 1 且记录保护生效；opt-in 但无隔离端点时 exit 0，结论 `NOT VERIFIED`，原因“未提供隔离的真实 OpenCode 端点”。因此未取得真实图片 transport、restricted profile allow/deny 或无泄漏证据。
  - 结论：目标 flavor AI 导入 **BLOCKED**。未启用任何占位入口（B2 未实现，产品内不存在可开启路径）；普通 V1 文本 runtime 与 A/B1 未受影响、未回滚。
- 安全/隔离：未访问 `~/ScientificWorkbench`；未改用户 OpenCode 配置；未使用 4317 旧服务；未修改冻结原型 `prototype/reference.html`（哈希仍 `fe2c41e…f1bb`）；测试全部使用 mkdtemp 临时目录与独立端口。

### 2026-09-21 审核问题修复（F01–F08）

- 计划：`docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_REVIEW_FIX_PLAN.md`。基线 HEAD `abe00d2`，Node v22.22.3 / pnpm 10.14.0；开工时工作树仅新增该计划文件。
- **修订此前证据**：2026-09-21 上游记录的 Phase B1 “PASS” 证据不足。上一轮 44 项通过的断言建立在“第一个 `[数据]` 区块就是来源”“prepare 可以返回完整 draft”“12 字节魔数即有效图片”等错误行为上，本轮已用修复前代码实际复现问题。历史记录保留，不重写为“当时已经覆盖”。
- R0（先复现，再修）：临时探针 `r0-prefix-probe.test.ts`（已删除）在修复前代码上运行，7 项全部失败且对应 F02/F03/F04/F05/F06/F07/F08：`[数据] 实测温度` 的子行 `温度为37度` 在提交后被覆写丢失；prepare 返回 `schemaVersion/samples/...` 完整 draft；`[水]｜添加量：待确认` 进入 `property_values`（`['待确认']`）；positions-only mapping 在正式 Data 上没有任何组件；12 字节伪 JPEG 被 `verifyImageAttachment` 接受；`receipt.sourceDataVersion=1` 而提交后 Data.version=2；已提交后换 `attemptId` 仍返回 success。
- R0 HTTP：`sample-import-http.test.ts` 在修复前代码上运行，3/4 失败：prepare 响应含 draft；HTTP 层不拒绝待确认属性；换 `attemptId` 的提交返回 200 原 receipt（应为 409）。修复后 4/4 通过。
- F02 显式来源身份：`SampleImportCandidate.sourceBlockId` 为唯一来源定位字段；`resolveSourceDataBlock` 只用 `ensureBlockIds` + 真实 `parseBody` 判定，删除 import helper 里的 Data 正则。未指定且无 `[数据]` 时后端追加专用 placeholder 并只按该 ID 绑定；已存在 `[数据]` 却未指定、两个 `[数据]` 区块、错误 ID、非空未知子树全部拒绝并保留完整 draft。
- F03 prepare 最小化：prepare 只返回小型确认（无 draft/normalized），路由不再走通用 `Idempotency-Key` 响应缓存；`purgeLegacyPrepareCache` 在 journal 恢复与索引重建后、业务 ready 前按 `POST:/api/v1/sample-imports:` 命名空间清理旧缓存（无匹配不写文件、损坏 JSON 抛错、其他缓存保留）。HTTP 用新 Idempotency-Key 重复 prepare 后，`registry/imports`、`jobs/`、`data/` 均无正文哨兵。
- F04 不确定值：全批预检查用真实 `parseBody` 检查即将提取的 `valueText`，命中「待确认/无法辨认/无法识别/未确认」即拒绝整批且零实体写入；改写为普通观察后可提交，该文字留在 Sample 正文但不产生 `PropertyValue`；critical ambiguity `resolved=true` 但无 `resolution` 也被拒绝。
- F05/F08 provenance 与版本：新增每 import 一个 `role: import-provenance` 文本组件，provenance 为 `swb.import-provenance/1` 版本化映射（最终 sampleId / raw componentId / page / positions），只存 ID 与位置；删除 `model: "sample-import"` 虚构身份。提交顺序改为「先一次 updateData → 再按更新后版本绑定每个来源区块 → 再 finalize」，因此 `receipt.sourceDataVersion`、`Data.version` 与每个 Sample 镜像 `baseVersion` 三者一致；componentId 与 page 不一致会拒绝。
- F06 图片解码：新增依赖 `sharp@0.35.4`（仅 `apps/server`；core 仍只做轻量魔数识别）。`verifyImageAttachment` 现在完整解码像素、带显式像素预算（`SAMPLE_IMPORT_MAX_PIXELS = 50_000_000`）、拒绝符号链接、以实际字节数计总量，并在同步事务内用文件身份 + 登记哈希复核「验证后被替换」。旧夹具（1×1 假 PNG、魔数拼接 JPEG/WebP）全部换成真实可解码 16×16 图，损坏夹具由有效图截断生成。
- F07 精确 replay：新增 `submissionHash`（请求身份 canonical hash，排除 Idempotency-Key 与传输层）与 `replayProofVersion`；已提交记录只按该 hash 返回原 receipt，`attemptId/draftHash/draftVersion/sourceDataVersion/expectedVersion` 任一变化返回 409，实体事后编辑不改变原 receipt，缺 proof 的旧记录 POST 返回 409 并提示 GET 对账。
- 证据命令（G1）：`vitest run` sample-import/sample-import-regression/sample-import-http/document-bind-data/backup/file-rebuild/file-repository/data-sync/data-identity/bindings = 60 passed；`pnpm agent:knowledge:check` PASS（6 项，bundleHash `2a7a0701…8b0d0e`）；`pnpm api:spec` 已更新 `openapi.json`；`pnpm typecheck` 4 包 PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server152（真实 S3 2 项按设计跳过）；`pnpm exec playwright test` 46 passed；`git diff --check` PASS。
- G1 人工核对（临时 workspace，未使用用户目录）：committed record 仅含身份/状态/contract/receipt/`replayProofVersion`/`submissionHash`，无 draft；`jobs/idempotency.json` 根本不存在；来源 Data v2 的组件为 raw file（human）+ `import-provenance`（external，derivedFrom raw）+ 转录（external），provenance 记录 5 个 sampleId 与各自 `行1-3…行13-15`；Sample 正文保留全部科研文本并追加一个 `[数据] 实验记录 …` placeholder，head 绑定 `baseVersion=2` 等于 receipt 与 Data 版本，6 条 references 全部 bound。
- F01 Spike：见 `docs/OPENCODE_INTEGRATION.md` 的 2026-09-21 段。harness 重写为七项合取，`vision-spike.test.ts` 18 项负向矩阵通过；真实 V1/V2 仍 NOT VERIFIED（无隔离真实端点/凭据，未发出任何真实调用），B2 仍未实现。
- 安全/隔离：未访问 `~/ScientificWorkbench`；未改用户 OpenCode 全局配置；未使用 4317；未修改冻结原型 `prototype/reference.html`；测试只用 mkdtemp 临时目录与随机空闲端口，e2e 用 14317 且 `reuseExistingServer:false`。
- 未完成/未验证：真实 Vision 与 restricted profile（NOT VERIFIED）、Phase B2（BLOCKED）、真实 macOS 中文输入法、实际旧工作区 DOC-002 转换核对、其余页面人工视觉复核。完整首版仍未完成。

### 2026-09-21 第二轮审核问题最小修补（R1–R5）

- 计划：`/Users/kong/ZanderProject/工作台` 第二轮审核问题最小修补（R1–R5）。基线 HEAD `1e3d5dc`，Node v22.22.3 / pnpm 10.14.0；开工时工作树干净。
- **修订上一轮证据**：
  - 上一轮的图片替换测试只覆盖「验证完成后替换」，没有覆盖**解码期间**替换；实现把文件身份读在 `await decode` 之后，因此同长度覆盖会被接受。
  - 上一轮七项合取只保证「不是完全噪音」，各项证据并不充分：`correlatedImageAnswer` 只要**任意新的** assistant 消息文本里出现该数字就 PASS；`restrictedAllow` 只看**全部 assistant 文本拼接**是否含 marker；`restrictedDeny` 只要没看到哨兵就 PASS；`noSensitiveWorkbenchLeakage` 只扫描 report 自身。原先「无关消息不能导致 PASS」的说法已被本轮反例否定。
- R0（先复现，再修，全部确定性、不依赖 sleep）：
  - R1-a：调用 `prepareSampleImport` 后**在同一个同步回合内**用同长度无效内容覆盖源文件（此时解码尚未完成）→ 旧实现返回 `status: "prepared"` 并创建 source Data。
  - R1-b：`verifyImageAttachment` 后用同长度不同内容覆盖再调用 `assertVerifiedImageUnchanged` → 旧实现不抛错（只比较登记 hash/size/mtime，mtime 毫秒粒度内相同即放过）。
  - R3：提交后出现一条**不相关**的 assistant 消息 `Unrelated metadata: 3 4 5 6 7 8` → 旧实现 `correlatedImageAnswer: PASS`。
  - R4-allow：marker 只存在于 session 创建时预置的旧消息 → 旧实现 `restrictedAllow: PASS`。
  - R4-deny：deny 探针无新回复、无工具调用、无待处理权限 → 旧实现 `restrictedDeny: PASS`。
  - R5：report 自身干净、未采集任何 Job/日志产物 → 旧实现 `noSensitiveWorkbenchLeakage: PASS`。
  - R2：`SWB_VISION_SPIKE=1 SWB_SPIKE_OPENCODE_URL=<本地假端点>` 运行 CLI → `Cannot find package 'sharp' imported from scripts/spike-opencode-vision.mts`，**零请求**到达假端点。
  - 临时探针 `r0-prefix-probe` / `r0-spike-probe` 已在修复后删除，反例全部固化进正式测试。
- R1 修复（`apps/server/src/sample-import.ts`、`store.ts`）：字节、sha256 与文件身份改为**同一个 file descriptor** 一次读出（`readImageFile`）；解码结束后按路径**重新读取并重新哈希**，与已验证摘要不一致即拒绝；提交时 `assertVerifiedImageUnchanged` 同样**重新读取并重新哈希当前文件内容**（不再依赖登记 hash/size/mtime），并保留完整解码、MIME、登记哈希、大小限制、像素预算与符号链接拒绝。异步解码仍在同步 Store 事务之外，事务内无 `await`。测试注入只在 `verifyImageAttachment` 的最窄边界（`StoreOptions.imageVerificationPhase`，仅暂停、不能跳过）。
- R2 修复：CLI 不再自行 `import("sharp")`，改用 server 模块导出的 `countRegionsInPng`；`sharp` 仍只属于 server，未改依赖版本，未在根目录重复安装。
- R3 修复（`apps/server/src/vision-spike.ts`、`opencode.ts`）：`NormalizedMessage` 增加可选 `parentId`/`tools`（来自 runtime 原始响应的既有字段，V1 `info.parentID` 与 `part.type === "tool"`）；图片判定只接受**本次提交请求关联**、`completed` 已置位、且文本严格为**单个整数**的最终回复；旧的、其他请求的、其他 session 的消息、prompt 回显、未完成片段一律不采信，同一消息在流式更新后重新检查。多张图片各用自己的 messageId，已用于回答的消息不会被第二张借用。
- R4 修复：allow 必须同时具备「请求关联的调用证据 + 调用声明内允许工具 + 调用成功 + 返回内容与受控读取一致」，并拒绝 probe 期间执行声明外工具；未声明允许工具名单、无工具证据或无可核对返回内容时保持 NOT VERIFIED。deny 必须对 `shell/file-read/file-write/subagent/unrelated-mcp/network/generic-scientific-write` **每个必需范围**拿到策略拒绝证据或可观察副作用检查，缺任一范围、只有模型自述、或出现待处理权限都不 PASS；哨兵出现或禁止副作用发生则 FAIL。隔离检查失败后**立即停止**后续图片/allow/deny 提交（测试断言 `asyncPromptCalls === 0`）。
- R5 修复：泄漏检查拆成「report 自身脱敏」与「Workbench 产物」两段；未提供产物采集时结论为 NOT VERIFIED 并列出未检查范围；采集失败或为空同样 NOT VERIFIED；发现泄漏只输出类别与产物标签，不回显敏感原文。CLI 支持 `SWB_SPIKE_ARTIFACT_DIR` 读取本次导出的 Job/日志产物。
- CLI 集成测试：`apps/server/src/vision-spike-cli.test.ts` 5 项，用子进程运行真实入口并显式清理/覆盖全部 `SWB_SPIKE_*`（不继承用户端点与凭据）：无 opt-in 零请求；有 opt-in 无 URL 时 NOT VERIFIED 且零请求；本地假端点确实收到 `/global/health`、`/config/providers` 与 `asyncPromptCalls > 0` 且输出无 `sharp` 解析错误；端点不可达时结论不是 PASS 且原因明确；成功与失败路径都清理临时目录；仅 import 模块时不执行探针、零请求。
- 本轮证据：`pnpm agent:knowledge:check` PASS（6 项，bundleHash `2a7a0701…8b0d0e`，与上轮一致）；`pnpm typecheck` 4 包 PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server169（真实 S3 2 项按设计跳过）；`pnpm exec playwright test` 46 passed；`git diff --check` PASS。局部 7 文件（sample-import ×3、vision-spike ×2、opencode、agent-runs）共 108 项通过。
- 未变：`apps/web`、`index.html`、冻结原型、科研实体文件 schema、`operations.ts`/OpenAPI、MCP 操作、依赖与 lockfile 均无变化；未新增产品 API/MCP 操作，未新增权限平台或日志平台。未访问 `~/ScientificWorkbench`，未改用户 OpenCode 全局配置，未使用 4317；测试只用 mkdtemp 与随机空闲端口。
- 仍未验证：真实 Vision V1/V2（NOT VERIFIED，缺隔离端点/凭据/工具调用轨迹/产物）、真实 restricted profile 全范围、Phase B2（BLOCKED）。完整首版仍未完成。

### 2026-09-21 AI 导入交付计划 S1：Spike 判定剩余问题

- 计划：`docs/plans/AI_RECORD_IMPORT_DELIVERY_PLAN.md` 第 6 节（S1）。基线 HEAD `69ad417`，Node v22.22.3 / pnpm 10.14.0。
- R0（先复现，再修）：把基线模块（`69ad417:apps/server/src/vision-spike.ts`）复制为临时 probe，用注入式 deps（无真实 HTTP、无真实模型）跑四个用例，基线全部给出错误结论：
  - (a) 图片答案正确但 assistant 消息**没有任何请求关联字段** → `correlatedImageAnswer=PASS`（按提交顺序猜测的降级路径）。
  - (b) 七个 deny 范围全部由**普通工具错误**（`status:"error"`、`ENOENT: no such file or directory`）作答 → `restrictedDeny=PASS`。
  - (c) allow 调用**没有成功状态字段**、只有 output → `restrictedAllow=PASS`。
  - (d) 产物扫描返回**与本次 run 无关的非空文件数组** → `noSensitiveWorkbenchLeakage=PASS`。
  - 临时 probe 已删除，四个反例固化进正式测试。
- S1.1 请求关联：删除 `correlatedReply` 的 positional 降级路径；只接受本次 session 中 `parentId === 提交的 prompt messageId` 且 `completed` 已置位的最终 assistant 回复；runtime 未提供该字段时如实返回 NOT VERIFIED（错误信息明确区分「未提供关联字段」与「只看到其他请求的回复」），不再按顺序或时间猜测。旧消息、其他请求、延迟回复、用户回显、未完成片段不能借用；同一消息流式更新后每轮重新检查。
- S1.2 权限证据：`isRefusal` 替换为三级分类 `refusalClass`——只有 `denied/rejected` 状态或明确的策略拒绝文本（permission denied / not allowed / forbidden / blocked by policy / 拒绝执行 / 无权限…）算 policy；`not found`、未知工具、连接失败、超时等归为 incidental，不再算拒绝。`DenyProbe.expects` 允许声明该能力对应的工具名与目标，仲裁只接受**指向本能力目标**的拒绝，避免同一回复里无关调用的拒绝冒充全部范围。allow 缺少显式成功状态时不再默认为成功（NOT VERIFIED）。禁止动作实际发生时 FAIL 优先于同一回复内的拒绝。`NormalizedMessage.tools` 增加有界的 `input` 文本，仅用于目标匹配、不进入报告。
- S1.3 产物与时序：产物证据改为 `ArtifactEvidence`（`source/runId/collectedAt/scope/items`）；harness 生成 `runId` 并写入报告，要求产物证据 `runId` 一致、`collectedAt` 属于本次 run、`scope` 覆盖 `job/log/notice`、items 非空且无截断项，否则 NOT VERIFIED。CLI 从产物**文件名前缀**推导覆盖范围（`<scope>__<name>`），超过采集上限时显式标记截断而不是静默只扫前 50 个。
- 测试替身去时序：`vision-spike.test.ts` 的 fake runtime 不再用 `setTimeout` 决定回复与 busy 状态，改为受控同步点（回复入队后等 harness 读过 `/session/status` 才释放），`drive()` 负责推进流程；只有图片提交会被 `/session/status` 跟随，因此该同步点仅对图片探针生效。新增用例覆盖「无关联字段的正确答案」「普通工具错误/未知工具/无关拒绝」「allow 缺少成功状态」「同一回复内泄漏优先于拒绝」「产物 runId/时间/范围/截断」「干净产物 → PASS」。
- 本轮证据：局部 7 文件 114 passed；`pnpm agent:knowledge:check` PASS（bundleHash `2a7a0701…8b0d0e` 未变）；`pnpm typecheck` 4 包 PASS；`pnpm build` PASS；`pnpm test` = core16 / web14 / mcp3 / server175（真实 S3 2 项按设计跳过）；`pnpm exec playwright test` 46 passed；`git diff --check` PASS。
- 未变：`apps/web`、冻结原型、科研文件 schema、`operations.ts`/OpenAPI、MCP 操作、依赖与 lockfile。
- 仍未验证：S2 真实 transport/profile（本轮**没有**取得真实端点与凭据，未发出任何真实调用）；Phase B2 未开始（依赖 S2 PASS）。

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

# Scientific Workbench：审核问题修复 Coding Plan

执行对象：DeepSeek V4.1 High。基线：本地 HEAD `abe00d2`，包含 Phase A `c9842cd`、Phase B1 `099b40f` 和 Spike `abe00d2`。

本文件是后续实施指令，不是修复完成报告。本次只编写计划，不修改实现、测试、运行配置或原有交接记录。

## 1. 任务目标与优先级

修复上一轮审核实际复现的 8 个问题，补齐反例测试，重新判定 B1 gate。保留 Phase A 和已有确定性基础设施，修复 Spike 的验证逻辑，但不实施 B2 产品集成。

本计划是 `docs/plans/AGENT_KNOWLEDGE_SAMPLE_IMPORT_OVERNIGHT_PLAN.md` 的定向修复补充；执行发生冲突时，以本计划对已发现问题的更严格要求为准，其他已批准架构不变。

| 编号 | 优先级 | 已复现问题 | 修复步骤 |
| --- | --- | --- | --- |
| F01 | P1 | Spike 对 session 元数据匹配数字就报 PASS，没有模型推理/profile 验证 | S1–S3 |
| F02 | P1 | 将任意首个 Data block 当来源，覆盖科研正文，其他 block 自动创建额外 Data | B1 |
| F03 | P1 | 重复 prepare 的通用幂等缓存长期保存完整 draft | B2 |
| F04 | P1 | “添加量：待确认”被提取成正式属性 | B3 |
| F05 | P1 | 无 transcription 的页行 mapping 被丢弃；多 Sample mapping 未关联最终 ID | B4 |
| F06 | P2 | 魔数校验接受不可解码的截断图片，JPEG/WebP 测试是假图片 | B5 |
| F07 | P2 | committed replay 忽略 attempt/draftHash/version 变化 | B6 |
| F08 | P2 | 先 bind/finalize 后 updateData，receipt 和镜像版本落后正式 Data | B4 |

上轮独立审核实际重跑 core 16、server 25、MCP 3，共 44 项通过，以及 knowledge `--check`。这些通过不能覆盖上述反例，不得继续以原测试绿色证明 B1 完成。

## 2. 执行规则

1. 开工顺序：读 `AGENTS.md`、`HANDOFF.md`、`IMPLEMENTATION_PLAN.md`、`DESIGN_RULES.md`、`docs/PAGE_ACCEPTANCE.md`、`docs/DATA_PROTOCOL.md`、`docs/VERIFICATION.md`、原 overnight plan 和本文。
2. 本地代码为准。先核对 HEAD 和工作树；不覆盖接手时的未知修改，不用远端代码替代本地审查。
3. 连续执行复现、修复、测试和逻辑提交；正常步骤之间不请求人工批准。测试失败定位并修复，不删除测试、不弱化断言。
4. 不自动换模型，不派生子代理，不推送或创建 PR。
5. 不修改冻结原型、页面设计、用户 OpenCode 安装/全局配置。不启动默认 `~/ScientificWorkbench`。
6. 所有测试使用专属临时目录；HTTP/fake runtime 使用随机空闲端口。只停止、清理自己创建的进程和目录，不借用旧服务。
7. 复用现有 parser、bindings、serializer、Store.commit、FileRepository、Data components。不得建立第二事务、属性提取、Sample 或 provenance 数据库。
8. `operations.ts` 及引用 schema 是机器契约唯一来源。修复输入/输出结构时同步 REST/OpenAPI/MCP；Protocol/Skill 不复制参数 schema。
9. 无 `await` 进入 Store 的同步事务 callback。不为图片解码或 runtime 调用扩大数据库事务时长。
10. 不实施 B2 Skill、AI 新建菜单、Task Stack action 或完整 import Agent 生命周期。Spike 只允许验证所必需的窄 adapter/profile/test 接线。
11. 独立门槛：`B1 修复 PASS` 与 `Spike harness tests PASS` 都不代表真实 Vision PASS；真实条件不足保持 NOT VERIFIED。
12. 本轮实施更新 handoff/验证记录时明确修订此前 B1 PASS 的证据不足，保留历史记录，不伪造“旧测试当时已经覆盖”的叙述。

## 3. 当前代码落点

路径相对仓库根目录 `/Users/kong/ZanderProject/工作台`，行号仅供初始定位，修改后按符号查找。

| 文件 / 符号 | 需要注意的当前行为 |
| --- | --- |
| `apps/server/src/sample-import.ts::withSourceDataBlock` | 正则发现任意 Data marker 就不追加来源块，没有来源身份 |
| `store.ts::materializeSampleImport` | 取 parsed dataItems[0] 绑定来源，先 finalize 后更新源 Data |
| `store.ts::validateImportDraftSemantics` | 仅过滤 critical ambiguity，未阻止已知不确定属性值 |
| `store.ts::prepareSampleImport/importView` | 已存在 import 返回当前完整暂态 view，包括 draft |
| `main.ts` 的 POST `/sample-imports` | 外层通用 idempotent 缓存上述 view |
| `store.ts::idempotent` | 响应写入 `jobs/idempotency.json`，commit 不清理该副本 |
| `store.ts::commitSampleImport` | committed 分支只比 commitFingerprint，先于 attempt/CAS 检查返回 |
| `sample-import.ts::verifyImageAttachment` | 读 16 字节文件头、检查 MIME/hash，没有完整解码 |
| `packages/core/src/sample-import.ts` | draft schema、纯校验、hash/fingerprint/receipt 类型 |
| `scripts/spike-opencode-vision.mts` | POST `/session` 塞图片，以任意 response text 的数字匹配决定 PASS |
| `apps/server/src/opencode.ts` | 已有 flavor 检测、认证、directory header、真正 async 文本边界，必须复用 |
| `apps/server/src/sample-import.test.ts` | 9 项测试；JPEG/WebP 为魔数拼字节；五 Sample 测试未覆盖本次反例 |

## 4. 执行顺序与 checkpoint

```text
R0：把审核反例转成会失败的测试
  → B1：明确来源区块，禁止覆盖原文
  → B2：最小 prepare 响应与幂等缓存清理
  → B3：不确定属性阻止提交
  → B4：持久 provenance、先更新来源再绑定、receipt 版本一致
  → B5：真实图片解码验证
  → B6：精确 committed replay 与旧记录兼容
  → G1：B1 修复完整 gate，逻辑提交
  → S1/S2：修复 Spike transport、证据判定及负向测试
  → G2：harness 本地 gate，逻辑提交
  → S3：有隔离真实条件则实测；否则 NOT VERIFIED
  → 全回归、文档与最终交接
```

B1 不依赖 Spike。不要因为缺真实 endpoint 而停止前面的修复。真实 Spike 即使 PASS，也只形成后续 B2 的必要证据，本修复任务不自动扩大到 B2。

## 5. R0：固定审核反例

**目标**：先证明当前实现确实不满足要求，避免只改文案或添加恒通过测试。

**复用/文件**：现有 `sample-import.test.ts`、`document-bind-data.test.ts`、`backup.test.ts`、MCP `workflow.test.ts`；参考其 mkdtemp/Store cleanup 和隔离 server 启动方式。新增普通测试文件可用 `sample-import-regression.test.ts`、`sample-import-http.test.ts`、`vision-spike.test.ts`。

至少添加以下失败用例：

1. draft 含 `- [数据] 实测温度` 及子行 `温度为37度`：不能在 commit 中静默丢失这段内容。含两个 Data blocks 也不能凭位置自动生成或绑定未知实体。
2. save draft 含唯一哨兵正文 → 使用新 Idempotency-Key 对同 importId prepare → commit → 搜索该临时工作区的 registry/imports 和 jobs/idempotency：均不得有完整 draft/正文哨兵。
3. 合法 parser 子属性 `[水]｜添加量：待确认`，标 local ambiguity：commit 必须失败，Sample/新 Object/PropertyValue 数量不变；转换为普通观察后可以提交。
4. source mapping 只有 page/positions、无 transcription：commit 后仍可从正式来源 Data 找到该位置及对应最终 Sample ID。
5. 两个 Sample 各有不同位置、同一原图：提交后能精确区分；删除暂态 draft、重开/重建/备份恢复后仍成立。
6. 12 字节伪 JPEG、截断 PNG、无图像 payload 的 RIFF/WEBP 必须被拒绝；有效 JPEG/PNG/WebP 必须通过。
7. commit 成功后只改 attemptId、draftHash、draftVersion、sourceDataVersion 或 expectedVersion，沿用原 fingerprint：必须 conflict，不能回原 success。
8. commit 后 source Data.version、每个 Sample 镜像 baseVersion、receipt 的提交后来源版本一致；原请求重试仍成功。
9. fake runtime 的 `/session` 仅返回 `{"id":"metadata-only","numbers":[3,4,5,6,7,8]}`，没有任何 prompt/message/profile 支持：harness 绝不能 PASS。

**门槛**：记录失败断言对应 F01–F08；现有绿色测试保持，不能把错误行为改成测试预期。失败测试在修复后与实现一起提交，不单独提交破坏正常主线的 checkpoint。

## 6. B1：来源 Data block 必须有明确身份

**目标**：删除“第一个 Data block 就是来源”的假设；不覆写未知科研内容。

**修改文件**：core sample-import DTO/schema/validator；server sample-import helper、Store `validateImportDraftSemantics/materializeSampleImport`；对应测试、必要 API 文档。

**实施决定**：

1. 来源 block 使用最小暂态定位字段 `sourceBlockId?: string`，放在 candidate；这不是新 Sample 领域结构。字段存在时必须匹配真实 parser 识别的稳定 Data block ID。
2. 没有 sourceBlockId 且正文没有 Data block：由后端追加一个专用来源 placeholder，通过 `ensureBlockIds` 与真实 parser 获取 ID；后续仅按这个 ID 绑定。
3. 已有 Data block 但未明确 sourceBlockId：返回可行动 INVALID_INPUT，保留完整 draft；不要猜测、覆盖、自动删除或把它当普通文字吞掉。
4. 明确指定的来源 placeholder 必须为空子树，或为已经核实与来源一致的规范镜像；首次导入优先只接受空 placeholder。非空未知科研内容拒绝，不在绑定时偷偷丢弃。
5. 本次 draft 未定义其他 Data 的显式物化契约，因此其他 Data blocks 应在全批预检查中拒绝。错误提示指出区块，不能让 finalize 自动创建意外实体。不要借此扩展成任意 Data 批量导入功能。
6. 用既有 `parseBody`/`blockLines`/semantic marker 判断，移除 import helper 中独立的 Data 正则判断。
7. 预检查在任何 createObject/createSample 前完成；异常不写正式实体。来源 prepare 成果仍可保留。
8. 正常公共 `document_bind_data` 的用途不缩减，仍支持一般已有 Data 绑定和未来 @data；这里收紧的是 import 暂态输入。

**测试**：无 marker、明确空 placeholder、错误 block ID、重复 marker ID、非空未知子树、多个 Data blocks。成功只有一个 shared source Data；失败原 draft 字节仍可取得，零部分 Sample/Object。

**验收 gate**：F02 反例通过，现有 document-bind-data/data-identity/data-sync 测试不回归；无新增 parser/serializer。

## 7. B2：prepare 最小化和幂等缓存

**目标**：任何请求路径都不能把暂态科研正文复制进长期响应缓存。

**修改文件**：Store `prepareSampleImport/importView/idempotent` 周边窄 helper、main prepare 路由、core 相应 response 类型、HTTP/MCP与恢复测试。

**实施决定**：

1. prepare 一律返回小型确认：importId、status、sourceDataId、sourceFingerprint、必要 source IDs、attempt 身份和版本。不得调用会附带 draft/normalized bodies 的通用 importView。
2. 获取正文只能显式 `sample_import_get`；save_draft 也只返回版本/hash/fingerprint。
3. prepare 的持久幂等以 importId + source fingerprint 为准，移除该路由外层通用响应缓存包装。相同来源返回同一 import/source 身份，不同来源 conflict；不扩展成通用缓存系统重构。
4. 机器契约若仍接受通用 Idempotency-Key，说明 prepare 的业务幂等身份是 importId。不能让 header 重试制造第二 import 或返回过期 draft；不要改其他操作的幂等行为。
5. 旧版本可能已经留下缓存：增加限定范围的清理，仅识别 `POST:/api/v1/sample-imports:` 命名空间的缓存项，经现有 Store/FileRepository 事务移除。保留其他操作缓存，不删整个 jobs/idempotency.json。
6. 清理在已有 journal recover/rebuild 完成后、业务 ready 前执行；无匹配项不写。损坏 JSON 不吞错。不要扫描任意用户目录，测试和本次实施只处理临时工作区。
7. 长期 receipt 来源仍是 registry/imports；清理这些旧 prepare 缓存不影响已提交对账。历史外部备份不声称已被自动清除，也不新增完整 draft archive。

**测试**：真实 HTTP 带相同/不同 Idempotency-Key 重复 prepare；draft后 prepare；commit后 prepare；检查所有相关长期文件无正文。预置含泄漏 draft 的旧缓存，重开后只清理目标命名空间，正常其他幂等响应保持。

**验收 gate**：F03 实际 HTTP 路径通过；无索引、backup/restore 不依赖 prepare 响应缓存。不得只在新 registry 中查 draft 字段就宣称最小化通过。

## 8. B3：不确定内容不得成为正式属性值

**目标**：落实批准的“局部待确认是普通文本，不能形成已确认结构化值”。

**修改文件**：server import semantic validation、必要共享校验、import regression tests；不修改全产品 parser 对普通文本值的既有语义。

**实施**：

1. 在全批预检查中调用真实 parseBody，逐项检查即将提取的 PropertyValue.valueText。
2. 对明确不确定占位词形成集中、可测试的规则，例如值为或包含标注“待确认”“无法辨认”“无法识别”“未确认”的缺失记录，拒绝本批 commit。先覆盖审核复现，不做猜数值的 NLP 补全。
3. 未解决 critical ambiguity 继续拒绝；resolved=true 的 critical 至少要有非空 resolution，不能仅翻一个布尔值忽略矛盾的待确认属性。
4. 不自动把待确认替换为 0、空值、默认单位，不移除语句后偷偷提交。返回 sampleKey/blockId 对应的可行动错误，完整 draft 保留。
5. 调用者把局部不确定内容明确调整为普通观察 bullet 后可提交；该文字保留在 Sample 正文，但不出现 PropertyValue。
6. 此校验只保证可识别不确定标记不进入结构化属性，不声称后端可以检测所有模型幻觉；未知数值真实性仍需未来 Skill/Question/来源验证。

**测试**：审核原例、全半角属性语法、确定数值正常通过、普通待确认观察保留、critical未解决、critical假解决但仍有占位属性、五 Sample 中一个非法导致全批零实体写入。

**验收 gate**：F04通过，原 parser/文档编辑行为不变，没有第二属性提取器。

## 9. B4：保留 provenance，统一来源更新和绑定版本

**目标**：成功删除 draft 前，将必要来源关系放进正式 Data；所有镜像绑定最终来源版本。

**修改文件**：Store materialize/semantic validation、core receipt 类型、server import helper、DATA_PROTOCOL、import/recovery/backup tests。

### 9.1 位置映射的正式落点

1. 每个 mapping 校验 attachmentId/page 与本次 source 一致；若有 componentId，必须等于对应真实 raw component ID，不忽略错误值。
2. 在分配全部 Sample IDs 后，构建最小 provenance entries：最终 sampleId、raw source componentId、page、positions。多 Sample 同页不靠数组顺序猜归属。
3. 位置存在而 transcription 不存在时，仍创建一个正式来源映射 text component，role 明确为 import-provenance，creator 为 external，derivedFrom 指向相关 raw components；其 content 可为简短来源说明，provenance string 保存版本化可解析 mapping。
4. transcription 存在时按原计划保存 derived text component，并在 provenance 记录对应 sampleId/sourceComponentId/page/positions。可将来源映射统一保存在一个 import-provenance component，转录组件只保留指向它/原图的必要引用，避免重复堆正文。
5. 固定采用一个每 import 的 mapping component 汇总位置关系；其中只存 IDs和位置，禁止保存 Sample属性/Process/Observation/完整 Markdown。没有位置映射时不凭空制造页行。
6. 这是现有 Data components 的使用，不新增 provenance 实体/表。raw组件、原图和既有来源元数据不被覆写。
7. B1人工fixture没有模型，不得继续把 `model: "sample-import"` 当实际模型身份；省略未知模型字段或明确非模型输入来源。未来 B2 才注入真实 model/knowledge 审计信息，不在本轮虚构。
8. Sample正文仍只承担科研记录和正式 Data block，不追加“来源第几页第几行”来补救结构化映射丢失。

### 9.2 固定 batch 顺序

同一现有同步 Store.commit 中，顺序改为：

```text
校验身份、CAS、fingerprint、所有候选和来源
→ 创建显式对象、全部 Sample 身份
→ 将 sampleKey 解析为正式 ID，构造 derived transcription/provenance
→ 一次 updateData 合并 About 和 components（校验输入 sourceDataVersion）
→ 取得更新后的 source Data/version
→ 保存每个 Sample正文/引用，绑定专用来源 block 到更新后的 Data
→ finalize 所有 Sample，要求 ready 和正式引用完整
→ 写最小 receipt/committed record并移除完整 draft
```

receipt 的 `sourceDataVersion` 表示本次提交完成后的正式来源版本；输入 sourceDataVersion 是校验用旧基线，两者不能混用。B6 的 replay proof 保存原请求身份hash，不拿 receipt的最终版本替代原请求。

若一次提交内部最后校验发现 source Data/version 又被意外变动，应失败定位原因，不能盲改 receipt。后续正常用户编辑可以提高版本，不追改历史 receipt。

**测试**：positions-only、多 Sample同页不同位置、转录与mapping共存、componentId错误、原图hash不变、commit后所有baseVersion=Data.version=receipt.sourceDataVersion；再次finalize不产生意外Data/属性变化；重开、无索引、备份恢复仍可解析映射；journal/file/index故障恢复后整批一致。

**验收 gate**：F05/F08通过，全部科研事实来自正式实体，最小registry不存mapping全文或正文副本。

## 10. B5：真实图片验证与有效测试夹具

**目标**：接受可正常解码的 JPEG/PNG/WebP，拒绝只有魔数或截断/损坏的输入。

**修改文件**：server image verification/helper、prepare入口、相关测试fixtures；必要时 server package/lockfile。core只保留类型/限制和轻量魔数识别，不引入Node图像解码依赖。

**实施步骤**：

1. 当前依赖只有开发用 pngjs，没有覆盖三格式的解码器。先确认本地依赖；如无合适库，选择一个支持三格式的成熟解码依赖，查其官方文档、锁定实际版本并验证当前Node/macOS构建，不自写JPEG/WebP解码器。
2. 必须完整解码像素或执行解码器提供的等效严格完整性校验，不能仅调用metadata/image-size后宣称图像有效。限制解码资源，拒绝超过明确像素/内存预算的图片；说明这是资源边界而非实验数据推断。
3. 不重编码或覆盖原始附件。解码只验证；仍核对真实文件大小、MIME、hash，保持10张/10MiB单张/30MiB合计原约束。
4. 异步解码放在prepare的同步事务外。若所选decoder是异步，使用prepare异步入口完成验证，随后调用私有同步persist步骤；所有调用点/测试显式await。不要把Promise传进Store.commit。
5. 解码结果由服务器内部构造，不接受客户端“verified=true”。进入同步事务时再次核对附件身份、hash/大小和来源指纹，防止校验到提交间源文件被替换。
6. 总大小用实际验证字节数，不只用可漂移的attachment metadata。复用已有Attachment受控路径，拒绝异常符号链接/路径越界，不提供用户输入filePath。
7. 替换当前JPEG/WebP魔数拼接fixtures为真正可解码且非敏感的小图；PNG也经decoder验证。损坏夹具由有效图片截断/破坏生成，不能把垃圾fixture标成real image。
8. 无法取得解码依赖或环境缺失时记录明确阻塞，不把验证降回magic-only并标B1 PASS。

**测试**：三格式有效图；12字节JPEG；截断PNG/JPEG/WebP；伪MIME；空文件；10张/单张/总量边界；像素资源边界；hash变化；验证失败零source Data/import创建；旧附件字节不变。

**验收 gate**：F06通过，HTTP与Store入口不能绕过验证，事务内无await。包变更只限必要解码依赖，不升级其他工具链/OpenCode。

## 11. B6：精确 committed replay

**目标**：只对原提交的同一请求返回原receipt；不同资格或内容版本不能沿用fingerprint冒充相同提交。

**修改文件**：core纯canonical hash辅助/必要类型；Store commit/record兼容读取；API文档和HTTP/recovery/backup测试。

**实施决定**：

1. 定义服务端 `submissionHash`，对已通过schema验证的原commit请求身份计算：importId、attemptId、expectedVersion、draftVersion、draftHash、输入sourceDataVersion、commitFingerprint；排除传输层Idempotency-Key。
2. 未提交分支仍必须重新计算科学输入commitFingerprint并执行所有CAS/eligibility；submissionHash不能替代这些校验，也不能由客户端直接声明可信。
3. 成功后在最小committed record保存submissionHash及版本标识即可。不保留完整请求/draft/对象绑定；hash是恢复/幂等必要信息，符合最小化原则。
4. committed replay首先按已存submissionHash核对，再返回原receipt；任何identity/hash/version字段改变都返回409。不能从当前已编辑的科学实体重新算，不能要求完整draft仍在。
5. 原提交attempt在成功后被标revoked不影响其完全相同请求取receipt；旧attempt或随机attempt不同则拒绝。区别“原成功提交对账”和“已撤销attempt重新执行”。
6. 正式实体后来正常编辑/改名不改变原receipt或submissionHash；相同请求仍返回原成功，不重复创建。

**旧记录兼容**：

- 为新record明确标识replay proof版本；读取旧`swb.import/2` committed record继续提供GET receipt，不生成新实体。
- 旧record可能已丢draftHash，无法可靠补造submissionHash。不得用客户端第一次请求反向补写“原始提交证明”。
- 对缺少可靠proof的旧committed POST，采用明确409兼容错误并提示使用GET对账；文档写明该旧数据限制。不能继续接受任意不同请求并伪装满足新门槛，也不能为此保留完整draft。
- 旧未提交draft按新规范重新validate/save以取得当前版本/hash；不能悄悄改变已有committed实体。所有兼容测试在临时目录完成，不执行用户数据迁移。

**测试**：完全相同HTTP重试；逐字段单独变化；header键变化但请求相同；cancel/retry旧attempt；commit成功后实体编辑；响应丢失；重启；无index；backup/restore无jobs缓存；旧record GET可读且POST限制明确。

**验收 gate**：F07通过，长期新增信息只有必要hash/版本，未恢复任何科研事实副本。

## 12. G1：B1 修复验收与提交

新增文件落盘后运行以下命令；新测试名按本文实际创建，不用不存在的命令冒充执行：

```sh
pnpm --filter @workbench/server exec vitest run src/sample-import.test.ts src/sample-import-regression.test.ts src/sample-import-http.test.ts src/document-bind-data.test.ts src/backup.test.ts src/file-rebuild.test.ts src/file-repository.test.ts src/data-sync.test.ts src/data-identity.test.ts src/bindings.test.ts
pnpm --filter @workbench/core test
pnpm --filter @workbench/mcp test
pnpm agent:knowledge:check
pnpm api:spec
pnpm typecheck
pnpm build
pnpm test
git diff --check
```

必须人工核对一次临时workspace的committed registry、jobs cache、正式Data components、Sample head：来源明确、无科研正文丢失、无draft副本、精细mapping可恢复、receipt版本准确。

HTTP测试必须验证真实输入schema和幂等header路径，不能仅测Store内部方法。五Sample fixture至少包含sample自身属性、现有材料/设备、一个明确新对象、观察、不同Sample的来源位置。

pre-durable全批失败与post-durable journal/file/index恢复都重跑；恢复后整批实体、映射、receipt一致。503 recovery barrier仍有效。通过后更新本轮证据，提交如 `Fix deterministic import integrity and replay guarantees`。

## 13. S1：修复 Spike 的 transport 与 fixture

**目标**：实际创建session、异步提交图片、取得真实assistant结果；不再把创建响应当模型回答。

**修改文件**：`scripts/spike-opencode-vision.mts`；必要的可测试helper；`apps/server/src/opencode.ts`最小受控实验接口；`apps/server/src/vision-spike.test.ts`。只有opencode边界能引用SDK。

**实施**：

1. 将脚本入口与可测试runner分开；被test import时不得自动联网/启动main。默认无opt-in时不得发出任何请求。
2. session创建只发送该flavor已确认的创建参数；图片进入对应session的实际异步prompt接口。V1沿已有prompt_async基础调查真实图片shape；V2独立调查，不能检测到V2后仍固定调用V1路径。
3. 所有请求经统一adapter认证/目录处理；不得再出现脚本裸fetch绕过Basic auth、directory header和安全错误处理。
4. 预分配message correlation，记录submit返回时间，随后通过现有SSE/poll/messages取得对应的最终assistant消息。忽略session metadata、用户prompt回显、无关旧消息、工具响应中的数字。
5. 图片答案严格解析最终assistant response，拒绝在任意response全文中搜索一个数字；必须同时有“调用了async prompt”和“拿到匹配correlation的最终assistant结果”的证据。
6. 修复随机方块fixture：当前红色区域相邻无空隙，可能看成一条连续红带。改成有白色间隔、可独立计数的形状或高对比随机token，答案不进文件名/prompt/metadata。
7. fixture自身有像素/连通区测试。仅凭一次猜中小范围数字不足以证明可靠看图，使用多个独立随机fixture，且每次答案都不能从文本获取。
8. 只记录sanitized shape、MIME/大小、状态/时间及断言，不输出图片/base64/凭据/完整request。evidence里的目录用匿名标签表示隔离关系，不打印scientific dataDir。
9. 实验图片shape未证实前保持实验标记，不能顺便开放生产vision分支。

**验收 gate**：仅创建session不能完成vision check；认证/目录始终传递；fixture答案明确；普通text runtime所有回归通过。

## 14. S2：PASS 必须是完整证据的合取

**目标**：harness本身阻止假通过，不让“不支持/未执行”混成PASS。

每个runtime flavor独立输出这些检查：

```text
isolation
runtimeIdentityAndModel
asyncSubmission
correlatedImageAnswer
restrictedAllow
restrictedDeny
noSensitiveWorkbenchLeakage
```

每项状态为PASS/FAIL/NOT VERIFIED并带去敏证据。只有全部PASS才可总PASS；任何明确失败总FAIL；未运行完或缺条件总NOT VERIFIED，不能由visionAnswer一个布尔值决定结论。

restricted allow/deny必须实际执行，不是从配置存在推断：

- 正向：knowledge读取、必要字典/当前import读取、人工测试draft保存/确定性commit、Question。
- 负向：shell、任意read/write/edit、本地路径attachment_upload、generic科学写入、subagent、无关MCP、任意网络工具。
- generic auto-allow打开时也不能覆盖import deny；使用非敏感临时哨兵和受控服务证明没有副作用。
- scope不匹配的import/source调用和Resource也拒绝。验证所需profile/MCP filter保持窄范围，不引入通用认证框架。
- 若真实flavor无法实施这些限制，明确FAIL/NOT VERIFIED，不回退无限制Agent。

**必须添加的fake负向矩阵**：

| fake行为 | 期望 |
| --- | --- |
| `/session` metadata含3–8全部数字，根本没有prompt接口 | 绝不PASS |
| prompt用户文本回显正确数字，但无assistant完成消息 | 绝不PASS |
| 无关旧assistant消息有正确答案 | 绝不PASS |
| 同步接口能回答，async未执行/返回前已经阻塞等完整结果 | async检查不通过 |
| 图片回答对，profile未验证 | 总NOT VERIFIED |
| 图片回答对，shell/file任意一项实际可执行 | 总FAIL |
| profile配置声明deny，但实际允许 | 总FAIL |
| 使用V2探测结果却调用V1路径 | 对应contract测试失败 |
| 最终消息来自其他session/message | 绝不PASS |
| 缺auth或executionDir | 请求断言失败 |
| request错误包含base64/token | 输出被去敏，无秘密泄漏 |
| 无opt-in/无endpoint/缺模型 | 无意外真实调用，准确NOT VERIFIED |

**验收 gate**：F01原复现变成明确负向测试；不能用这些fake测试声明真实Vision兼容。先完成本地harness gate再考虑真实调用。

## 15. S3：真实验证与阻塞规则

1. 只有合法可用的隔离真实endpoint和凭据存在时，显式 `SWB_VISION_SPIKE=1` 执行。不要把用户当前服务当隔离服务，不安装升级OpenCode，不修改全局配置。
2. harness必须确认实际session的executionDir等于专属Agent目录；只是创建两个temp目录和找一个未使用端口不算已验证runtime隔离。
3. 使用当前真实version/flavor/model记录证据，按S2逐项完成。每个flavor分别PASS/FAIL/NOT VERIFIED。
4. 没有条件时完成harness本地测试和文档，真实Spike继续NOT VERIFIED。不要谎称“只需设置URL就已经支持”，列出缺少的实测项目。
5. 真实正向fixture回答可用于验证脚本，但严禁输入真实敏感科研图片；不访问真实scientific dataDir。
6. 所有真实session/子进程超时有界；finally清理自己创建的资源。认证失败、请求失败、测试失败都执行清理，不清理用户服务。
7. 即使真实Spike PASS，本任务也不直接实现B2；交接明确其已满足的必要条件和后续原计划落点。

## 16. 最终回归和提交策略

在G1基础上加入：

```sh
pnpm --filter @workbench/server exec vitest run src/vision-spike.test.ts src/opencode.test.ts src/agent-runs.test.ts
pnpm agent:knowledge:check
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
git diff --check
git status --short
```

Playwright沿现有临时workspace、独立端口、reuseExistingServer=false配置；端口占用时换专属端口配置，不杀未知进程。已有46项是历史数量，本轮输出多少就记录多少；真实S3等跳过单列。

建议逻辑提交：

1. B1数据完整性、provenance、版本/幂等修复及通过的测试。
2. 真实图片验证和依赖/fixtures（也可在G1前单独形成自洽checkpoint）。
3. Spike transport/证据合取/假通过回归，真实状态准确。
4. 全回归和交接文档。

不得把未通过测试或未运行真实验证写成完成。提交只包含审查过的任务文件，不混入temp数据/图片/凭据/生成bundle。不push、不建PR。

## 17. 文档与交接要求

后续实施更新：HANDOFF、IMPLEMENTATION_PLAN、VERIFICATION、DATA_PROTOCOL、API_MCP、OPENCODE_INTEGRATION；结构变化同步OpenAPI。Phase A正文若受本次参数/语义调整影响，只更新相关引用，不展开第二轮知识架构设计。

交接逐项列出F01–F08：修复commit、测试名、实际结果、是否有兼容限制。特别记录：

- 旧committed record缺submission proof的GET/POST行为。
- 旧prepare缓存的限定清理范围及证据。
- 图片解码依赖/版本、资源限制、真实三格式fixture结果。
- positions-only、多Sample来源mapping、receipt最终版本、重建/恢复证据。
- Spike假服务误报PASS反例现已失败；真实flavor状态独立列出。
- 普通runtime/原型/用户工作区是否未变、测试端口/进程/临时目录清理情况。

最终完成条件：7项B1问题的反例全部修复、相应持久化与HTTP回归通过；Spike本地误报路径消除，真实兼容状态诚实；A保留、B2未越界启用；本轮证据和下一步可直接接续。

# 协议：对象与属性字典（protocol-objects-properties）

依赖：`protocol-common`、`guide`。

## 1. 对象与角色

ResearchObject 拥有稳定 `id`、`canonicalName`、`role`、`lifecycle`、可选别名、`identityText` 与 `recommendedPropertyIds`。

实际角色枚举：`sample`、`material`、`equipment`、`process`、`other`。

- Sample 可被搜索和引用，但不能通过引用菜单创建。
- 创建对象用 `object_create`，必须给出明确类别。不要用 `other` 兜底未知类别。
- 对象搜索 `object_search` 覆盖标准名、别名、废弃对象；精确 > 前缀 > 别名 > 包含 > 模糊。

## 2. 生命周期

- **Rename**（`object_update`）：只改标准名，引用仍指向同一 id；历史正文不重写。
- **Merge**（`object_merge`）：引用从旧 id 重定向到目标 id；旧对象标记 merged 并保存 redirectTo。解析时会沿 redirectTo 解析。
- **Deprecate**（`object_update` lifecycle=deprecated）：仍可搜索、可引用，但显著降权并标记。
- **永久删除**（`object_delete`）：仅在无任何 inbound 引用或引用已处理时允许；不得留下悬空引用。

遇到 merged/deprecated 对象时，用其 canonical 目标继续，不要按旧名字另建对象。

## 3. 显式复用或创建

- 身份明确时，显式选择已有对象 id。
- 只有来源或用户澄清支持、且角色可证时，才生成 new-object intent / `object_create`。
- 别名、模糊名称、类别不确定：用 Question 澄清，不要自动合并近义词，不要猜类别。
- 批量任务里同一个 `objectKey` 只创建一次；相同文本但身份不同不要擅自合并。

## 4. 属性字典

- 属性字典是共用定义：稳定 `id`、`canonicalName`、可选 `dimension`、`recommendedUnit`、别名、使用统计。
- Sample 上保存的是“对象—属性—文本值”的实例，字典只提供标准名与填写提示。
- 有效属性行按标准名精确匹配；没有匹配则创建新的属性定义（不弹窗、不推断维度/单位）。
- 别名参与模糊搜索；未选择结果时按正文精确匹配标准名，不通过别名静默绑定。
- 不自动近义词合并、不从值中推断单位、不做科学适用性校验。

## 5. 常用操作

`object_search`、`object_create`、`object_update`、`object_merge`、`object_delete`、`property_search`、`property_create`、`property_update`。参数以 MCP/OpenAPI 为准。

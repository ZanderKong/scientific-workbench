/** Shared, versioned public operation catalogue used by REST documentation and MCP. */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  additionalProperties?: boolean;
  description?: string;
}
export interface Operation {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  input: JsonSchema & {
    type: "object";
    properties: Record<string, JsonSchema>;
  };
  query?: string[];
}
const string: JsonSchema = { type: "string" },
  id: JsonSchema = { type: "string", minLength: 1 };
const strings: JsonSchema = { type: "array", items: string };
const version: JsonSchema = { type: "integer", minimum: 1 };
const paging = {
  limit: { type: "integer", minimum: 1, maximum: 200 } as JsonSchema,
  offset: { type: "integer", minimum: 0 } as JsonSchema,
};
function op(
  name: string,
  description: string,
  method: Operation["method"],
  path: string,
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
  query?: string[],
): Operation {
  return {
    name,
    description,
    method,
    path,
    input: {
      type: "object",
      properties: {
        ...properties,
        ...(method === "POST" ? { idempotencyKey: string } : {}),
      },
      required,
      additionalProperties: true,
    },
    query,
  };
}
const analysisLayout = {
  type: "object",
  additionalProperties: false,
  properties: {
    visibleSections: {
      type: "array",
      items: {
        type: "string",
        enum: ["context", "compare", "data", "artifacts", "body", "claims"],
      },
    },
    hiddenColumns: strings,
    columnOrder: strings,
  },
  required: ["visibleSections", "hiddenColumns", "columnOrder"],
};
const dataComponents: JsonSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id,
      kind: { type: "string", enum: ["file", "text"] },
      name: id,
      role: id,
      creator: { type: "string", enum: ["human", "external"] },
      provenance: string,
      createdAt: id,
      derivedFrom: strings,
      attachmentId: id,
      bodyLinked: {
        type: "boolean",
        description: "正文附件标记管理的组件引用；移除正文标记时解除该引用",
      },
      content: string,
    },
    required: [
      "id",
      "kind",
      "name",
      "role",
      "creator",
      "provenance",
      "createdAt",
      "derivedFrom",
    ],
    additionalProperties: false,
  },
};
export const operations: Operation[] = [
  op(
    "document_resolve_data_identity",
    "数据区块身份丢失后明确关联已有Data（加载当前内容）或新建，保留其他正文",
    "POST",
    "/documents/:id/blocks/:blockId/resolve-data",
    {
      id,
      blockId: id,
      dataId: id,
      createNew: { type: "boolean" },
      expectedVersion: version,
    },
    ["id", "blockId", "expectedVersion"],
  ),
  ...(["data", "analyses", "claims"] as const).map((plural) =>
    op(
      `${plural === "analyses" ? "analysis" : plural === "claims" ? "claim" : "data"}_reload_file`,
      "明确接纳外部文件修改，校验身份并更新内容版本",
      "POST",
      `/${plural}/:id/reload`,
      { id, expectedVersion: version },
      ["id", "expectedVersion"],
    ),
  ),
  op(
    "workspace_status",
    "读取目录、实体数量与待更新状态",
    "GET",
    "/workspace/status",
  ),
  op(
    "workspace_settings",
    "读取工作区公开设置，不返回凭据",
    "GET",
    "/workspace/settings",
  ),
  op("workspace_rebuild", "从业务文件重建索引", "POST", "/workspace/rebuild"),
  op(
    "sample_list",
    "分页列出样品属性和提取状态",
    "GET",
    "/samples",
    paging,
    [],
    ["limit", "offset"],
  ),
  op(
    "sample_get",
    "读取样品正文、属性和实际内容版本；latest=true先完成提取",
    "GET",
    "/samples/:id",
    { id, latest: { type: "boolean" } },
    ["id"],
    ["latest"],
  ),
  op("sample_create", "新建独立样品正文", "POST", "/samples", {
    code: string,
    title: string,
    body: string,
  }),
  op(
    "sample_update",
    "按版本修改样品编号或标题",
    "PUT",
    "/samples/:id",
    { id, code: string, title: string, expectedVersion: version },
    ["id", "expectedVersion"],
  ),
  op(
    "sample_copy",
    "复制操作模板，排除Data、附件和论点结果",
    "POST",
    "/samples/:id/copy",
    { id, code: string },
    ["id"],
  ),
  op(
    "sample_batch",
    "按模板逐行修改属性并批量创建独立样品",
    "POST",
    "/samples/batch",
    {
      templateId: id,
      expectedVersion: version,
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: { code: string, values: { type: "object" } },
          required: ["values"],
        },
      },
    },
    ["templateId", "expectedVersion", "rows"],
  ),
  op(
    "document_get",
    "读取已经保存的正文和隐藏文件头",
    "GET",
    "/documents/:id",
    { id, latest: { type: "boolean" } },
    ["id"],
    ["latest"],
  ),
  op(
    "document_save",
    "按版本保存正文；保存成功后仍可能待提取",
    "PUT",
    "/documents/:id",
    { id, body: string, expectedVersion: version },
    ["id", "body", "expectedVersion"],
  ),
  op(
    "document_finalize",
    "整篇提取已保存正文，重复调用更新原记录",
    "POST",
    "/documents/:id/finalize",
    { id },
    ["id"],
  ),
  op(
    "document_reload",
    "显式接纳磁盘修改；调用前保留自己的草稿",
    "POST",
    "/documents/:id/reload",
    { id },
    ["id"],
  ),
  op(
    "document_history",
    "只读正文历史，可复制，不回滚",
    "GET",
    "/documents/:id/snapshots",
    { id, ...paging },
    ["id"],
    ["limit", "offset"],
  ),
  op(
    "object_search",
    "搜索全局对象、别名和废弃对象",
    "GET",
    "/objects",
    { q: string, ...paging },
    [],
    ["q", "limit", "offset"],
  ),
  op(
    "object_create",
    "按明确类别创建对象，不猜测名称语义",
    "POST",
    "/objects",
    {
      canonicalName: id,
      role: {
        type: "string",
        enum: ["material", "equipment", "process", "other"],
      },
      aliases: strings,
      identityText: string,
      recommendedPropertyIds: strings,
    },
    ["canonicalName", "role"],
  ),
  op(
    "object_update",
    "按版本编辑标准名、手动别名和生命周期",
    "PUT",
    "/objects/:id",
    {
      id,
      canonicalName: string,
      aliases: strings,
      identityText: string,
      recommendedPropertyIds: strings,
      lifecycle: { type: "string", enum: ["active", "deprecated"] },
      expectedVersion: version,
    },
    ["id", "expectedVersion"],
  ),
  op(
    "object_merge",
    "显式合并对象，需要merge权限",
    "POST",
    "/objects/:id/merge",
    { id, targetId: id, expectedVersion: version, targetVersion: version },
    ["id", "targetId", "expectedVersion", "targetVersion"],
  ),
  op(
    "object_delete",
    "永久删除没有任何引用的对象，需要delete权限",
    "DELETE",
    "/objects/:id",
    { id, expectedVersion: version },
    ["id", "expectedVersion"],
    ["expectedVersion"],
  ),
  op(
    "property_search",
    "搜索共用属性字典",
    "GET",
    "/properties",
    { q: string, ...paging },
    [],
    ["q", "limit", "offset"],
  ),
  op(
    "property_create",
    "明确创建属性及可选单位、别名",
    "POST",
    "/properties",
    {
      canonicalName: id,
      aliases: strings,
      dimension: string,
      recommendedUnit: string,
    },
    ["canonicalName"],
  ),
  op(
    "property_update",
    "按版本编辑属性字典，不自动合并近义词",
    "PUT",
    "/properties/:id",
    {
      id,
      canonicalName: string,
      aliases: strings,
      dimension: string,
      recommendedUnit: string,
      expectedVersion: version,
    },
    ["id", "expectedVersion"],
  ),
  op(
    "data_list",
    "分页列出独立Data",
    "GET",
    "/data",
    paging,
    [],
    ["limit", "offset"],
  ),
  op(
    "data_get",
    "读取Data正文、About、组件、来源和版本",
    "GET",
    "/data/:id",
    { id },
    ["id"],
  ),
  op(
    "data_create",
    "创建Data，可About多个样品",
    "POST",
    "/data",
    {
      name: id,
      body: string,
      description: string,
      aboutSampleIds: strings,
      componentIds: strings,
      components: dataComponents,
    },
    ["name"],
  ),
  op(
    "data_update",
    "按版本编辑Data正文、About和附件引用",
    "PUT",
    "/data/:id",
    {
      id,
      name: string,
      body: string,
      description: string,
      aboutSampleIds: strings,
      componentIds: strings,
      components: dataComponents,
      expectedVersion: version,
    },
    ["id", "expectedVersion"],
  ),
  op(
    "data_finalize",
    "完成Data编辑并记录正文历史",
    "POST",
    "/data/:id/finalize",
    { id, expectedVersion: version },
    ["id", "expectedVersion"],
  ),
  op(
    "attachment_get",
    "读取附件元数据和稳定位置",
    "GET",
    "/attachments/:id",
    { id },
    ["id"],
  ),
  op(
    "attachment_cleanup_preview",
    "列出附件引用位置和可清理状态，不删除任何字节",
    "GET",
    "/attachments/orphans",
  ),
  op(
    "attachment_cleanup",
    "永久删除明确选择且执行时仍无引用的本地、缓存及远端附件，需要cleanup权限",
    "POST",
    "/attachments/cleanup",
    { ids: strings },
    ["ids"],
  ),
  op(
    "attachment_text_read",
    "分段读取文本附件，不把大文件塞进JSON",
    "GET",
    "/attachments/:id/text",
    {
      id,
      offset: { type: "integer", minimum: 0 },
      length: { type: "integer", minimum: 1, maximum: 65536 },
    },
    ["id"],
    ["offset", "length"],
  ),
  op(
    "analysis_list",
    "分页列出分析",
    "GET",
    "/analyses",
    paging,
    [],
    ["limit", "offset"],
  ),
  op(
    "analysis_get",
    "读取分析正文、问题和材料顺序",
    "GET",
    "/analyses/:id",
    { id },
    ["id"],
  ),
  op(
    "analysis_create",
    "按实际选择创建分析，空选择为空分析",
    "POST",
    "/analyses",
    {
      title: id,
      question: string,
      body: string,
      itemIds: strings,
      layout: analysisLayout,
      attachmentIds: strings,
    },
    ["title"],
  ),
  op(
    "analysis_update",
    "按版本编辑分析正文和材料顺序",
    "PUT",
    "/analyses/:id",
    {
      id,
      title: string,
      question: string,
      body: string,
      itemIds: strings,
      layout: analysisLayout,
      attachmentIds: strings,
      expectedVersion: version,
    },
    ["id", "expectedVersion"],
  ),
  op(
    "analysis_finalize",
    "完成分析编辑并记录正文历史",
    "POST",
    "/analyses/:id/finalize",
    { id, expectedVersion: version },
    ["id", "expectedVersion"],
  ),
  op(
    "analysis_export_context",
    "返回去重后的实际正文、版本清单和分实体文档",
    "GET",
    "/analyses/:id/export",
    { id },
    ["id"],
  ),
  op(
    "claim_list",
    "分页列出正式论点",
    "GET",
    "/claims",
    paging,
    [],
    ["limit", "offset"],
  ),
  op("claim_get", "读取论点及固定证据版本", "GET", "/claims/:id", { id }, [
    "id",
  ]),
  op(
    "claim_create",
    "从Data或Analysis host创建论点，固定实际上下文",
    "POST",
    "/claims",
    {
      hostType: { type: "string", enum: ["data", "analysis"] },
      hostId: id,
      text: id,
    },
    ["hostType", "hostId", "text"],
  ),
  op(
    "claim_update",
    "按版本编辑论点文字，不刷新证据",
    "PUT",
    "/claims/:id",
    { id, text: string, expectedVersion: version },
    ["id", "text", "expectedVersion"],
  ),
  op(
    "claim_finalize",
    "完成论点编辑并记录正文历史",
    "POST",
    "/claims/:id/finalize",
    { id, expectedVersion: version },
    ["id", "expectedVersion"],
  ),
  op(
    "claim_supplement_evidence",
    "追加当前上下文快照，保留旧证据",
    "POST",
    "/claims/:id/evidence",
    { id, expectedVersion: version },
    ["id", "expectedVersion"],
  ),
  op("storage_settings", "读取S3设置，凭据脱敏", "GET", "/storage/s3"),
  op(
    "storage_connection_test",
    "测试已配置的S3连接",
    "POST",
    "/storage/s3/test",
  ),
  op("storage_scan", "扫描到期附件并处理持久队列", "POST", "/storage/s3/scan"),
  op("backup_create", "创建完整备份长任务，返回jobId", "POST", "/backups", {
    target: { type: "string", enum: ["local", "s3"] },
  }),
  op(
    "backup_restore",
    "验证完整备份并恢复到新目录，需要restore权限",
    "POST",
    "/backups/restore",
    { zipPath: id, targetDir: id },
    ["zipPath", "targetDir"],
  ),
  op(
    "job_list",
    "分页读取任务状态和错误",
    "GET",
    "/jobs",
    paging,
    [],
    ["limit", "offset"],
  ),
  op("job_get", "读取长任务进度和结果", "GET", "/jobs/:id", { id }, ["id"]),
  op("job_retry", "手动重试失败的存储任务", "POST", "/jobs/:id/retry", { id }, [
    "id",
  ]),
  op(
    "job_cancel",
    "取消仍在运行的长任务；已经完成的任务保持原状态",
    "POST",
    "/jobs/:id/cancel",
    { id },
    ["id"],
  ),
  op(
    "search",
    "全文搜索样品、数据与字典",
    "GET",
    "/search",
    { q: string },
    [],
    ["q"],
  ),
];
export function operationRequest(
  operation: Operation,
  args: Record<string, unknown>,
) {
  const used = new Set<string>();
  let path = operation.path.replace(/:([A-Za-z]+)/g, (_match, key: string) => {
    used.add(key);
    if (typeof args[key] !== "string" || !args[key])
      throw new Error(`缺少参数 ${key}`);
    return encodeURIComponent(args[key] as string);
  });
  const query = new URLSearchParams();
  for (const key of operation.query || []) {
    used.add(key);
    if (args[key] !== undefined) query.set(key, String(args[key]));
  }
  if (operation.name === "sample_get" && args.latest === undefined)
    query.set("latest", "true");
  if (query.size) path += "?" + query;
  return {
    path,
    body: Object.fromEntries(
      Object.entries(args).filter(
        ([key]) => !used.has(key) && key !== "idempotencyKey",
      ),
    ),
  };
}
export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const route = "/api/v1" + operation.path.replace(/:([A-Za-z]+)/g, "{$1}");
    const parameters: unknown[] = [];
    const properties: Record<string, JsonSchema> = {};
    for (const [name, schema] of Object.entries(operation.input.properties)) {
      if (operation.path.includes(":" + name))
        parameters.push({ name, in: "path", required: true, schema });
      else if (operation.query?.includes(name))
        parameters.push({ name, in: "query", schema });
      else if (name === "idempotencyKey")
        parameters.push({ name: "Idempotency-Key", in: "header", schema });
      else properties[name] = schema;
    }
    (paths[route] ??= {})[operation.method.toLowerCase()] = {
      operationId: operation.name,
      description: operation.description,
      parameters,
      ...(Object.keys(properties).length
        ? {
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties,
                    required: operation.input.required?.filter(
                      (name) => name in properties,
                    ),
                  },
                },
              },
            },
          }
        : {}),
      responses: {
        200: {
          description:
            "操作结果，实体包含实际版本；分页请求返回items/total/offset/limit",
        },
        409: { description: "版本或幂等冲突" },
        401: { description: "凭据无效" },
        403: { description: "缺少权限" },
      },
      security: [{ bearerAuth: [] }],
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Scientific Workbench API", version: "0.2.0" },
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
  };
}

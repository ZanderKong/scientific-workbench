import {
  parseBody,
  sha256,
  stripInternalMarkers,
  resolveReference,
} from "@workbench/core";
import type {
  AnalysisRecord,
  Attachment,
  ClaimRecord,
  ContextManifest,
  DataRecord,
  DocumentFile,
  PropertyDefinition,
  ResearchObject,
} from "@workbench/core";

interface SampleContext {
  id: string;
  code: string;
  document: DocumentFile;
}
interface ContextSource {
  getAnalysis(id: string): AnalysisRecord;
  getData(id: string): DataRecord & { body: string };
  listData(): (DataRecord & { body: string })[];
  listSamples(): SampleContext[];
  getSample(id: string): SampleContext;
  getClaim(id: string): ClaimRecord;
  listClaims(): ClaimRecord[];
  searchObjects(): ResearchObject[];
  searchProperties(): PropertyDefinition[];
  getAttachment(id: string): Attachment;
  ensureLatest(id: string): unknown;
  assertEntityCurrent(type: "data" | "analysis" | "claim", id: string): void;
}
export function collectContext(
  source: ContextSource,
  hostType: "data" | "analysis",
  hostId: string,
) {
  source.assertEntityCurrent(hostType, hostId);
  const analysis =
    hostType === "analysis" ? source.getAnalysis(hostId) : undefined;
  const directIds = new Set(analysis?.itemIds ?? []);
  const directSamples = source
    .listSamples()
    .filter((sample) => directIds.has(sample.id))
    .map((sample) => sample.id);
  const relatedData = new Set(
    hostType === "data"
      ? [hostId]
      : source
          .listData()
          .filter((data) => directIds.has(data.id))
          .map((data) => data.id),
  );
  // Finish every participating mirror before capturing any entity. Later mirror refreshes
  // must not change a Sample whose earlier version has already entered the manifest.
  const limit = source.listSamples().length * 2 + 3;
  let prior = "";
  for (let pass = 0; pass < limit; pass++) {
    for (const id of directSamples) source.ensureLatest(id);
    for (const id of directSamples)
      for (const binding of Object.values(
        source.getSample(id).document.head.blocks,
      ))
        if (binding.dataId) relatedData.add(binding.dataId);
    const participants = source
      .listSamples()
      .filter(
        (sample) =>
          directIds.has(sample.id) ||
          Object.values(sample.document.head.blocks).some(
            (binding) => binding.dataId && relatedData.has(binding.dataId),
          ),
      );
    for (const sample of participants) source.ensureLatest(sample.id);
    const state = JSON.stringify({
      samples: participants.map((sample) => {
        const current = source.getSample(sample.id);
        return [
          sample.id,
          current.document.head.contentVersion,
          sha256(current.document.body),
        ];
      }),
      data: [...relatedData].sort().map((id) => {
        source.assertEntityCurrent("data", id);
        const data = source.getData(id);
        return [id, data.version];
      }),
    });
    if (state === prior) break;
    if (pass === limit - 1)
      throw new Error("关联内容尚未稳定，请完成冲突处理后重新导出");
    prior = state;
  }
  const hostData = hostType === "data" ? source.getData(hostId) : undefined;
  const manifest: ContextManifest = {
    host: {
      type: hostType,
      id: hostId,
      version: analysis?.version ?? hostData!.version,
    },
    entities: [],
    attachments: [],
    identities: [],
    relations: [],
    warnings: [],
  };
  const documents: Record<string, string> = {};
  const included = new Set<string>(),
    attachmentIds = new Set<string>();
  const objects = source.searchObjects(),
    samples = source.listSamples();
  const sampleMap = new Map(samples.map((sample) => [sample.id, sample]));
  const dataMap = new Map(source.listData().map((data) => [data.id, data]));
  const claimMap = new Map(
    source.listClaims().map((claim) => [claim.id, claim]),
  );
  const add = (
    type: string,
    id: string,
    name: string,
    version: number,
    body: string,
    preamble = "",
  ) => {
    if (included.has(id)) return;
    included.add(id);
    const file = `${type}/${id}.md`;
    const reading = `# ${name}\n\n${preamble ? preamble + "\n\n" : ""}${stripInternalMarkers(body)}`;
    documents[file] = reading;
    manifest.entities.push({ type, id, version, bodyHash: sha256(body), file });
  };
  const identify = (id: string, type: string, name: string, reason: string) => {
    if (!manifest.identities.some((item) => item.id === id))
      manifest.identities.push({ id, type, name, reason });
  };
  const addData = (id: string) => {
    const data = source.getData(id);
    if (included.has(id)) return;
    add("data", id, data.name, data.version, data.body, data.description);
    if (data.components.length) {
      const componentText = data.components
        .map(
          (component) =>
            `### ${component.name}\n- component: ${component.id}\n- role: ${component.role}\n- creator: ${component.creator}\n- provenance: ${component.provenance}\n- derived_from: ${component.derivedFrom.join(", ")}\n${component.content ?? `- attachment: ${component.attachmentId}`}`,
        )
        .join("\n\n");
      const entity = manifest.entities.find((entity) => entity.id === id)!;
      documents[entity.file] += `\n\n## 组件\n${componentText}`;
      for (const component of data.components)
        for (const origin of component.derivedFrom)
          manifest.relations.push({
            fromId: component.id,
            toId: origin,
            kind: "derived-from",
          });
    }
    data.componentIds.forEach((id) => attachmentIds.add(id));
    data.componentIds.forEach((fileId) =>
      manifest.relations.push({ fromId: id, toId: fileId, kind: "component" }),
    );
    if (data.sourceDocumentId)
      manifest.relations.push({
        fromId: id,
        toId: data.sourceDocumentId,
        blockId: data.sourceBlockId,
        kind: "source-operation",
      });
    for (const sampleId of data.aboutSampleIds) {
      const sample = sampleMap.get(sampleId);
      identify(
        sampleId,
        "sample",
        sample?.code || sampleId,
        "Data 的 About Sample",
      );
      manifest.relations.push({ fromId: id, toId: sampleId, kind: "about" });
    }
  };
  const addSample = (id: string) => {
    const sample = source.getSample(id);
    add(
      "samples",
      id,
      sample.code,
      sample.document.head.contentVersion,
      sample.document.body,
    );
    const parsed = parseBody(id, sample.document.body);
    const properties = source.searchProperties();
    for (const value of parsed.records.flatMap((record) => record.properties)) {
      const definition = properties.find(
        (property) => property.canonicalName === value.propertyName,
      );
      if (definition)
        add(
          "properties",
          definition.id,
          definition.canonicalName,
          definition.version,
          JSON.stringify(definition, null, 2),
        );
    }
    manifest.warnings.push(
      ...parsed.warnings,
      ...parsed.invalidSegments.map(
        (item) => `${sample.code}:${item.line} ${item.reason}`,
      ),
    );
    for (const reference of parsed.records.flatMap(
      (record) => record.references,
    )) {
      const resolved = resolveReference(
        reference,
        sample.document.head.references || [],
        objects,
      );
      const object = objects.find((object) => object.id === resolved.objectId);
      const referencedSample =
        object?.role === "sample"
          ? samples.find((other) => other.id === object.id)
          : undefined;
      if (referencedSample)
        identify(
          referencedSample.id,
          "sample",
          referencedSample.code,
          "正文引用；不递归展开",
        );
      else if (object)
        add(
          "objects",
          object.id,
          object.canonicalName,
          object.version,
          JSON.stringify(object, null, 2),
        );
      else
        manifest.warnings.push(
          `${sample.code}:${reference.blockId} 未绑定或重名对象「${reference.rawText}」`,
        );
    }
    for (const [blockId, binding] of Object.entries(
      sample.document.head.blocks,
    )) {
      if (binding.dataId) addData(binding.dataId);
      else if (binding.kind === "data-unresolved")
        manifest.warnings.push(
          `${sample.code}:${blockId} 数据身份待关联，未推定为新 Data`,
        );
    }
  };
  if (analysis) {
    for (const fileId of analysis.attachmentIds) {
      attachmentIds.add(fileId);
      manifest.relations.push({
        fromId: analysis.id,
        toId: fileId,
        kind: "artifact",
      });
    }
    add(
      "analyses",
      analysis.id,
      analysis.title,
      analysis.version,
      analysis.body,
      analysis.question ? `## 问题\n${analysis.question}` : "",
    );
    for (const id of analysis.itemIds) {
      manifest.relations.push({
        fromId: analysis.id,
        toId: id,
        kind: "direct-item",
      });
      if (sampleMap.has(id)) addSample(id);
      else if (dataMap.has(id)) addData(id);
      else if (claimMap.has(id)) {
        const claim = source.getClaim(id);
        add("claims", id, "论点", claim.version, claim.text);
      } else {
        const object = objects.find((item) => item.id === id);
        if (object)
          add(
            "objects",
            id,
            object.canonicalName,
            object.version,
            JSON.stringify(object, null, 2),
          );
        else manifest.warnings.push(`条目不存在：${id}`);
      }
    }
  } else addData(hostId);
  for (const id of attachmentIds) {
    const file = source.getAttachment(id);
    manifest.attachments.push({
      id,
      sha256: file.sha256,
      name: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    });
  }
  manifest.warnings = [...new Set(manifest.warnings)];
  manifest.relations = [
    ...new Map(
      manifest.relations.map((relation) => [
        JSON.stringify(relation),
        relation,
      ]),
    ).values(),
  ];
  const identities = manifest.identities
    .map((item) => `- ${item.type} ${item.name} (${item.id})：${item.reason}`)
    .join("\n");
  const context =
    Object.values(documents).join("\n\n---\n\n") +
    (identities ? `\n\n## 关联身份说明\n${identities}` : "") +
    (manifest.warnings.length
      ? `\n\n## 待处理项\n${manifest.warnings.map((message) => `- ${message}`).join("\n")}`
      : "");
  return { context, manifest, documents };
}

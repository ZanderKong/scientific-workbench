import type { ClaimEvidence } from "@workbench/core";

/** Text annotations remain user text; this does not decide whether a claim is true. */
export function claimPresentation(text: string) {
  const lines = text.split(/\r?\n/);
  const annotations = lines
    .slice(1)
    .flatMap((line) => line.replace(/^\s*-\s*/, "").split(/[｜|]/));
  const read = (name: string) =>
    annotations
      .map((part) => part.match(/^\s*([^:：]+)[:：]\s*(.*?)\s*$/))
      .find((match) => match?.[1].trim() === name)?.[2];
  return {
    title: lines[0] || "未填写论点",
    status: read("状态") || "未标注",
    confidence: read("置信度") || "未标注",
    author: read("作者来源") || "未标注",
  };
}
export function evidenceCards(snapshot: ClaimEvidence) {
  const entries = snapshot.manifest?.entities.filter(
    (entity) => entity.type === "data" && snapshot.documents?.[entity.file],
  );
  if (!entries?.length)
    return [
      {
        id: snapshot.id,
        snapshot,
        title: `${snapshot.entityType} · v${snapshot.version}`,
        subtitle: `${snapshot.capturedAt} · ${snapshot.attachmentIds.length} 个附件`,
        text: snapshot.content.slice(0, 180),
        content: snapshot.content,
      },
    ];
  return entries.map((entity) => {
    const content = snapshot.documents![entity.file];
    const title = content.match(/^# (.*)\r?\n/)?.[1] || entity.id;
    const samples = snapshot
      .manifest!.relations.filter(
        (relation) =>
          relation.fromId === entity.id && relation.kind === "about",
      )
      .map(
        (relation) =>
          snapshot.manifest!.identities.find(
            (identity) => identity.id === relation.toId,
          )?.name || relation.toId,
      );
    return {
      id: `${snapshot.id}:${entity.id}`,
      snapshot,
      title,
      subtitle: [`v${entity.version}`, ...samples].join(" · "),
      text: content.replace(/^# .*\r?\n\s*/, "").slice(0, 180),
      content,
    };
  });
}

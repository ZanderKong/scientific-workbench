import { useCallback, useEffect, useState } from "react";
import type { ClaimRecord, DataRecord, AnalysisRecord } from "@workbench/core";
import { claimPresentation, evidenceCards } from "../claim-presentation";
import { request } from "../api";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { Modal } from "../components/Modal";
import { useEntityDraft } from "../hooks/useEntityDraft";

export function ClaimDetail({
  item,
  data,
  analyses,
  back,
  openHost,
  openSample,
  refresh,
  notify,
  registerBarrier,
}: {
  item: ClaimRecord;
  data: DataRecord[];
  analyses: AnalysisRecord[];
  back: () => void;
  openHost: (type: "data" | "analysis", id: string) => void;
  openSample: (id: string) => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  registerBarrier: (barrier: (() => Promise<void>) | null) => void;
}) {
  const draft = useEntityDraft(item, `/claims/${item.id}`, notify);
  const [editing, setEditing] = useState(false);
  const [evidence, setEvidence] = useState<ClaimRecord["evidence"][number]>();
  const [evidenceContent, setEvidenceContent] = useState<string>();
  const [more, setMore] = useState(false);
  const [history, setHistory] = useState(false);
  const closeHistory = useCallback(() => setHistory(false), []);
  const finish = useCallback(async () => {
    await draft.flush();
    await refresh();
  }, [draft.flush, refresh]);
  useEffect(() => {
    registerBarrier(finish);
    return () => registerBarrier(null);
  }, [registerBarrier, finish]);
  const name =
    item.hostType === "data"
      ? data.find((row) => row.id === item.hostId)?.name
      : analyses.find((row) => row.id === item.hostId)?.title;
  const presentation = claimPresentation(draft.value.text);
  const cards = item.evidence.flatMap(evidenceCards);
  const samples = [
    ...new Map(
      item.evidence.flatMap(
        (snapshot) =>
          snapshot.manifest?.identities
            .filter((identity) => identity.type === "sample")
            .map((identity) => [identity.id, identity] as const) || [],
      ),
    ).values(),
  ];
  const supplement = async () => {
    try {
      await finish();
      const updated = await request<ClaimRecord>(
        `/claims/${item.id}/evidence`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion: draft.confirmedVersion() }),
        },
      );
      draft.acceptVersion(updated.version);
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  };
  return (
    <section className="detailPage">
      <div className="detailTop">
        <button className="back" onClick={back}>
          ← 论点
        </button>
        <div className="actions">
          <button onClick={() => setHistory(true)}>历史</button>
          <span>
            {
              {
                saved: "已保存",
                dirty: "待保存",
                saving: "保存中",
                error: "保存失败，可重试",
              }[draft.state]
            }
          </span>
          <button
            onClick={() => {
              if (editing)
                void finish()
                  .then(() => setEditing(false))
                  .catch((error) => notify(error.message));
              else setEditing(true);
            }}
          >
            {editing ? "完成编辑" : "编辑"}
          </button>
          <button onClick={() => setMore(true)}>•••</button>
        </div>
      </div>
      <div className="claimHero">
        <div className="eyebrow">{item.id}</div>
        <span className="status">{presentation.status}</span>
        {editing ? (
          <textarea
            className="claimTextInput"
            aria-label="论点正文"
            value={draft.value.text}
            onChange={(event) => draft.change({ text: event.target.value })}
          />
        ) : (
          <h1>{presentation.title}</h1>
        )}
        <p>
          来源：{name || item.hostId}
          。以下为创建或补充时固定的上下文，不自动标记为支持证据。
        </p>
      </div>
      {item.legacyEvidenceWarning && (
        <p className="legacyEvidenceWarning" role="note">
          {item.legacyEvidenceWarning}
        </p>
      )}
      <div className="claimLayout">
        <section className="evidenceColumn">
          <div className="blockTitle">
            <span>证据快照</span>
            <button onClick={() => void supplement()}>＋</button>
          </div>
          {cards.map((card) => (
            <button
              className="evidenceCard"
              key={card.id}
              onClick={() => {
                setEvidence(card.snapshot);
                setEvidenceContent(card.content);
              }}
            >
              <b>{card.title}</b>
              <span>{card.subtitle}</span>
              <p>{card.text}</p>
            </button>
          ))}
          <button className="addLink" onClick={() => void supplement()}>
            ＋ 补充当前证据
          </button>
        </section>
        <aside>
          <div className="infoCard">
            <label>上下文</label>
            <button onClick={() => openHost(item.hostType, item.hostId)}>
              {name || item.hostId} ↗
            </button>
          </div>
          <div className="infoCard">
            <label>相关样品</label>
            {samples.length ? (
              samples.map((sample) => (
                <button key={sample.id} onClick={() => openSample(sample.id)}>
                  {sample.name} ↗
                </button>
              ))
            ) : (
              <span>未记录</span>
            )}
          </div>
          <div className="infoCard">
            <label>作者来源</label>
            <span>{presentation.author}</span>
          </div>
          <div className="infoCard">
            <label>置信度</label>
            <button onClick={() => setEditing(true)}>
              {presentation.confidence}
            </button>
          </div>
        </aside>
      </div>
      {evidence && (
        <Modal
          title="固定证据正文"
          close={() => setEvidence(undefined)}
          footer={
            <button
              onClick={() =>
                void navigator.clipboard.writeText(
                  evidenceContent || evidence.content,
                )
              }
            >
              复制
            </button>
          }
        >
          <pre className="noteCode">{evidenceContent || evidence.content}</pre>
          <button onClick={() => setEvidenceContent(evidence.content)}>
            查看完整上下文
          </button>
          <div className="evidenceVersions">
            {evidence.manifest?.entities.map((entity) => (
              <p key={entity.id}>
                {entity.type} · {entity.id} · v{entity.version}
              </p>
            ))}
          </div>
          <p>完整快照 SHA-256：{evidence.bodyHash}</p>
        </Modal>
      )}
      {(more || draft.recovery) && (
        <Modal
          title="保存与重新加载"
          close={() => {
            setMore(false);
            draft.dismissRecovery();
          }}
        >
          <button onClick={() => void draft.copy()}>复制我的内容</button>
          <button
            onClick={() =>
              void draft
                .reload()
                .then(() => setMore(false))
                .catch((error) => notify(error.message))
            }
          >
            加载最新内容
          </button>
          <button
            onClick={() =>
              void draft
                .reload(true)
                .then(() => {
                  setMore(false);
                })
                .catch((error) => notify(error.message))
            }
          >
            重新加载文件
          </button>
          {draft.recovery && (
            <button onClick={() => draft.recover()}>继续草稿</button>
          )}
        </Modal>
      )}
      {history && (
        <HistoryDrawer id={item.id} close={closeHistory} notify={notify} />
      )}
    </section>
  );
}

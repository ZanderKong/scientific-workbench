import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, ClaimRecord, DataRecord } from "@workbench/core";
import { request, type SampleRow } from "../api";
import { usePendingUploads } from "../hooks/usePendingUploads";
import { useEntityDraft } from "../hooks/useEntityDraft";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { Modal } from "../components/Modal";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { DataComponents } from "../components/DataComponents";
import { ClaimComposer } from "../components/ClaimComposer";
import { ResearchEditor } from "../editor/ResearchEditor";

type DataDocument = DataRecord & { body: string };
export function DataDetail({
  item,
  samples,
  claims,
  back,
  openSample,
  openClaim,
  refresh,
  notify,
  registerBarrier,
}: {
  item: DataDocument;
  samples: SampleRow[];
  claims: ClaimRecord[];
  back: () => void;
  openSample: (id: string, blockId?: string) => void;
  openClaim: (id: string) => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  registerBarrier: (barrier: (() => Promise<void>) | null) => void;
}) {
  const uploads = usePendingUploads();
  const draft = useEntityDraft(item, `/data/${item.id}`, notify);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [preview, setPreview] = useState<Attachment>();
  const [conflict, setConflict] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [showDescription, setShowDescription] = useState(false);
  const [newText, setNewText] = useState(0);
  const currentData = useRef(draft.value);
  currentData.current = draft.value;
  const [history, setHistory] = useState(false);
  const closeHistory = useCallback(() => setHistory(false), []);
  const finish = useCallback(async () => {
    await uploads.wait();
    await draft.flush();
    await refresh();
  }, [draft.flush, refresh, uploads.wait]);
  useEffect(() => {
    registerBarrier(finish);
    return () => registerBarrier(null);
  }, [registerBarrier, finish]);
  useEffect(() => {
    let active = true;
    void Promise.all(
      draft.value.componentIds.map((id) =>
        request<Attachment>(`/attachments/${id}`),
      ),
    )
      .then((result) => {
        if (active) setFiles(result);
      })
      .catch((error) => notify(error.message));
    return () => {
      active = false;
    };
  }, [draft.value.componentIds.join("|")]);
  useEffect(() => {
    if (draft.state === "error") setConflict(true);
  }, [draft.state]);
  const closePreview = useCallback(() => setPreview(undefined), []);
  const upload = async (selected: FileList | null) => {
    if (!selected) return;
    const filesToUpload = Array.from(selected);
    const task = (async () => {
      for (const file of filesToUpload) {
        const form = new FormData();
        form.append("file", file);
        const saved = await request<Attachment>("/attachments/stream", {
          method: "POST",
          body: form,
        });
        if (!currentData.current.componentIds.includes(saved.id)) {
          const components = [
            ...(currentData.current.components || []),
            {
              id: crypto.randomUUID(),
              kind: "file" as const,
              name: saved.originalName,
              role: "raw",
              creator: "human" as const,
              provenance: "文件上传",
              derivedFrom: [],
              createdAt: saved.createdAt,
              attachmentId: saved.id,
            },
          ];
          const next = {
            components,
            componentIds: [
              ...new Set(
                components.flatMap((component) =>
                  component.attachmentId ? [component.attachmentId] : [],
                ),
              ),
            ],
          };
          currentData.current = { ...currentData.current, ...next };
          draft.change(next);
        }
      }
    })();
    uploads.track(task);
    try {
      await task;
      await finish();
    } catch (error) {
      notify(String(error));
    }
  };
  const status = {
    saved: "已保存",
    saving: "保存中",
    dirty: "待保存",
    error: "保存失败，可重试",
  }[draft.state];
  return (
    <section className="detailPage dataDetailPage">
      <div className="detailTop">
        <button className="back" onClick={back}>
          ← 数据
        </button>
        <div className="actions">
          <button onClick={() => setHistory(true)}>历史</button>
          <span>{status}</span>
          <button
            onClick={() =>
              void finish().catch((error) => notify(error.message))
            }
          >
            完成编辑
          </button>
          <button onClick={() => fileInput.current?.click()}>添加文件</button>
          <button onClick={() => setConflict(true)}>•••</button>
        </div>
      </div>
      <div className="detailHero">
        <div className="eyebrow">{item.id}</div>
        <input
          className="freshDataTitle dataTitle"
          aria-label="数据名称"
          value={draft.value.name}
          onChange={(event) => draft.change({ name: event.target.value })}
        />
        <div className="metaLine">
          <span>{files.length ? "附件数据" : "描述数据"}</span>
          {draft.value.aboutSampleIds.map((id) => (
            <button key={id} onClick={() => openSample(id)}>
              关于 {samples.find((sample) => sample.id === id)?.code || id} ↗
            </button>
          ))}
          <span>
            来源：{item.sourceDocumentId ? "样品操作" : "数据页直接创建"}
          </span>
        </div>
      </div>
      <div className="contentArea">
        {(showDescription ||
          draft.value.body.trim() ||
          !(draft.value.components || []).length) && (
          <div className="dataBox dataDescription">
            <div className="eyebrow">DESCRIPTION</div>
            <ResearchEditor
              key={editorVersion}
              body={draft.value.body || "- "}
              label="数据正文"
              onChange={(body) => draft.change({ body })}
              onError={notify}
            />
          </div>
        )}
        <DataComponents
          components={draft.value.components || []}
          files={files}
          newText={newText}
          preview={setPreview}
          change={(components) =>
            draft.change({
              components,
              componentIds: [
                ...new Set(
                  components.flatMap((component) =>
                    component.attachmentId ? [component.attachmentId] : [],
                  ),
                ),
              ],
            })
          }
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void upload(event.target.files);
            event.target.value = "";
          }}
        />
        <div className="infoGrid">
          <div className="infoCard">
            <label>
              <button className="aboutEdit" onClick={() => setAboutOpen(true)}>
                关于
              </button>
            </label>
            {draft.value.aboutSampleIds.map((id) => (
              <button key={id} onClick={() => openSample(id)}>
                {samples.find((sample) => sample.id === id)?.code || id} ↗
              </button>
            ))}
            {!draft.value.aboutSampleIds.length && (
              <button onClick={() => setAboutOpen(true)}>＋ 选择 Sample</button>
            )}
          </div>
          <div className="infoCard">
            <label>采集上下文</label>
            {item.sourceDocumentId ? (
              <button
                onClick={() =>
                  openSample(item.sourceDocumentId!, item.sourceBlockId)
                }
              >
                来源操作 ↗
              </button>
            ) : (
              <span>未绑定</span>
            )}
          </div>
          <div className="infoCard">
            <label>版本</label>
            <span>v{item.version} · 当前内容</span>
          </div>
          <div className="infoCard">
            <label>关联论点</label>
            <span>
              {
                claims.filter(
                  (claim) =>
                    claim.hostType === "data" && claim.hostId === item.id,
                ).length
              }{" "}
              条
            </span>
          </div>
        </div>
        <ClaimComposer
          hostType="data"
          hostId={item.id}
          claims={claims}
          open={openClaim}
          beforeCreate={finish}
          refresh={refresh}
          notify={notify}
        />
      </div>
      {aboutOpen && (
        <Modal
          title="关于哪些样品"
          close={() => setAboutOpen(false)}
          footer={
            <button
              className="primary"
              onClick={() =>
                void finish()
                  .then(() => setAboutOpen(false))
                  .catch((error) => notify(error.message))
              }
            >
              保存
            </button>
          }
        >
          <div className="columnChecks">
            {samples.map((sample) => (
              <label key={sample.id}>
                <input
                  type="checkbox"
                  checked={draft.value.aboutSampleIds.includes(sample.id)}
                  onChange={() =>
                    draft.change({
                      aboutSampleIds: draft.value.aboutSampleIds.includes(
                        sample.id,
                      )
                        ? draft.value.aboutSampleIds.filter(
                            (id) => id !== sample.id,
                          )
                        : [...draft.value.aboutSampleIds, sample.id],
                    })
                  }
                />
                {sample.code}
              </label>
            ))}
          </div>
        </Modal>
      )}
      {(conflict || draft.recovery) && (
        <Modal
          title={draft.recovery ? "发现未确认草稿" : "保存与重新加载"}
          close={() => {
            setConflict(false);
            draft.dismissRecovery();
          }}
          footer={
            <>
              <button className="ghost" onClick={() => void draft.copy()}>
                复制我的内容
              </button>
              {draft.recovery && (
                <button
                  onClick={() => {
                    draft.recover();
                    setEditorVersion((v) => v + 1);
                  }}
                >
                  继续草稿
                </button>
              )}
              <button
                className="primary"
                onClick={() =>
                  void draft
                    .reload()
                    .then(() => {
                      setConflict(false);
                      setEditorVersion((v) => v + 1);
                    })
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
                      setConflict(false);
                      setEditorVersion((value) => value + 1);
                    })
                    .catch((error) => notify(error.message))
                }
              >
                重新加载文件
              </button>
            </>
          }
        >
          <button
            onClick={() => {
              setConflict(false);
              setNewText((value) => value + 1);
            }}
          >
            添加文本组件
          </button>
          <button
            onClick={() => {
              setConflict(false);
              setShowDescription(true);
            }}
          >
            编辑正文
          </button>
          <p>
            版本冲突时不会自动合并或覆盖。可复制当前内容，再加载最新版本继续编辑。
          </p>
        </Modal>
      )}
      {preview && <AttachmentPreview file={preview} close={closePreview} />}
      {history && (
        <HistoryDrawer id={item.id} close={closeHistory} notify={notify} />
      )}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DocumentHead,
  ReferenceOccurrence,
  DataRecord,
  ClaimRecord,
} from "@workbench/core";
import { ApiError, request, type SampleRow } from "../api";
import { ResearchEditor } from "../editor/ResearchEditor";
import { SaveQueue, type SaveState } from "../editor/SaveQueue";
import { draftRead, draftWrite } from "../editor/drafts";
import { Modal } from "../components/Modal";
import { Popover } from "../components/Popover";
import { usePendingUploads } from "../hooks/usePendingUploads";
import { HistoryDrawer } from "../components/HistoryDrawer";

interface Document {
  body: string;
  head: DocumentHead;
}
function recoverDraft(raw: string) {
  try {
    const parsed = JSON.parse(raw) as {
      schema?: string;
      body: string;
      bindings?: ReferenceOccurrence[];
    };
    if (parsed.schema === "swb.draft/2")
      return { body: parsed.body, bindings: parsed.bindings || [] };
  } catch {
    /* Earlier drafts were plain Markdown. */
  }
  return { body: raw, bindings: [] as ReferenceOccurrence[] };
}

export function SampleDocument({
  id,
  focusBlock,
  back,
  refresh,
  notify,
  registerBarrier,
  data,
  claims,
  openData,
  openClaim,
  openCopy,
  openBatch,
}: {
  data: DataRecord[];
  claims: ClaimRecord[];
  openData: (id: string) => void;
  openClaim: (id: string) => void;
  openCopy: (id: string) => void;
  openBatch: () => void;
  id: string;
  focusBlock?: string;
  back: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  registerBarrier: (barrier: (() => Promise<void>) | null) => void;
}) {
  const uploads = usePendingUploads();
  const [document, setDocument] = useState<Document>();
  const [state, setState] = useState<SaveState>("saved");
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState<string>();
  const [reloadDraft, setReloadDraft] = useState<string>();
  const [panel, setPanel] = useState<
    "more" | "data" | "claims" | "batch" | null
  >(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect>();
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const [identityBlock, setIdentityBlock] = useState<string>();
  const unresolvedData = Object.entries(document?.head.blocks || {}).filter(
    ([, binding]) => binding.kind === "data-unresolved",
  );
  const [dataConflict, setDataConflict] = useState<string>();
  const [editorVersion, setEditorVersion] = useState(0);
  const [sample, setSample] = useState<SampleRow>();
  const queue = useRef<SaveQueue | undefined>(undefined);
  const bindings = useRef<ReferenceOccurrence[]>([]);
  const recoveryBindings = useRef<ReferenceOccurrence[]>([]);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const draftKey = `sample:${id}`;
  const finish = useCallback(async () => {
    if (!queue.current) return;
    await uploads.wait();
    await queue.current.flush();
    const result = await request<{
      status: string;
      head?: DocumentHead;
      contentVersion?: number;
      body?: string;
      parsed?: { warnings: string[]; invalidSegments: unknown[] };
    }>(`/documents/${id}/finalize`, { method: "POST" }).catch((error) => {
      if (error instanceof ApiError && typeof error.details.dataId === "string")
        setDataConflict(error.details.dataId);
      throw error;
    });
    if (result.status === "stale")
      throw new Error("正文发生变化，请重新完成编辑");
    const canRefresh = !queue.current.hasUnsavedChanges;
    const bodyChanged =
      result.body !== undefined && result.body !== queue.current.currentBody;
    if (result.contentVersion !== undefined)
      queue.current.acceptServer(result.contentVersion, result.body);
    if (result.head && canRefresh) {
      bindings.current = result.head.references || [];
      setDocument((current) =>
        current ? { ...current, head: result.head! } : current,
      );
    }
    if (result.body !== undefined && canRefresh) {
      setDocument((current) =>
        current ? { ...current, body: result.body! } : current,
      );
      if (bodyChanged) setEditorVersion((version) => version + 1);
    }
    setPending(false);
    if (result.parsed?.warnings.length)
      notifyRef.current(result.parsed.warnings.join(" "));
    if (result.parsed?.invalidSegments.length)
      notifyRef.current("已更新；部分文字不符合属性格式，已保留原文");
    await refresh();
  }, [id, refresh, uploads.wait]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      request<Document>(`/documents/${id}`),
      request<SampleRow>(`/samples/${id}`),
      draftRead(draftKey),
    ])
      .then(([doc, row, draft]) => {
        if (!active) return;
        setDocument(doc);
        setSample(row);
        setPending(doc.head.extractionStatus !== "ready");
        bindings.current = doc.head.references || [];
        if (draft) {
          const recovered = recoverDraft(draft);
          recoveryBindings.current = recovered.bindings;
          if (
            recovered.body !== doc.body ||
            JSON.stringify(recovered.bindings) !==
              JSON.stringify(doc.head.references || [])
          )
            setRecovery(recovered.body);
        }
        queue.current = new SaveQueue(
          doc.body,
          doc.head.contentVersion,
          (body, expectedVersion) =>
            request(`/documents/${id}`, {
              method: "PUT",
              body: JSON.stringify({
                body,
                expectedVersion,
                bindings: bindings.current,
              }),
            }),
          (status, error) => {
            if (!active) return;
            setState(status);
            if (error) notifyRef.current(error.message);
          },
          (body) => {
            void draftWrite(
              draftKey,
              body === null
                ? null
                : JSON.stringify({
                    schema: "swb.draft/2",
                    body,
                    bindings: bindings.current,
                  }),
            ).catch((error) =>
              notifyRef.current(`草稿缓存失败：${error.message}`),
            );
          },
        );
      })
      .catch((error) => notifyRef.current(error.message));
    return () => {
      active = false;
      queue.current?.dispose();
    };
  }, [id, draftKey]);
  useEffect(() => {
    registerBarrier(finish);
    return () => registerBarrier(null);
  }, [registerBarrier, finish]);
  const resolveIdentity = async (blockId: string, dataId?: string) => {
    try {
      await queue.current?.flush();
      const loaded = await request<Document>(
        `/documents/${id}/blocks/${blockId}/resolve-data`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedVersion: queue.current?.confirmedVersion,
            ...(dataId ? { dataId } : { createNew: true }),
          }),
        },
      );
      queue.current?.acceptServer(loaded.head.contentVersion, loaded.body);
      bindings.current = loaded.head.references || [];
      setDocument(loaded);
      setEditorVersion((version) => version + 1);
      setIdentityBlock(undefined);
      await finish();
    } catch (error) {
      notify(String(error));
    }
  };
  const complete = async () => {
    try {
      await finish();
      notify("结构已更新");
    } catch (error) {
      if (error instanceof ApiError && typeof error.details.dataId === "string")
        setDataConflict(error.details.dataId);
      notify(String(error));
    }
  };
  const reload = async () => {
    try {
      try {
        await queue.current?.settle();
      } catch {
        /* The explicit reload action keeps the failed draft available to copy. */
      }
      const loaded = await request<Document>(`/documents/${id}/reload`, {
        method: "POST",
      });
      queue.current?.dispose();
      bindings.current = loaded.head.references || [];
      queue.current = new SaveQueue(
        loaded.body,
        loaded.head.contentVersion,
        (body, expectedVersion) =>
          request(`/documents/${id}`, {
            method: "PUT",
            body: JSON.stringify({
              body,
              expectedVersion,
              bindings: bindings.current,
            }),
          }),
        (status, error) => {
          setState(status);
          if (error) notify(error.message);
        },
        (body) => {
          void draftWrite(
            draftKey,
            body === null
              ? null
              : JSON.stringify({
                  schema: "swb.draft/2",
                  body,
                  bindings: bindings.current,
                }),
          ).catch((error) => notify(error.message));
        },
      );
      await draftWrite(draftKey, null);
      setDocument(loaded);
      setEditorVersion((version) => version + 1);
      setPending(true);
      setState("saved");
      setReloadDraft(undefined);
    } catch (error) {
      notify(String(error));
    }
  };
  const linkedData = data.filter(
    (item) =>
      item.aboutSampleIds.includes(id) ||
      Object.values(document?.head.blocks || {}).some(
        (binding) => binding.dataId === item.id,
      ),
  );
  const linkedClaims = claims.filter(
    (claim) =>
      claim.hostType === "data" &&
      linkedData.some((item) => item.id === claim.hostId),
  );
  const copy = async (count: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await finish();
      const created = await request<SampleRow>(`/samples/${id}/copy`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await refresh();
      setPanel(null);
      openCopy(created.id);
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  };
  const rename = async (code: string) => {
    if (!sample || code === sample.code) return;
    try {
      await queue.current?.flush();
      const updated = await request<SampleRow & { document: Document }>(
        `/samples/${id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            code,
            expectedVersion: queue.current?.confirmedVersion,
          }),
        },
      );
      queue.current?.acceptServer(updated.document.head.contentVersion);
      setSample(updated);
      await refresh();
    } catch (error) {
      notify(String(error));
      setEditorVersion((version) => version + 1);
    }
  };
  const closeHistory = useCallback(() => setHistory(false), []);
  return (
    <section className="editorPage">
      <div className="editorTop">
        <button className="back" onClick={back}>
          ← 样品
        </button>
        <div className="actions">
          <button onClick={() => setPanel("data")}>
            数据 {linkedData.length}
          </button>
          <button onClick={() => setPanel("claims")}>
            论点 {linkedClaims.length}
          </button>
          <span className={`parseStatus ${pending ? "pending" : ""}`}>
            <span className="parseDot" />
            {pending ? "编辑完成后更新" : "结构已同步"}
          </span>
          <span>
            {
              {
                saved: "已保存",
                dirty: "待保存",
                saving: "保存中",
                error: "保存失败，可重试",
              }[state]
            }
          </span>
          <button onClick={() => void complete()}>完成编辑</button>
          <button onClick={() => setHistory(true)}>历史</button>
          {unresolvedData.length > 0 && (
            <button onClick={() => setIdentityBlock(unresolvedData[0][0])}>
              数据待关联 · {unresolvedData.length}
            </button>
          )}
          <button
            aria-label="样品更多操作"
            onClick={(event) =>
              setMenuAnchor(event.currentTarget.getBoundingClientRect())
            }
          >
            •••
          </button>
        </div>
      </div>
      <div className="editorHeader">
        <div
          key={`code:${editorVersion}:${sample?.code}`}
          className="codeTitle"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          aria-label="样品编号"
          onBlur={(event) => {
            const code = event.currentTarget.textContent?.trim() || "";
            if (!code) {
              event.currentTarget.textContent = sample?.code || "";
              return;
            }
            void rename(code);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        >
          {sample?.code || document?.head.code}
        </div>
      </div>
      <div className="directEditor">
        {document && (
          <ResearchEditor
            key={`${id}:${editorVersion}`}
            body={document.body}
            bindings={document.head.references}
            allowCreateIntents
            trackUpload={uploads.track}
            focusBlock={focusBlock}
            onError={notify}
            onChange={(body, references) => {
              bindings.current = references;
              queue.current?.change(body);
              setPending(true);
            }}
          />
        )}
      </div>
      <div className="editorFooter">
        <span>
          <kbd>[名称]</kbd> 对象补全
        </span>
        <span>
          <kbd>|</kbd> 属性补全
        </span>
        <span>
          <kbd>[数据]</kbd> 数据标记
        </span>
        <span>
          <kbd>Tab</kbd> 缩进
        </span>
      </div>
      <div className="docParseNote">
        正文及时保存，完成编辑后更新结构。样品中的论点仅作为文本保留。
      </div>
      {menuAnchor && (
        <Popover anchor={menuAnchor} close={() => setMenuAnchor(undefined)}>
          <button
            className="menuItem"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setMenuAnchor(undefined);
              void copy(1);
            }}
          >
            复制当前样品并新建
          </button>
          <button
            className="menuItem"
            role="menuitem"
            onClick={() => {
              setMenuAnchor(undefined);
              openBatch();
            }}
          >
            批量新建样品
          </button>
          <button
            className="menuItem"
            role="menuitem"
            onClick={() => {
              setMenuAnchor(undefined);
              void (async () => {
                await finish();
                const body = queue.current?.currentBody || "";
                const url = URL.createObjectURL(
                  new Blob(
                    [
                      body
                        .split(/\r?\n/)
                        .filter((line) => !/^\s*<!--\s*swb:block/.test(line))
                        .join("\n"),
                    ],
                    { type: "text/markdown" },
                  ),
                );
                const link = window.document.createElement("a");
                link.href = url;
                link.download = `${sample?.code || id}.md`;
                link.click();
                URL.revokeObjectURL(url);
              })().catch((error) => notify(error.message));
            }}
          >
            导出 Markdown
          </button>
          <div className="menuSep" />
          <button
            className="menuItem"
            role="menuitem"
            onClick={() => {
              setMenuAnchor(undefined);
              if (queue.current?.hasUnsavedChanges)
                setReloadDraft(queue.current.currentBody);
              else void reload();
            }}
          >
            重新加载文件
          </button>
        </Popover>
      )}
      {panel && (
        <Modal
          title={
            {
              more: "样品操作",
              data: "关联数据",
              claims: "关联论点",
              batch: "批量创建样品",
            }[panel]
          }
          close={() => setPanel(null)}
        >
          {panel === "more" && (
            <div className="propertyRows">
              <button disabled={busy} onClick={() => void copy(1)}>
                复制操作模板
              </button>
              <button onClick={openBatch}>批量创建</button>
              <button
                onClick={() => {
                  setPanel(null);
                  if (queue.current?.hasUnsavedChanges)
                    setReloadDraft(queue.current.currentBody);
                  else void reload();
                }}
              >
                重新加载文件
              </button>
            </div>
          )}
          {panel === "data" && (
            <div className="propertyRows">
              {linkedData.length ? (
                linkedData.map((item) => (
                  <button key={item.id} onClick={() => openData(item.id)}>
                    {item.name}
                  </button>
                ))
              ) : (
                <p>暂无关联数据。</p>
              )}
            </div>
          )}
          {panel === "claims" && (
            <div className="propertyRows">
              {linkedClaims.length ? (
                linkedClaims.map((item) => (
                  <button key={item.id} onClick={() => openClaim(item.id)}>
                    {item.text}
                  </button>
                ))
              ) : (
                <p>暂无正式论点。样品正文中的论点仅作文本保留。</p>
              )}
            </div>
          )}
        </Modal>
      )}
      {reloadDraft !== undefined && (
        <Modal
          title="正文尚未保存"
          close={() => setReloadDraft(undefined)}
          footer={
            <>
              <button
                className="ghost"
                onClick={() => void navigator.clipboard.writeText(reloadDraft)}
              >
                复制我的正文
              </button>
              <button className="primary" onClick={() => void reload()}>
                加载磁盘内容
              </button>
            </>
          }
        >
          <p>加载磁盘内容将替换当前编辑内容。可先复制未保存的正文。</p>
          <pre className="noteCode">{reloadDraft}</pre>
        </Modal>
      )}
      {recovery !== undefined && (
        <Modal
          title="发现未确认草稿"
          close={() => setRecovery(undefined)}
          footer={
            <>
              <button
                className="ghost"
                onClick={() => void navigator.clipboard.writeText(recovery)}
              >
                复制草稿
              </button>
              <button
                className="primary"
                onClick={() => {
                  bindings.current = recoveryBindings.current;
                  setDocument((current) =>
                    current
                      ? {
                          ...current,
                          body: recovery,
                          head: {
                            ...current.head,
                            references: bindings.current,
                          },
                        }
                      : current,
                  );
                  setEditorVersion((v) => v + 1);
                  queue.current?.change(recovery);
                  setRecovery(undefined);
                }}
              >
                继续编辑草稿
              </button>
            </>
          }
        >
          <p className="noteIntro">
            上次未确认保存的正文仍在本机。加载草稿后，保存仍会检查版本。
          </p>
          <pre className="noteCode">{recovery}</pre>
        </Modal>
      )}
      {history && (
        <HistoryDrawer id={id} close={closeHistory} notify={notify} />
      )}
      {identityBlock && (
        <Modal title="确认数据身份" close={() => setIdentityBlock(undefined)}>
          <p>
            这段数据的区块标记已改变。正文和有效属性已保存，尚未创建新的 Data。
          </p>
          <button
            className="addLink"
            onClick={() =>
              void navigator.clipboard.writeText(
                queue.current?.currentBody || "",
              )
            }
          >
            复制当前正文
          </button>
          <p className="noteIntro">
            关联已有 Data
            将加载它的当前内容；明确新建则使用当前文字。其他操作不变。
          </p>
          <div className="propertyRows">
            {[...data]
              .sort(
                (a, b) =>
                  Number(
                    document?.head.blocks[
                      identityBlock
                    ].candidateDataIds?.includes(b.id),
                  ) -
                  Number(
                    document?.head.blocks[
                      identityBlock
                    ].candidateDataIds?.includes(a.id),
                  ),
              )
              .map((datum) => (
                <button
                  key={datum.id}
                  onClick={() => void resolveIdentity(identityBlock, datum.id)}
                >
                  关联 {datum.name}
                </button>
              ))}
          </div>
          <button
            className="primary"
            onClick={() => void resolveIdentity(identityBlock)}
          >
            以当前文字新建独立 Data
          </button>
        </Modal>
      )}
      {dataConflict && (
        <Modal
          title="Data 两个入口存在冲突"
          close={() => setDataConflict(undefined)}
          footer={
            <>
              <button
                className="ghost"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    queue.current?.currentBody || "",
                  )
                }
              >
                复制我的正文
              </button>
              <button
                className="primary"
                onClick={() =>
                  void (async () => {
                    await queue.current?.flush();
                    const loaded = await request<Document>(
                      `/documents/${id}/data/${dataConflict}/load-latest`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          expectedVersion: queue.current?.confirmedVersion,
                        }),
                      },
                    );
                    queue.current?.acceptServer(
                      loaded.head.contentVersion,
                      loaded.body,
                    );
                    bindings.current = loaded.head.references || [];
                    setDocument(loaded);
                    setEditorVersion((version) => version + 1);
                    setDataConflict(undefined);
                    setPending(true);
                  })().catch((error) => notify(error.message))
                }
              >
                加载该 Data 最新内容
              </button>
            </>
          }
        >
          <p>
            已保留你的正文。加载最新内容只替换这个 Data
            的呈现，其他操作保持原样。
          </p>
        </Modal>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import type {
  AnalysisRecord,
  ClaimRecord,
  DataRecord,
  ResearchObject,
} from "@workbench/core";
import { request, type SampleRow } from "../api";
import { HistoryDrawer } from "../components/HistoryDrawer";
import { Modal } from "../components/Modal";
import { AnalysisArtifacts } from "../components/AnalysisArtifacts";
import { ClaimComposer } from "../components/ClaimComposer";
import { ResearchEditor } from "../editor/ResearchEditor";
import { usePendingUploads } from "../hooks/usePendingUploads";
import { useEntityDraft } from "../hooks/useEntityDraft";

export function AnalysisDetail({
  item,
  samples,
  data,
  claims,
  objects,
  openResource,
  openSample,
  openData,
  openClaim,
  back,
  refresh,
  notify,
  registerBarrier,
}: {
  item: AnalysisRecord;
  samples: SampleRow[];
  data: DataRecord[];
  claims: ClaimRecord[];
  objects: ResearchObject[];
  openResource: (id: string) => void;
  openSample: (id: string) => void;
  openData: (id: string) => void;
  openClaim: (id: string) => void;
  back: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  registerBarrier: (barrier: (() => Promise<void>) | null) => void;
}) {
  const uploads = usePendingUploads();
  const draft = useEntityDraft(item, `/analyses/${item.id}`, notify);
  const [panel, setPanel] = useState<
    "content" | "columns" | "layout" | "conflict" | null
  >(null);
  const [query, setQuery] = useState("");
  const hidden = draft.value.layout.hiddenColumns;
  const show = draft.value.layout.visibleSections;
  const changeLayout = (patch: Partial<AnalysisRecord["layout"]>) =>
    draft.change({ layout: { ...draft.value.layout, ...patch } });
  const [editorVersion, setEditorVersion] = useState(0);
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
  const selectedSamples = draft.value.itemIds.flatMap((id) =>
    samples.filter((sample) => sample.id === id),
  );
  const dataIds = new Set([
    ...draft.value.itemIds,
    ...selectedSamples.flatMap((sample) =>
      Object.values(sample.document?.head.blocks ?? {}).flatMap((binding) =>
        binding.dataId ? [binding.dataId] : [],
      ),
    ),
  ]);
  const selectedData = data.filter((row) => dataIds.has(row.id));
  const columns = [
    ...new Map(
      selectedSamples.flatMap((sample) =>
        sample.properties.map(
          (property) =>
            [
              `${property.object_id}:${property.property_id}`,
              property,
            ] as const,
        ),
      ),
    ).entries(),
  ];
  const orderedKeys = [
    ...new Set([
      ...draft.value.layout.columnOrder,
      ...columns.map(([key]) => key),
    ]),
  ];
  columns.sort(([a], [b]) => orderedKeys.indexOf(a) - orderedKeys.indexOf(b));
  const moveColumn = (key: string, direction: number) => {
    const order: string[] = columns.map(([id]) => id),
      index = order.indexOf(key),
      target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    changeLayout({ columnOrder: order });
  };
  const activeColumns = columns.filter(([key]) => !hidden.includes(key));
  const items = [
    ...samples.map((sample) => ({
      id: sample.id,
      name: sample.code,
      kind: "样品",
    })),
    ...data.map((row) => ({ id: row.id, name: row.name, kind: "数据" })),
    ...objects
      .filter((object) => object.role !== "sample")
      .map((object) => ({
        id: object.id,
        name: object.canonicalName,
        kind: "资源",
      })),
    ...claims.map((claim) => ({
      id: claim.id,
      name: claim.text,
      kind: "论点",
    })),
  ];
  const exportContext = async () => {
    try {
      await finish();
      const result = await request<{ context: string; manifest: unknown }>(
        `/analyses/${item.id}/export`,
      );
      for (const [name, content, mime] of [
        ["context.md", result.context, "text/markdown"],
        [
          "manifest.json",
          JSON.stringify(result.manifest, null, 2),
          "application/json",
        ],
      ]) {
        const url = URL.createObjectURL(new Blob([content], { type: mime }));
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      notify(String(error));
    }
  };
  const reorder = (id: string, direction: number) => {
    const ids = [...draft.value.itemIds],
      index = ids.indexOf(id),
      next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    draft.change({ itemIds: ids });
  };
  return (
    <section className="detailPage">
      <div className="detailTop">
        <button className="back" onClick={back}>
          ← 分析
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
            onClick={() =>
              void finish().catch((error) => notify(error.message))
            }
          >
            完成编辑
          </button>
          <button onClick={() => setPanel("conflict")}>•••</button>
        </div>
      </div>
      <div className="detailHero">
        <div className="eyebrow">{item.id}</div>
        <input
          className="analysisTitle"
          aria-label="分析标题"
          value={draft.value.title}
          onChange={(event) => draft.change({ title: event.target.value })}
        />
        <textarea
          className="analysisQuestion"
          aria-label="分析问题"
          placeholder="写下这个分析想回答的问题……"
          value={draft.value.question}
          onChange={(event) => draft.change({ question: event.target.value })}
        />
      </div>
      <div className="analysisToolbar">
        <button className="primary" onClick={() => setPanel("content")}>
          ＋ 添加内容
        </button>
        <button onClick={() => setPanel("content")}>筛选</button>
        <button onClick={() => setPanel("layout")}>布局</button>
        <button onClick={() => void exportContext()}>导出</button>
      </div>
      <div className="analysisGrid" id="analysisGrid">
        {show.includes("context") && (
          <section className="block">
            <div className="blockTitle">
              <span>上下文</span>
              <button onClick={() => setPanel("content")}>＋</button>
            </div>
            <div className="entityChips">
              {draft.value.itemIds.map((id) => {
                const sample = samples.find((row) => row.id === id),
                  datum = data.find((row) => row.id === id),
                  resource = objects.find((row) => row.id === id),
                  claim = claims.find((row) => row.id === id);
                return (
                  <button
                    key={id}
                    onClick={() =>
                      sample
                        ? openSample(id)
                        : datum
                          ? openData(id)
                          : resource
                            ? openResource(id)
                            : claim
                              ? openClaim(id)
                              : notify("条目暂不可用")
                    }
                  >
                    {sample
                      ? "◇ " + sample.code
                      : datum
                        ? "▥ " + datum.name
                        : resource
                          ? "⌘ " + resource.canonicalName
                          : claim
                            ? "◌ " + claim.text
                            : id}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {show.includes("compare") && (
          <section className="block span2">
            <div className="blockTitle">
              <span>参数比较</span>
              <button onClick={() => setPanel("columns")}>•••</button>
            </div>
            <table className="compareTable">
              <thead>
                <tr>
                  <th>样品</th>
                  {activeColumns.map(([key, property]) => (
                    <th key={key}>
                      {property.object_name} / {property.property_name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedSamples.map((sample) => (
                  <tr key={sample.id} onClick={() => openSample(sample.id)}>
                    <td>{sample.code}</td>
                    {activeColumns.map(([key]) => (
                      <td key={key}>
                        {sample.properties
                          .filter(
                            (property) =>
                              `${property.object_id}:${property.property_id}` ===
                              key,
                          )
                          .map((property) => property.value_text)
                          .join(" · ") || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {show.includes("data") && (
          <section className="block">
            <div className="blockTitle">
              <span>数据</span>
              <button onClick={() => setPanel("content")}>＋</button>
            </div>
            {selectedData.map((row) => (
              <button
                className="assetRow"
                key={row.id}
                onClick={() => openData(row.id)}
              >
                <div>
                  <b>{row.name}</b>
                  <small>
                    {row.componentIds.length ? "附件数据" : "描述"} ·{" "}
                    {row.aboutSampleIds
                      .map(
                        (id) =>
                          samples.find((sample) => sample.id === id)?.code ||
                          id,
                      )
                      .join(" · ")}
                  </small>
                </div>
                <span>↗</span>
              </button>
            ))}
          </section>
        )}
        {show.includes("artifacts") && (
          <AnalysisArtifacts
            trackUpload={uploads.track}
            ids={draft.value.attachmentIds}
            change={(attachmentIds) => draft.change({ attachmentIds })}
            notify={notify}
          />
        )}
        {show.includes("body") && (
          <section className="block">
            <div className="blockTitle">
              <span>分析记录与产物说明</span>
            </div>
            <ResearchEditor
              key={editorVersion}
              body={draft.value.body || "- "}
              label="分析正文"
              onChange={(body) => draft.change({ body })}
              onError={notify}
            />
          </section>
        )}
        {show.includes("claims") && (
          <div className="span2">
            <ClaimComposer
              hostType="analysis"
              hostId={item.id}
              claims={claims}
              open={openClaim}
              beforeCreate={finish}
              refresh={refresh}
              notify={notify}
            />
          </div>
        )}
      </div>
      {panel && (
        <Modal
          title={
            {
              content: "组织分析内容",
              columns: "比较属性",
              layout: "布局",
              conflict: "保存与重新加载",
            }[panel]
          }
          close={() => setPanel(null)}
          footer={
            <button
              className="primary"
              onClick={() =>
                void finish()
                  .then(() => setPanel(null))
                  .catch((error) => notify(error.message))
              }
            >
              完成
            </button>
          }
        >
          {panel === "content" && (
            <>
              <input
                className="searchInput"
                value={query}
                placeholder="搜索样品或数据"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="checkGrid">
                {items
                  .filter((row) => row.name.includes(query))
                  .map((row) => (
                    <label className="check" key={row.id}>
                      <input
                        type="checkbox"
                        checked={draft.value.itemIds.includes(row.id)}
                        onChange={() =>
                          draft.change({
                            itemIds: draft.value.itemIds.includes(row.id)
                              ? draft.value.itemIds.filter(
                                  (id) => id !== row.id,
                                )
                              : [...draft.value.itemIds, row.id],
                          })
                        }
                      />
                      {row.kind} · {row.name}
                    </label>
                  ))}
              </div>
              <div className="propertyRows">
                {draft.value.itemIds.map((id) => (
                  <div key={id}>
                    <span>
                      {items.find((row) => row.id === id)?.name || id}
                    </span>
                    <span>
                      <button onClick={() => reorder(id, -1)}>上移</button>
                      <button onClick={() => reorder(id, 1)}>下移</button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {panel === "columns" && (
            <div className="checkGrid">
              {columns.map(([key, property]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={!hidden.includes(key)}
                    onChange={() =>
                      changeLayout({
                        hiddenColumns: hidden.includes(key)
                          ? hidden.filter((value) => value !== key)
                          : [...hidden, key],
                      })
                    }
                  />
                  {property.object_name} / {property.property_name}
                </label>
              ))}
            </div>
          )}
          {panel === "columns" && (
            <div className="propertyRows">
              {columns.map(([key, property]) => (
                <div key={key}>
                  <span>
                    {property.object_name} / {property.property_name}
                  </span>
                  <span>
                    <button
                      aria-label={`${property.property_name}前移`}
                      onClick={() => moveColumn(key, -1)}
                    >
                      前移
                    </button>
                    <button
                      aria-label={`${property.property_name}后移`}
                      onClick={() => moveColumn(key, 1)}
                    >
                      后移
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {panel === "layout" && (
            <div className="checkGrid">
              {[
                ["context", "上下文"],
                ["compare", "参数比较"],
                ["data", "数据"],
                ["artifacts", "分析产物"],
                ["body", "分析记录"],
                ["claims", "论点"],
              ].map(([key, name]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={show.includes(key)}
                    onChange={() =>
                      changeLayout({
                        visibleSections: show.includes(key)
                          ? show.filter((value) => value !== key)
                          : [...show, key],
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
          {panel === "conflict" && (
            <>
              <p>先复制未保存正文，再加载最新版本。不会自动合并。</p>
              <button onClick={() => void draft.copy()}>复制我的内容</button>
              <button
                onClick={() =>
                  void draft
                    .reload()
                    .then(() => {
                      setEditorVersion((value) => value + 1);
                      setPanel(null);
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
                      setPanel(null);
                      setEditorVersion((value) => value + 1);
                    })
                    .catch((error) => notify(error.message))
                }
              >
                重新加载文件
              </button>
            </>
          )}
        </Modal>
      )}
      {draft.recovery && (
        <Modal title="发现未确认草稿" close={draft.dismissRecovery}>
          <button
            onClick={() => {
              draft.recover();
              setEditorVersion((value) => value + 1);
            }}
          >
            继续草稿
          </button>
          <button
            onClick={() => void navigator.clipboard.writeText(draft.recovery!)}
          >
            复制草稿
          </button>
        </Modal>
      )}
      {history && (
        <HistoryDrawer id={item.id} close={closeHistory} notify={notify} />
      )}
    </section>
  );
}

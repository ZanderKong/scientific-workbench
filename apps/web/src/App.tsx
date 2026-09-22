import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnalysisRecord,
  ClaimRecord,
  DataRecord,
  PropertyDefinition,
  ResearchObject,
} from "@workbench/core";
import { request, type SampleRow } from "./api";
import { Shell, type Navigation } from "./components/Shell";
import { Modal } from "./components/Modal";
import { SamplesPage } from "./pages/SamplesPage";
import { SampleDocument } from "./pages/SampleDocument";
import { AnalysisList } from "./pages/AnalysisList";
import { DataList } from "./pages/DataList";
import { ClaimList } from "./pages/ClaimList";
import { DataDetail } from "./pages/DataDetail";
import { AnalysisDetail } from "./pages/AnalysisDetail";
import { ClaimDetail } from "./pages/ClaimDetail";
import { ResourcesPage } from "./pages/ResourcesPage";
import { SettingsPanel } from "./pages/SettingsPanel";
import { TaskStack } from "./components/TaskStack";

import { BatchSamplesPage } from "./pages/BatchSamplesPage";

interface Page {
  section: Navigation;
  id?: string;
  blockId?: string;
  batch?: boolean;
}
interface Workspace {
  samples: SampleRow[];
  data: (DataRecord & { body: string })[];
  analyses: AnalysisRecord[];
  claims: ClaimRecord[];
  objects: ResearchObject[];
  properties: PropertyDefinition[];
}
const empty: Workspace = {
  samples: [],
  data: [],
  analyses: [],
  claims: [],
  objects: [],
  properties: [],
};

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>(empty);
  const [page, setPage] = useState<Page>({ section: "samples" });
  const trail = useRef<Page[]>([]);
  const [notice, setNotice] = useState("");
  const [saveStatus, setSaveStatus] = useState("本地工作区");
  const [dialog, setDialog] = useState<"help" | "settings" | "search" | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const barrier = useRef<(() => Promise<void>) | null>(null);
  const registerBarrier = useCallback((next: (() => Promise<void>) | null) => {
    barrier.current = next;
  }, []);
  const navigate = (next: Page) => {
    void (async () => {
      if (barrier.current) await barrier.current();
      trail.current.push(page);
      setPage(next);
    })().catch((error) => setNotice(error.message));
  };
  const closeDialog = useCallback(() => setDialog(null), []);
  const refresh = useCallback(async () => {
    const [samples, data, analyses, claims, objects, properties] =
      await Promise.all([
        request<SampleRow[]>("/samples"),
        request<Workspace["data"]>("/data"),
        request<AnalysisRecord[]>("/analyses"),
        request<ClaimRecord[]>("/claims"),
        request<ResearchObject[]>("/objects"),
        request<PropertyDefinition[]>("/properties"),
      ]);
    setWorkspace({ samples, data, analyses, claims, objects, properties });
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
  }, [refresh]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog("search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const run = (task: () => Promise<void>) => {
    void task().catch((error) => setNotice(error.message));
  };
  const create = (section: Navigation, itemIds: string[] = []) =>
    run(async () => {
      const path =
        section === "samples"
          ? "/samples"
          : section === "data"
            ? "/data"
            : "/analyses";
      const body =
        section === "samples"
          ? {}
          : section === "data"
            ? { name: "未命名数据" }
            : { title: "新分析", itemIds };
      const entity = await request<{ id: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      await refresh();
      trail.current.push(page);
      setPage({ section, id: entity.id });
    });
  const exportSamples = (ids: string[]) =>
    run(async () => {
      const documents = await Promise.all(
        ids.map((id) =>
          request<{ document: { body: string }; code: string }>(
            `/samples/${id}`,
          ),
        ),
      );
      const blob = new Blob(
        [
          documents
            .map((d) => `# ${d.code}\n\n${d.document.body}`)
            .join("\n\n"),
        ],
        { type: "text/markdown" },
      );
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "samples.md";
      link.click();
      URL.revokeObjectURL(url);
    });
  const back = () =>
    run(async () => {
      if (barrier.current) await barrier.current();
      setPage(trail.current.pop() || { section: page.section });
    });
  const detailData = workspace.data.find((item) => item.id === page.id);
  const detailAnalysis = workspace.analyses.find((item) => item.id === page.id);
  const detailClaim = workspace.claims.find((item) => item.id === page.id);
  return (
    <Shell
      active={page.section}
      navigate={(section) => navigate({ section })}
      search={() => setDialog("search")}
      settings={() =>
        run(async () => {
          if (barrier.current) await barrier.current();
          setDialog("settings");
        })
      }
      help={() => setDialog("help")}
      status={saveStatus}
    >
      {page.section === "samples" && !page.id && (
        <SamplesPage
          rows={workspace.samples}
          create={() => create("samples")}
          open={(id, blockId) => navigate({ section: "samples", id, blockId })}
          analysis={(ids) => create("analysis", ids)}
          exportRows={exportSamples}
        />
      )}
      {page.section === "samples" && page.id && !page.batch && (
        <SampleDocument
          key={page.id}
          id={page.id}
          back={back}
          refresh={refresh}
          notify={setNotice}
          registerBarrier={registerBarrier}
          focusBlock={page.blockId}
          data={workspace.data}
          claims={workspace.claims}
          openData={(id) => navigate({ section: "data", id })}
          openClaim={(id) => navigate({ section: "claims", id })}
          openBatch={() =>
            navigate({ section: "samples", id: page.id, batch: true })
          }
          openCopy={(id) => navigate({ section: "samples", id })}
        />
      )}
      {page.section === "samples" && page.id && page.batch && (
        <BatchSamplesPage
          sourceId={page.id}
          back={back}
          notify={setNotice}
          created={async (id) => {
            await refresh();
            navigate({ section: "samples", id });
          }}
        />
      )}
      {page.section === "data" && !page.id && (
        <DataList
          rows={workspace.data}
          samples={workspace.samples}
          open={(id) => navigate({ section: "data", id })}
          create={() => create("data")}
          analysis={(ids) => create("analysis", ids)}
          exportRows={(ids) =>
            run(async () => {
              const rows = await Promise.all(
                ids.map((id) =>
                  request<DataRecord & { body: string }>(`/data/${id}`),
                ),
              );
              const url = URL.createObjectURL(
                new Blob(
                  [
                    rows
                      .map((row) => `# ${row.name}\n\n${row.body}`)
                      .join("\n\n"),
                  ],
                  { type: "text/markdown" },
                ),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "data.md";
              link.click();
              URL.revokeObjectURL(url);
            })
          }
        />
      )}
      {detailData && page.section === "data" && (
        <DataDetail
          key={detailData.id}
          item={detailData}
          samples={workspace.samples}
          back={back}
          refresh={refresh}
          notify={setNotice}
          claims={workspace.claims}
          registerBarrier={registerBarrier}
          openSample={(id, blockId) =>
            navigate({ section: "samples", id, blockId })
          }
          openClaim={(id) => navigate({ section: "claims", id })}
        />
      )}
      {page.section === "analysis" && !page.id && (
        <AnalysisList
          rows={workspace.analyses}
          samples={workspace.samples}
          data={workspace.data}
          claims={workspace.claims}
          open={(id) => navigate({ section: "analysis", id })}
          create={() => create("analysis")}
        />
      )}
      {detailAnalysis && page.section === "analysis" && (
        <AnalysisDetail
          objects={workspace.objects}
          openResource={(id) => navigate({ section: "resources", id })}
          key={detailAnalysis.id}
          item={detailAnalysis}
          samples={workspace.samples}
          data={workspace.data}
          back={back}
          refresh={refresh}
          notify={setNotice}
          claims={workspace.claims}
          openSample={(id) => navigate({ section: "samples", id })}
          openData={(id) => navigate({ section: "data", id })}
          openClaim={(id) => navigate({ section: "claims", id })}
          registerBarrier={registerBarrier}
        />
      )}
      {page.section === "claims" && !page.id && (
        <ClaimList
          rows={workspace.claims}
          data={workspace.data}
          analyses={workspace.analyses}
          open={(id) => navigate({ section: "claims", id })}
        />
      )}
      {detailClaim && page.section === "claims" && (
        <ClaimDetail
          key={detailClaim.id}
          item={detailClaim}
          openSample={(id) => navigate({ section: "samples", id })}
          back={back}
          refresh={refresh}
          notify={setNotice}
          data={workspace.data}
          analyses={workspace.analyses}
          openHost={(section, id) => navigate({ section, id })}
          registerBarrier={registerBarrier}
        />
      )}
      {page.section === "resources" && (
        <ResourcesPage
          key={page.id || "resources"}
          initialId={page.id}
          back={back}
          objects={workspace.objects}
          properties={workspace.properties}
          samples={workspace.samples}
          refresh={refresh}
          notify={setNotice}
          openSample={(id) => navigate({ section: "samples", id })}
        />
      )}
      {notice && (
        <div role="status" className="errorNotice">
          {notice}
          <button onClick={() => setNotice("")}>×</button>
        </div>
      )}
      <TaskStack refreshSamples={refresh} />
      {dialog && (
        <Modal
          title={
            { help: "快捷说明", settings: "设置", search: "全局搜索" }[dialog]
          }
          close={closeDialog}
        >
          {dialog === "help" && (
            <div className="propertyRows">
              <div>
                <span>[对象]</span>
                <b>引用原料 / 设备 / 过程 / 样品</b>
              </div>
              <div>
                <span>｜属性：值</span>
                <b>文本属性，完成编辑后提取</b>
              </div>
              <div>
                <span>[数据]</span>
                <b>数据记录，子级可附文件</b>
              </div>
              <div>
                <span>[论点]</span>
                <b>样品中仅文字；Data/分析中正式创建</b>
              </div>
            </div>
          )}
          {dialog === "settings" && <SettingsPanel notify={setNotice} />}
          {dialog === "search" && (
            <>
              <input
                className="searchInput"
                value={query}
                aria-label="全局搜索"
                autoFocus
                data-initial-focus
                placeholder="搜索样品、数据、分析、论点或资源"
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="searchResults">
                {[
                  ...workspace.samples.map((s) => ({
                    id: s.id,
                    name: s.code,
                    section: "samples" as const,
                  })),
                  ...workspace.data.map((d) => ({
                    id: d.id,
                    name: d.name,
                    section: "data" as const,
                  })),
                  ...workspace.analyses.map((a) => ({
                    id: a.id,
                    name: a.title,
                    section: "analysis" as const,
                  })),
                  ...workspace.claims.map((c) => ({
                    id: c.id,
                    name: c.text,
                    section: "claims" as const,
                  })),
                ]
                  .filter((result) =>
                    result.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((result) => (
                    <button
                      className="result"
                      key={result.id}
                      onClick={() => {
                        navigate({ section: result.section, id: result.id });
                        closeDialog();
                      }}
                    >
                      <span className="resultType">{result.section}</span>
                      <b>{result.name}</b>
                    </button>
                  ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </Shell>
  );
}

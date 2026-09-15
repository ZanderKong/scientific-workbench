import { useCallback, useState } from "react";
import { Modal } from "./Modal";

export function useListTools(columns: string[], withView = true) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"table" | "cards">("table");
  const [ascending, setAscending] = useState(false);
  const [sortColumn, setSortColumn] = useState(0);
  const [sorting, setSorting] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [dialog, setDialog] = useState<
    "搜索" | "筛选" | "排序" | "属性" | null
  >(null);
  const close = useCallback(() => setDialog(null), []);
  const visible = (column: string) => !hidden.includes(column);
  const matches = (values: string[]) =>
    values.some((value) => value.toLowerCase().includes(query.toLowerCase()));
  const compare = (a: string[], b: string[]) =>
    sorting
      ? (a[sortColumn] || "").localeCompare(b[sortColumn] || "", "zh-CN") *
        (ascending ? 1 : -1)
      : 0;
  return {
    mode,
    query,
    visible,
    matches,
    compare,
    toolbar: (
      <div className="toolbar">
        <div className="toolbarLeft">
          <button className="searchPseudo" onClick={() => setDialog("搜索")}>
            搜索{query ? `：${query}` : ""}
          </button>
          {(["筛选", "排序", "属性"] as const).map((name) => (
            <button key={name} onClick={() => setDialog(name)}>
              {name}
            </button>
          ))}
        </div>
        {withView && (
          <div className="segmented">
            <button
              className={mode === "table" ? "active" : ""}
              onClick={() => setMode("table")}
            >
              表格
            </button>
            <button
              className={mode === "cards" ? "active" : ""}
              onClick={() => setMode("cards")}
            >
              卡片
            </button>
          </div>
        )}
      </div>
    ),
    panel: dialog && (
      <Modal title={dialog} close={close}>
        {(dialog === "搜索" || dialog === "筛选") && (
          <>
            <label>
              包含文字
              <input
                className="searchInput"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button className="addLink" onClick={() => setQuery("")}>
              清除条件
            </button>
          </>
        )}
        {dialog === "排序" && (
          <>
            <label>
              排序列
              <select
                value={sortColumn}
                onChange={(event) => {
                  setSorting(true);
                  setSortColumn(Number(event.target.value));
                }}
              >
                {columns.map((column, index) => (
                  <option value={index} key={column}>
                    {column}
                  </option>
                ))}
              </select>
            </label>
            <label>
              顺序
              <select
                value={ascending ? "asc" : "desc"}
                onChange={(event) => {
                  setSorting(true);
                  setAscending(event.target.value === "asc");
                }}
              >
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </label>
          </>
        )}
        {dialog === "属性" && (
          <div className="columnChecks">
            {columns.map((column) => (
              <label key={column}>
                <input
                  type="checkbox"
                  checked={visible(column)}
                  onChange={() =>
                    setHidden((current) =>
                      current.includes(column)
                        ? current.filter((value) => value !== column)
                        : [...current, column],
                    )
                  }
                />
                {column}
              </label>
            ))}
          </div>
        )}
      </Modal>
    ),
  };
}

export function ListHeader({
  title,
  description,
  create,
  createLabel,
}: {
  title: string;
  description: string;
  create?: () => void;
  createLabel?: string;
}) {
  return (
    <div className="pageHeader">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="pageHeaderActions">
        {new URLSearchParams(location.search).has("acceptance") && (
          <button className="designNoteBtn" disabled>
            ⓘ 设计说明
          </button>
        )}
        {create && (
          <button className="primary" onClick={create}>
            ＋ {createLabel}
          </button>
        )}
      </div>
    </div>
  );
}

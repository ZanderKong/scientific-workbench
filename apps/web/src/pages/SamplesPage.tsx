import { useMemo, useState, useCallback } from "react";
import type { SampleRow, SampleProperty } from "../api";
import { Modal } from "../components/Modal";

interface Column {
  key: string;
  object: string;
  property: string;
}
interface Preferences {
  order: string[];
  hidden: string[];
  mode: "table" | "cards";
  sort: string;
  direction: "asc" | "desc";
}
const initial: Preferences = {
  order: [],
  hidden: [],
  mode: "table",
  sort: "createdAt",
  direction: "desc",
};
const columnKey = (property: SampleProperty) =>
  `${property.object_id}:${property.property_id}`;

export function SamplesPage({
  rows,
  create,
  open,
  analysis,
  exportRows,
}: {
  rows: SampleRow[];
  create: () => void;
  open: (id: string, blockId?: string) => void;
  analysis: (ids: string[]) => void;
  exportRows: (ids: string[]) => void;
}) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      return {
        ...initial,
        ...JSON.parse(localStorage.getItem("swb.samples.layout.v1") || "{}"),
      };
    } catch {
      return initial;
    }
  });
  const update = (next: Partial<Preferences>) =>
    setPreferences((current) => {
      const result = { ...current, ...next };
      localStorage.setItem("swb.samples.layout.v1", JSON.stringify(result));
      return result;
    });
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<
    "search" | "filter" | "sort" | "columns" | "note" | null
  >(null);
  const close = useCallback(() => setDialog(null), []);
  const [dragged, setDragged] = useState<string>();
  const columns = useMemo(() => {
    const found = new Map<string, Column>();
    rows.forEach((row) =>
      row.properties.forEach((p) =>
        found.set(columnKey(p), {
          key: columnKey(p),
          object: p.object_name,
          property: p.property_name,
        }),
      ),
    );
    return [
      ...preferences.order.filter((key) => found.has(key)),
      ...[...found.keys()].filter((key) => !preferences.order.includes(key)),
    ].map((key) => found.get(key)!);
  }, [rows, preferences.order]);
  const visible = columns.filter(
    (column) => !preferences.hidden.includes(column.key),
  );
  const value = (row: SampleRow, key: string) =>
    row.properties
      .filter((p) => columnKey(p) === key)
      .map((p) => p.value_text)
      .join(" · ");
  const shown = rows
    .filter((row) => {
      const text =
        `${row.code} ${row.title} ${row.properties.map((p) => `${p.object_name} ${p.property_name} ${p.value_text}`).join(" ")}`.toLowerCase();
      return (
        text.includes(query.toLowerCase()) &&
        text.includes(filter.toLowerCase())
      );
    })
    .sort((a, b) => {
      const field = (row: SampleRow) =>
        preferences.sort === "id"
          ? row.code
          : preferences.sort === "createdAt"
            ? row.createdAt
            : value(row, preferences.sort);
      return (
        field(a).localeCompare(field(b), "zh-CN") *
        (preferences.direction === "asc" ? 1 : -1)
      );
    });
  const sort = (key: string) =>
    update({
      sort: key,
      direction:
        preferences.sort === key && preferences.direction === "asc"
          ? "desc"
          : "asc",
    });
  const marker = (key: string) =>
    preferences.sort === key ? (
      <span className="sortMark">
        {preferences.direction === "asc" ? "↑" : "↓"}
      </span>
    ) : null;
  const acceptance =
    new URLSearchParams(location.search).get("acceptance") === "1";
  return (
    <section className="page">
      <div className="pageHeader">
        <div>
          <h1>样品</h1>
          <p>一个样品对应一个文档；编号就是文档标题。默认按创建时间倒序。</p>
        </div>
        <div className="pageHeaderActions">
          {acceptance && (
            <button className="designNoteBtn" onClick={() => setDialog("note")}>
              ⓘ 设计说明
            </button>
          )}
          <button className="primary" onClick={create}>
            ＋ 新建样品
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="toolbarLeft">
          <button
            className="searchPseudo"
            onClick={() => {
              setDraftQuery(query);
              setDialog("search");
            }}
          >
            搜索
          </button>
          <button onClick={() => setDialog("filter")}>筛选</button>
          <button onClick={() => setDialog("sort")}>排序</button>
          <button onClick={() => setDialog("columns")}>属性</button>
        </div>
        <div className="segmented">
          <button
            className={preferences.mode === "table" ? "active" : ""}
            onClick={() => update({ mode: "table" })}
          >
            表格
          </button>
          <button
            className={preferences.mode === "cards" ? "active" : ""}
            onClick={() => update({ mode: "cards" })}
          >
            卡片
          </button>
        </div>
      </div>
      {selected.length > 0 && (
        <div className="bulkBar">
          <strong>已选择 {selected.length} 个样品</strong>
          <button onClick={() => analysis(selected)}>新建分析</button>
          <button onClick={() => exportRows(selected)}>导出</button>
          <button onClick={() => setSelected([])}>取消选择</button>
        </div>
      )}
      {shown.length === 0 ? (
        <div className="emptyState">
          <b>没有匹配的样品</b>
          <p>调整搜索或筛选条件。</p>
        </div>
      ) : preferences.mode === "cards" ? (
        <div className="cards">
          {shown.map((row) => (
            <button className="card" key={row.id} onClick={() => open(row.id)}>
              <div className="cardTop">
                <b>{row.code}</b>
                <span className="muted">{row.createdAt}</span>
              </div>
              <div className="miniProps" style={{ marginTop: 18 }}>
                {visible.slice(0, 3).map((column) => (
                  <span key={column.key}>
                    {column.object} {column.property}{" "}
                    {value(row, column.key) || "—"}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div
          className={`tableWrap ${selected.length ? "hasSelection" : ""}`}
          id="sampleTableWrap"
        >
          <table>
            <thead>
              <tr>
                <th className="selectCol" />
                <th className="subHead centerHead" onClick={() => sort("id")}>
                  编号{marker("id")}
                </th>
                {visible.map((column) => (
                  <th
                    key={column.key}
                    className="singlePropHead"
                    draggable
                    onDragStart={() => setDragged(column.key)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!dragged || dragged === column.key) return;
                      const order = columns
                        .map((c) => c.key)
                        .filter((key) => key !== dragged);
                      order.splice(order.indexOf(column.key), 0, dragged);
                      update({ order });
                      setDragged(undefined);
                    }}
                    onClick={() => sort(column.key)}
                    title={`${column.object} · ${column.property}`}
                  >
                    <span
                      className="objToken longObjToken"
                      title={column.object}
                    >
                      {column.object}
                    </span>
                    <span
                      className="propText longPropText"
                      title={column.property}
                    >
                      {column.property}
                    </span>
                    {marker(column.key)}
                  </th>
                ))}
                <th
                  className="subHead centerHead"
                  onClick={() => sort("createdAt")}
                >
                  创建时间{marker("createdAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr className="dbRow" key={row.id} onClick={() => open(row.id)}>
                  <td
                    className="selectCol centerCell"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      aria-label={`选择 ${row.code}`}
                      className="rowCheck"
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, row.id]
                            : current.filter((id) => id !== row.id),
                        )
                      }
                    />
                  </td>
                  <td className="primaryCell centerCell">{row.code}</td>
                  {visible.map((column) => (
                    <td
                      className="centerCell"
                      key={column.key}
                      onClick={(event) => {
                        event.stopPropagation();
                        open(
                          row.id,
                          row.properties.find(
                            (p) => columnKey(p) === column.key,
                          )?.block_id,
                        );
                      }}
                    >
                      {value(row, column.key) || "—"}
                    </td>
                  ))}
                  <td className="muted centerCell">{row.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <Modal
          title={
            {
              search: "搜索当前列表",
              filter: "筛选样品",
              sort: "排序",
              columns: "显示属性",
              note: "样品数据库设计说明",
            }[dialog]
          }
          close={close}
          footer={
            <button
              className="primary"
              onClick={() => {
                if (dialog === "search") setQuery(draftQuery);
                close();
              }}
            >
              确定
            </button>
          }
        >
          {dialog === "search" && (
            <div className="field">
              <label>关键词</label>
              <input
                aria-label="关键词"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
              />
              <button
                className="ghost"
                onClick={() => {
                  setQuery("");
                  setDraftQuery("");
                  close();
                }}
              >
                清除
              </button>
            </div>
          )}
          {dialog === "filter" && (
            <div className="field">
              <label>属性或正文提取值包含</label>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            </div>
          )}
          {dialog === "sort" && (
            <div className="field">
              <label>排序字段</label>
              <select
                value={preferences.sort}
                onChange={(event) => update({ sort: event.target.value })}
              >
                <option value="createdAt">创建时间</option>
                <option value="id">编号</option>
                {columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.object} / {c.property}
                  </option>
                ))}
              </select>
              <select
                value={preferences.direction}
                onChange={(event) =>
                  update({ direction: event.target.value as "asc" | "desc" })
                }
              >
                <option value="asc">升序</option>
                <option value="desc">降序</option>
              </select>
            </div>
          )}
          {dialog === "columns" && (
            <div className="checkGrid">
              {columns.map((c) => (
                <label className="check" key={c.key}>
                  <input
                    type="checkbox"
                    checked={!preferences.hidden.includes(c.key)}
                    onChange={(event) =>
                      update({
                        hidden: event.target.checked
                          ? preferences.hidden.filter((key) => key !== c.key)
                          : [...preferences.hidden, c.key],
                      })
                    }
                  />
                  {c.object} / {c.property}
                </label>
              ))}
            </div>
          )}
          {dialog === "note" && (
            <p className="noteIntro">
              列来自对象与属性组合，显示样品的实际文本属性；点击值定位来源操作。多值并列，不做数值聚合。
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}

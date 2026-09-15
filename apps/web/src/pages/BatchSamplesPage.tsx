import { useEffect, useState } from "react";
import { request, type SampleRow } from "../api";
interface Row {
  key: string;
  code: string;
  values: Record<string, string>;
}
export function BatchSamplesPage({
  sourceId,
  back,
  created,
  notify,
}: {
  sourceId: string;
  back: () => void;
  created: (id: string) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [source, setSource] = useState<SampleRow>();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const newRow = (sample: SampleRow): Row => ({
    key: crypto.randomUUID(),
    code: "",
    values: Object.fromEntries(
      sample.properties.map((property) => [property.id, property.value_text]),
    ),
  });
  useEffect(() => {
    let active = true;
    void request<SampleRow>(`/samples/${sourceId}?latest=true`)
      .then((sample) => {
        if (active) {
          setSource(sample);
          setRows(Array.from({ length: 3 }, () => newRow(sample)));
        }
      })
      .catch((error) => notify(error.message));
    return () => {
      active = false;
    };
  }, [sourceId]);
  const change = (key: string, patch: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  const submit = async () => {
    if (!source || busy) return;
    setBusy(true);
    try {
      const result = await request<SampleRow[]>("/samples/batch", {
        method: "POST",
        body: JSON.stringify({
          templateId: sourceId,
          expectedVersion: source.contentVersion,
          rows: rows.map(({ code, values }) => ({ code, values })),
        }),
      });
      await created(result[0].id);
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="batchPage">
      <div className="batchHero">
        <div>
          <button className="back" onClick={back}>
            ← {source?.code || "样品"}
          </button>
          <h1>批量新建样品</h1>
          <p>
            以 {source?.code} 的文档结构为模板。每一行会生成一个独立 Sample +
            Document；这里快速修改结构化属性值。
          </p>
        </div>
        <div className="batchActions">
          <button className="ghost" disabled={busy} onClick={back}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || !rows.length}
            onClick={() => void submit()}
          >
            {busy ? "创建中…" : `创建 ${rows.length} 个样品`}
          </button>
        </div>
      </div>
      <div className="templateNote">
        <span>模板</span>
        <b>{source?.code}</b>
        <span>
          · 复制文档结构和对象引用；不复制
          Data、附件和论点结果。原样品不受影响。
        </span>
      </div>
      <div className="batchTableWrap">
        <table className="batchTable">
          <thead>
            <tr>
              <th>#</th>
              <th>样品编号</th>
              {source?.properties.map((property) => (
                <th
                  key={property.id}
                  title={`${property.object_name} · ${property.property_name}（来源行 ${property.source_line}）`}
                >
                  <span className="truncateHead">
                    {property.object_name} · {property.property_name}
                  </span>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td className="rowNumber">{index + 1}</td>
                <td>
                  <input
                    className="batchInput"
                    aria-label={`第 ${index + 1} 行编号`}
                    placeholder="自动编号"
                    value={row.code}
                    onChange={(event) =>
                      change(row.key, { code: event.target.value })
                    }
                  />
                </td>
                {source?.properties.map((property) => (
                  <td key={property.id}>
                    <input
                      className="batchInput"
                      aria-label={`第 ${index + 1} 行 ${property.object_name} ${property.property_name}`}
                      value={row.values[property.id]}
                      onChange={(event) =>
                        change(row.key, {
                          values: {
                            ...row.values,
                            [property.id]: event.target.value,
                          },
                        })
                      }
                    />
                  </td>
                ))}
                <td>
                  <button
                    className="ghost"
                    disabled={busy}
                    onClick={() =>
                      setRows((current) =>
                        current.filter((item) => item.key !== row.key),
                      )
                    }
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="batchAddRow">
        <button
          className="ghost"
          disabled={!source || busy || rows.length >= 100}
          onClick={() =>
            source && setRows((current) => [...current, newRow(source)])
          }
        >
          ＋ 添加一行
        </button>
      </div>
    </section>
  );
}

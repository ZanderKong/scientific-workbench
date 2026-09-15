import { claimPresentation } from "../claim-presentation";
import type { ClaimRecord, AnalysisRecord, DataRecord } from "@workbench/core";
import { ListHeader, useListTools } from "../components/ListTools";
const columns = ["编号", "论点", "状态", "证据", "上下文"];
export function ClaimList({
  rows,
  data,
  analyses,
  open,
}: {
  rows: ClaimRecord[];
  data: DataRecord[];
  analyses: AnalysisRecord[];
  open: (id: string) => void;
}) {
  const tools = useListTools(columns);
  const mapped = rows.map((row) => ({
    row,
    values: [
      row.id,
      claimPresentation(row.text).title,
      claimPresentation(row.text).status,
      String(row.evidence.length),
      row.hostType === "data"
        ? data.find((item) => item.id === row.hostId)?.name || row.hostId
        : analyses.find((item) => item.id === row.hostId)?.title || row.hostId,
    ],
  }));
  const filtered = mapped
    .filter((item) => tools.matches(item.values))
    .sort((a, b) => tools.compare(a.values, b.values));
  return (
    <section className="page">
      <ListHeader
        title="论点"
        description="从数据与分析中形成的判断、解释、主张与待验证假设。"
      />
      {tools.toolbar}
      {tools.mode === "cards" ? (
        <div className="analysisCards">
          {filtered.map(({ row, values }) => (
            <button
              className="analysisCard"
              key={row.id}
              onClick={() => open(row.id)}
            >
              <div className="eyebrow">{row.id}</div>
              <h3>{claimPresentation(row.text).title}</h3>
              <div className="cardStats">
                <span>{values[3]} 份证据快照</span>
                <span>{values[4]}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                {columns.filter(tools.visible).map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ row, values }) => (
                <tr key={row.id} onClick={() => open(row.id)}>
                  {values.map(
                    (value, index) =>
                      tools.visible(columns[index]) && (
                        <td
                          key={columns[index]}
                          className={
                            index === 1
                              ? "primaryCell"
                              : index === 0
                                ? "muted"
                                : ""
                          }
                        >
                          {index === 2 ? (
                            <span className="status">{value}</span>
                          ) : (
                            value
                          )}
                        </td>
                      ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!filtered.length && (
        <div className="empty">暂无正式论点，请在数据或分析页面创建</div>
      )}
      {tools.panel}
    </section>
  );
}

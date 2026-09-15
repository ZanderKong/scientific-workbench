import type { AnalysisRecord, ClaimRecord, DataRecord } from '@workbench/core';
import type { SampleRow } from '../api';
import { ListHeader, useListTools } from '../components/ListTools';
const columns = ['编号', '标题', '样品', '数据', '论点', '更新'];
export function AnalysisList({ rows, samples, data, claims, open, create }: {
  rows: AnalysisRecord[]; samples: SampleRow[]; data: DataRecord[]; claims: ClaimRecord[]; open: (id: string) => void; create: () => void;
}) {
  const tools = useListTools(columns);
  const mapped = rows.map(row => ({ row, values: [row.id, row.title,
    String(samples.filter(sample => row.itemIds.includes(sample.id)).length),
    String(data.filter(item => row.itemIds.includes(item.id)).length),
    String(claims.filter(claim => claim.hostType === 'analysis' && claim.hostId === row.id).length), row.updatedAt.slice(0, 10)] }));
  const filtered = mapped.filter(item => tools.matches(item.values)).sort((a, b) => tools.compare(a.values, b.values));
  return <section className="page"><ListHeader title="分析" description="保存一个科研分析上下文，把任意样品、数据、资源和论点组织到一起查看、比较与解释。" create={create} createLabel="新建分析"/>{tools.toolbar}
    {tools.mode === 'cards' ? <div className="analysisCards">{filtered.map(({ row, values }) => <button className="analysisCard" key={row.id} onClick={() => open(row.id)}><div className="eyebrow">{row.id} · {values[5]}</div><h3>{row.title}</h3><div className="cardStats"><span><b>{values[2]}</b> 样品</span><span><b>{values[3]}</b> 数据</span><span><b>{values[4]}</b> 论点</span></div></button>)}</div> : <div className="tableWrap"><table><thead><tr>{columns.filter(tools.visible).map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{filtered.map(({ row, values }) => <tr key={row.id} onClick={() => open(row.id)}>{values.map((value, index) => tools.visible(columns[index]) && <td key={columns[index]} className={index === 1 ? 'primaryCell' : index === 0 || index === 5 ? 'muted' : ''}>{value}</td>)}</tr>)}</tbody></table></div>}
    {!filtered.length && <div className="empty">暂无分析</div>}{tools.panel}
  </section>;
}

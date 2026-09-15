import { useState } from 'react';
import type { DataRecord } from '@workbench/core';
import type { SampleRow } from '../api';
import { ListHeader, useListTools } from '../components/ListTools';
const columns = ['编号', '名称', '类型', '关于', '来源', '更新'];
export function DataList({ rows, samples, open, create, analysis, exportRows }: {
  rows: DataRecord[]; samples: SampleRow[]; open: (id: string) => void; create: () => void; analysis: (ids: string[]) => void; exportRows: (ids: string[]) => void;
}) {
  const tools = useListTools(columns);
  const [selected, setSelected] = useState<string[]>([]);
  const mapped = rows.map(row => ({ row, values: [row.id, row.name, row.componentIds.length ? '附件数据' : '描述',
    row.aboutSampleIds.map(id => samples.find(sample => sample.id === id)?.code || id).join(' · ') || '—',
    row.sourceDocumentId ? '样品操作' : '独立导入', row.updatedAt.slice(0, 10)] }));
  const filtered = mapped.filter(item => tools.matches(item.values)).sort((a, b) => tools.compare(a.values, b.values));
  return <section className="page"><ListHeader title="数据" description="描述性记录、曲线、图片、附件和其他可独立引用的科研数据资产。" create={create} createLabel="导入数据"/>{tools.toolbar}
    {selected.length > 0 && <div className="bulkBar"><strong>已选择 {selected.length} 个数据</strong><button onClick={() => analysis(selected)}>新建分析</button><button onClick={() => exportRows(selected)}>导出</button><button onClick={() => setSelected([])}>取消选择</button></div>}
    {tools.mode === 'cards' ? <div className="analysisCards">{filtered.map(({ row, values }) => <button className="analysisCard" key={row.id} onClick={() => open(row.id)}><div className="eyebrow">{row.id}</div><h3>{row.name}</h3><div className="cardStats"><span>{values[2]}</span><span>{values[3]}</span></div></button>)}</div> : <div className={`tableWrap ${selected.length ? 'hasDataSelection' : ''}`}><table><thead><tr><th className="selectCol"/>{columns.filter(tools.visible).map(column => <th className="centerHead" key={column}>{column}</th>)}</tr></thead><tbody>{filtered.map(({ row, values }) => <tr className="dataDbRow" key={row.id} onClick={() => open(row.id)}><td className="selectCol centerCell" onClick={event => event.stopPropagation()}><input className="dataRowCheck" type="checkbox" aria-label={`选择 ${row.name}`} checked={selected.includes(row.id)} onChange={() => setSelected(current => current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])}/></td>{values.map((value, index) => tools.visible(columns[index]) && <td key={columns[index]} className={`centerCell ${index === 1 ? 'primaryCell' : index === 0 || index === 5 ? 'muted' : ''}`}>{value}</td>)}</tr>)}</tbody></table></div>}
    {!filtered.length && <div className="empty">暂无数据</div>}{tools.panel}
  </section>;
}

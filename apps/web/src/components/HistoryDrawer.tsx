import { useEffect, useState } from 'react';
import { request } from '../api';
export function HistoryDrawer({ id, close, notify }: { id: string; close: () => void; notify: (message: string) => void }) {
  const [rows, setRows] = useState<{ id: string; body: string; created_at: string }[]>([]);
  useEffect(() => { void request<typeof rows>(`/documents/${id}/snapshots`).then(setRows).catch(error => notify(error.message)); }, [id]);
  return <aside className="drawer" role="dialog" aria-label="正文历史"><div className="drawerHeader"><b>正文历史</b><button className="close" onClick={close} aria-label="关闭历史">✕</button></div><div className="drawerBody">
    <p>仅查看和复制，证据快照独立保存。</p>{rows.map(row => <div className="historyItem" key={row.id}><b>{row.created_at}</b><pre className="noteCode">{row.body}</pre><button className="addLink" onClick={() => void navigator.clipboard.writeText(row.body)}>复制正文</button></div>)}{!rows.length && <p>完成编辑后生成正文快照。</p>}
  </div></aside>;
}

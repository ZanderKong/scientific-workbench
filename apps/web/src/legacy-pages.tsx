import React, { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { stripInternalMarkers } from "@workbench/core";
const api = async <T = any,>(u: string, i?: RequestInit): Promise<T> => {
  const r = await fetch(u, {
      ...i,
      headers: {
        ...(i?.body && !((i.body as any) instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...i?.headers,
      },
    }),
    x = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(x.error || r.status);
  return x;
};
export function Edit({
  v,
  set,
  label,
}: {
  v: string;
  set: (x: string) => void;
  label: string;
}) {
  const plain = (x: string) => x.replace(/\\([\[\]])/g, "$1");
  const e = useEditor({
    extensions: [StarterKit, Markdown],
    content: v,
    onUpdate: ({ editor }) => set(plain(editor.getMarkdown())),
  });
  useEffect(() => {
    if (e && plain(e.getMarkdown()) !== v)
      e.commands.setContent(v, { contentType: "markdown" });
  }, [e, v]);
  return e ? (
    <EditorContent editor={e} aria-label={label} className="markdown-editor" />
  ) : null;
}
export function Head({
  title,
  desc,
  create,
}: {
  title: string;
  desc: string;
  create?: () => void;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{desc}</p>
      </div>
      {create && (
        <button className="primary" onClick={create}>
          ＋ 新建{title}
        </button>
      )}
    </div>
  );
}
export function List({
  title,
  desc,
  rows,
  open,
  create,
}: {
  title: string;
  desc: string;
  rows: string[][];
  open: (x: string) => void;
  create?: () => void;
}) {
  const [q, setQ] = useState("");
  return (
    <section className="page">
      <Head title={title} desc={desc} create={create} />
      <div className="toolbar">
        <input
          placeholder="搜索"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows
              .filter((r) => r.join("").includes(q))
              .map((r) => (
                <tr key={r[0]}>
                  <td>
                    <button className="link" onClick={() => open(r[0])}>
                      {r[1]}
                    </button>
                  </td>
                  <td>{r[2]}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function Sample({
  id,
  back,
  refresh,
  note,
  status,
}: {
  id: string;
  back: () => void;
  refresh: () => Promise<void>;
  note: (x: string) => void;
  status: (x: string) => void;
}) {
  const [item, setItem] = useState<any>(),
    [body, setBody] = useState(""),
    ver = useRef(1),
    latest = useRef(""),
    queue = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    api(`/api/v1/samples/${id}`).then((s) => {
      setItem(s);
      const b = stripInternalMarkers(s.document.body);
      setBody(b);
      latest.current = b;
      ver.current = s.document.head.contentVersion;
    });
  }, [id]);
  const save = (b = latest.current) => {
    clearTimeout(timer.current);
    status("正在保存…");
    queue.current = queue.current.then(async () => {
      const r = await api(`/api/v1/documents/${id}`, {
        method: "PUT",
        body: JSON.stringify({ body: b, expectedVersion: ver.current }),
      });
      ver.current = r.contentVersion;
      status("本地 · 已保存");
    });
    return queue.current.catch((e: any) => {
      status("保存失败");
      note(e.message);
      throw e;
    });
  };
  const change = (b: string) => {
    setBody(b);
    latest.current = b;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(b), 500);
  };
  return (
    <section className="page">
      <button
        className="back"
        onClick={async () => {
          try {
            await save();
            back();
          } catch {}
        }}
      >
        ‹ 样品
      </button>
      <div className="page-head">
        <div>
          <h1>{item?.code}</h1>
          <p>{item?.title}</p>
        </div>
        <button
          className="primary"
          onClick={async () => {
            try {
              await save();
              const r = await api(`/api/v1/documents/${id}/finalize`, {
                method: "POST",
              });
              await refresh();
              setItem(await api(`/api/v1/samples/${id}`));
              note(r.parsed?.warnings?.join(" ") || "结构已更新");
            } catch {}
          }}
        >
          完成编辑并提取
        </button>
      </div>
      <div className="detail-grid">
        <div className="paper">
          <Edit v={body} set={change} label="样品正文" />
          <p className="help">
            一级 bullet 写一个操作；子级使用 [对象]｜属性：值。[论点]
            只保留文字。
          </p>
        </div>
        <aside>
          <h3>已提取属性</h3>
          {item?.properties?.map((p: any) => (
            <button className="property" key={p.id}>
              <span>
                [{p.object_name}] {p.property_name}
              </span>
              <b>{p.value_text}</b>
              <small>第 {p.source_line} 行</small>
            </button>
          ))}
        </aside>
      </div>
    </section>
  );
}
export function Data({
  item,
  samples,
  back,
  refresh,
  note,
}: {
  item: any;
  samples: any[];
  back: () => void;
  refresh: () => Promise<void>;
  note: (x: string) => void;
}) {
  const [name, setName] = useState(item.name),
    [body, setBody] = useState(item.body || ""),
    [about, setAbout] = useState(item.aboutSampleIds),
    [v, setV] = useState(item.version);
  const save = async () => {
    try {
      let d = await api(`/api/v1/data/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ name, body, expectedVersion: v }),
      });
      d = await api(`/api/v1/data/${item.id}/about`, {
        method: "PUT",
        body: JSON.stringify({ sampleIds: about, expectedVersion: d.version }),
      });
      setV(d.version);
      await refresh();
      note("Data 已保存");
    } catch (e: any) {
      note(e.message);
    }
  };
  return (
    <section className="page">
      <button className="back" onClick={back}>
        ‹ 数据
      </button>
      <div className="page-head">
        <input
          className="title"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary" onClick={save}>
          保存 Data
        </button>
      </div>
      <div className="detail-grid">
        <div className="paper">
          <Edit v={body} set={setBody} label="Data 描述" />
        </div>
        <aside>
          <h3>About Samples</h3>
          {samples.map((s) => (
            <label className="check" key={s.id}>
              <input
                type="checkbox"
                checked={about.includes(s.id)}
                onChange={(e) =>
                  setAbout(
                    e.target.checked
                      ? [...about, s.id]
                      : about.filter((x: string) => x !== s.id),
                  )
                }
              />
              {s.code}
            </label>
          ))}
          <h3>组件</h3>
          {item.componentIds.map((id: string) => (
            <a
              className="file"
              href={`/api/v1/attachments/${id}/content`}
              target="_blank"
              key={id}
            >
              {id}
            </a>
          ))}
        </aside>
      </div>
    </section>
  );
}
export function Analysis({
  item,
  samples,
  data,
  back,
  refresh,
  note,
}: {
  item: any;
  samples: any[];
  data: any[];
  back: () => void;
  refresh: () => Promise<void>;
  note: (x: string) => void;
}) {
  const [title, setTitle] = useState(item.title),
    [body, setBody] = useState(item.body),
    [ids, setIds] = useState(item.itemIds),
    [claim, setClaim] = useState("");
  const save = () =>
    api(`/api/v1/analyses/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({ title, body, itemIds: ids }),
    });
  return (
    <section className="page">
      <button className="back" onClick={back}>
        ‹ 分析
      </button>
      <div className="page-head">
        <input
          className="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="primary"
          onClick={async () => {
            await save();
            await refresh();
            note("分析已保存");
          }}
        >
          保存分析
        </button>
      </div>
      <div className="detail-grid">
        <div className="paper">
          <Edit v={body} set={setBody} label="分析记录" />
        </div>
        <aside>
          <h3>涉及材料</h3>
          {[
            ...samples.map((x) => [x.id, x.code]),
            ...data.map((x) => [x.id, x.name]),
          ].map((x) => (
            <label className="check" key={x[0]}>
              <input
                type="checkbox"
                checked={ids.includes(x[0])}
                onChange={(e) =>
                  setIds(
                    e.target.checked
                      ? [...ids, x[0]]
                      : ids.filter((i: string) => i !== x[0]),
                  )
                }
              />
              {x[1]}
            </label>
          ))}
          <h3>正式论点</h3>
          <textarea value={claim} onChange={(e) => setClaim(e.target.value)} />
          <button
            onClick={async () => {
              await save();
              await api("/api/v1/claims", {
                method: "POST",
                body: JSON.stringify({
                  hostType: "analysis",
                  hostId: item.id,
                  text: claim,
                }),
              });
              setClaim("");
              await refresh();
              note("论点和证据已保存");
            }}
          >
            ＋ 创建正式论点
          </button>
        </aside>
      </div>
    </section>
  );
}
export function Claim({
  item,
  back,
  refresh,
  note,
}: {
  item: any;
  back: () => void;
  refresh: () => Promise<void>;
  note: (x: string) => void;
}) {
  const [text, setText] = useState(item.text);
  return (
    <section className="page">
      <button className="back" onClick={back}>
        ‹ 论点
      </button>
      <Head title="正式论点" desc={`来源：${item.hostType} / ${item.hostId}`} />
      <textarea
        className="claim-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="primary"
        onClick={async () => {
          await api(`/api/v1/claims/${item.id}`, {
            method: "PUT",
            body: JSON.stringify({ text }),
          });
          await refresh();
          note("论点已保存，原证据未改变");
        }}
      >
        保存文字
      </button>
      {item.evidence.map((e: any) => (
        <article className="evidence" key={e.id}>
          <b>
            {e.entityType} · 版本 {e.version}
          </b>
          <pre>{e.content}</pre>
        </article>
      ))}
    </section>
  );
}
export function Resources({
  objects,
  props,
}: {
  objects: any[];
  props: any[];
}) {
  const [tab, setTab] = useState(0),
    rows = tab ? props : objects;
  return (
    <section className="page">
      <Head title="资源" desc="管理对象、过程和全局属性字典。" />
      <div className="tabs">
        <button className={!tab ? "on" : ""} onClick={() => setTab(0)}>
          对象
        </button>
        <button className={tab ? "on" : ""} onClick={() => setTab(1)}>
          属性
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <tbody>
            {rows.map((x: any) => (
              <tr key={x.id}>
                <td>{x.canonicalName}</td>
                <td>{x.role || x.dimension || "—"}</td>
                <td>{x.aliases?.join(" · ") || x.recommendedUnit || "—"}</td>
                <td>{x.lifecycle || `${x.usageCount} 次`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function Settings() {
  const [s, setS] = useState<any>();
  useEffect(() => {
    api("/api/v1/workspace/settings").then(setS);
  }, []);
  return (
    <section className="page">
      <Head title="设置" desc="本机工作区、存储和备份。" />
      <div className="settings">
        <h3>数据目录</h3>
        <code>{s?.dataDir}</code>
        <h3>S3 兼容存储</h3>
        <p>{s?.storage?.enabled ? "已启用" : "未启用"} · 100 MB · 15 天</p>
        <h3>完整备份</h3>
        <button
          onClick={async () =>
            alert(
              JSON.stringify(
                await api("/api/v1/backups", {
                  method: "POST",
                  body: JSON.stringify({ target: "local" }),
                }),
              ),
            )
          }
        >
          创建本地备份
        </button>
      </div>
    </section>
  );
}

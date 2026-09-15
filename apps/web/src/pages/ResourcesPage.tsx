import { useState } from "react";
import type { PropertyDefinition, ResearchObject } from "@workbench/core";
import { request, type SampleRow } from "../api";
import { ListHeader, useListTools } from "../components/ListTools";
import { Modal } from "../components/Modal";

const tabs = [
  ["material", "原料"],
  ["equipment", "设备"],
  ["process", "过程"],
  ["other", "其他"],
  ["properties", "属性"],
  ["units", "量纲与单位"],
] as const;
type Tab = (typeof tabs)[number][0];
type Resource = ResearchObject | PropertyDefinition;
const roleName = (role: string) =>
  tabs.find(([key]) => key === role)?.[1] || role;

export function ResourcesPage({
  objects,
  properties,
  samples,
  refresh,
  notify,
  openSample,
  initialId,
  back,
}: {
  initialId?: string;
  back?: () => void;
  objects: ResearchObject[];
  properties: PropertyDefinition[];
  samples: SampleRow[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  openSample: (id: string) => void;
}) {
  const initialObject = objects.find((object) => object.id === initialId);
  const [tab, setTab] = useState<Tab>(
    initialObject && initialObject.role !== "sample"
      ? initialObject.role
      : properties.some((property) => property.id === initialId)
        ? "properties"
        : "material",
  );
  const [selected, setSelected] = useState<string | undefined>(initialId);
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const [dangerousAction, setDangerousAction] = useState<
    "merge" | "delete" | undefined
  >();
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [recommendationsOpen, setRecommendationsOpen] = useState(false);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [identity, setIdentity] = useState("");
  const [dimension, setDimension] = useState("");
  const [unit, setUnit] = useState("");
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const propertyTab = tab === "properties" || tab === "units";
  const columns = [
    "名称",
    propertyTab ? "别名" : "Role",
    propertyTab ? "量纲/类型" : "标识信息",
    propertyTab ? "常用单位" : "常用过程属性",
  ];
  const tools = useListTools(columns, false);
  const rows: Resource[] = propertyTab
    ? properties
    : objects.filter((object) => object.role === tab);
  const item = rows.find((row) => row.id === selected);
  const recommendationNames = (object: ResearchObject) =>
    (object.recommendedPropertyIds || []).map(
      (id) =>
        properties.find((property) => property.id === id)?.canonicalName || id,
    );
  const values = (row: Resource) => [
    row.canonicalName,
    "role" in row ? roleName(row.role) : row.aliases.join(" · ") || "—",
    "role" in row ? row.identityText || "—" : row.dimension || "—",
    "role" in row
      ? recommendationNames(row).join(" · ") || "—"
      : row.recommendedUnit || "—",
  ];
  const filtered = rows
    .filter((row) => tools.matches([...values(row), ...row.aliases]))
    .sort((a, b) => tools.compare(values(a), values(b)));
  const used = item
    ? samples.filter((sample) =>
        propertyTab
          ? sample.properties.some(
              (property) => property.property_id === item.id,
            )
          : sample.document?.head.references?.some(
              (reference) => reference.objectId === item.id,
            ) ||
            sample.properties.some(
              (property) => property.object_id === item.id,
            ),
      )
    : [];
  const edit = (row?: Resource) => {
    setName(row?.canonicalName || "");
    setAliases(row?.aliases.join("\n") || "");
    setIdentity(row && "role" in row ? row.identityText || "" : "");
    setDimension(row && "dimension" in row ? row.dimension || "" : "");
    setUnit(row && "recommendedUnit" in row ? row.recommendedUnit || "" : "");
    setEditing(true);
  };
  const save = async () => {
    try {
      const endpoint = propertyTab ? "/properties" : "/objects";
      const saved = await request<Resource>(
        endpoint + (item ? "/" + item.id : ""),
        {
          method: item ? "PUT" : "POST",
          body: JSON.stringify({
            canonicalName: name.trim(),
            aliases: [
              ...new Set(
                aliases
                  .split("\n")
                  .map((alias) => alias.trim())
                  .filter(Boolean),
              ),
            ],
            ...(propertyTab
              ? { dimension, recommendedUnit: unit }
              : { role: tab, identityText: identity }),
            ...(item ? { expectedVersion: item.version } : {}),
          }),
        },
      );
      await refresh();
      setSelected(saved.id);
      setEditing(false);
    } catch (error) {
      notify(String(error));
    }
  };
  const saveRecommendations = async () => {
    if (!item || !("role" in item)) return;
    try {
      await request(`/objects/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({
          expectedVersion: item.version,
          recommendedPropertyIds: recommendedIds,
        }),
      });
      await refresh();
      setRecommendationsOpen(false);
    } catch (error) {
      notify(String(error));
    }
  };
  const chooseRecommendations = () => {
    setRecommendedIds(
      item && "role" in item ? item.recommendedPropertyIds || [] : [],
    );
    setRecommendationsOpen(true);
  };
  const runDangerous = async () => {
    if (!item || !("role" in item) || !dangerousAction) return;
    try {
      const { grant } = await request<{ grant: string }>("/auth/grants", {
        method: "POST",
        body: JSON.stringify({ scope: dangerousAction }),
      });
      if (dangerousAction === "merge") {
        const target = objects.find((object) => object.id === mergeTargetId);
        if (!target) throw new Error("请选择合并目标");
        await request(`/objects/${item.id}/merge`, {
          method: "POST",
          headers: { "X-Workbench-Grant": grant },
          body: JSON.stringify({
            targetId: target.id,
            expectedVersion: item.version,
            targetVersion: target.version,
          }),
        });
        setSelected(target.id);
        notify(`已合并到「${target.canonicalName}」`);
      } else {
        await request(`/objects/${item.id}?expectedVersion=${item.version}`, {
          method: "DELETE",
          headers: { "X-Workbench-Grant": grant },
        });
        setSelected(undefined);
        notify("对象已永久删除");
      }
      setDangerousAction(undefined);
      await refresh();
    } catch (error) {
      notify(String(error));
    }
  };
  return (
    <>
      {item ? (
        <section className="detailPage">
          <div className="detailTop">
            <button
              className="back"
              onClick={() =>
                initialId && back ? back() : setSelected(undefined)
              }
            >
              ← 资源
            </button>
            <div className="actions">
              <button onClick={() => edit(item)}>编辑</button>
              <button onClick={() => setMore(true)}>•••</button>
            </div>
          </div>
          <div className="detailHero">
            <div className="eyebrow">{roleName(tab)}</div>
            <h1>{item.canonicalName}</h1>
            <div className="metaLine">
              <span>
                {"role" in item
                  ? roleName(item.role)
                  : item.aliases.join(" · ") || "全局属性"}
              </span>
              <span>{"role" in item ? item.identityText : item.dimension}</span>
              {"lifecycle" in item && item.lifecycle !== "active" && (
                <span>
                  {item.lifecycle === "deprecated"
                    ? "已废弃 · 仍可引用"
                    : "已合并"}
                </span>
              )}
            </div>
          </div>
          <div className="resourceDetailGrid">
            <section className="detailCard">
              <div className="blockTitle">
                <span>{propertyTab ? "Property Definition" : "对象属性"}</span>
              </div>
              <div className="propertyRows">
                <div>
                  <span>{propertyTab ? "中文名" : "名称"}</span>
                  <b>{item.canonicalName}</b>
                </div>
                <div>
                  <span>{propertyTab ? "手动别名" : "Role"}</span>
                  <b>
                    {"role" in item
                      ? roleName(item.role)
                      : item.aliases.join(" · ") || "—"}
                  </b>
                </div>
                <div>
                  <span>{propertyTab ? "量纲" : "标识信息"}</span>
                  <b>
                    {"role" in item
                      ? item.identityText || "—"
                      : item.dimension || "—"}
                  </b>
                </div>
                {propertyTab && (
                  <div>
                    <span>推荐单位</span>
                    <b>
                      {"recommendedUnit" in item
                        ? item.recommendedUnit || "—"
                        : "—"}
                    </b>
                  </div>
                )}
              </div>
            </section>
            <section className="detailCard">
              <div className="blockTitle">
                <span>{propertyTab ? "手动别名" : "使用时推荐属性"}</span>
                <button
                  onClick={() =>
                    propertyTab ? edit(item) : chooseRecommendations()
                  }
                >
                  ＋
                </button>
              </div>
              <div className="propertyTokens">
                {(propertyTab
                  ? item.aliases
                  : recommendationNames(item as ResearchObject)
                ).map((value) => (
                  <span key={value}>{value}</span>
                ))}
              </div>
              <button
                className="addLink"
                onClick={() =>
                  propertyTab ? edit(item) : chooseRecommendations()
                }
              >
                {propertyTab ? "＋ 编辑手动别名" : "＋ 添加推荐属性"}
              </button>
            </section>
            {!propertyTab && (
              <section className="detailCard span2">
                <div className="blockTitle">
                  <span>近期被引用</span>
                </div>
                <table className="compareTable">
                  <thead>
                    <tr>
                      <th>样品</th>
                      <th>使用属性</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {used.map((sample) => (
                      <tr key={sample.id} onClick={() => openSample(sample.id)}>
                        <td>{sample.code}</td>
                        <td>
                          {[
                            ...new Set(
                              sample.properties
                                .filter(
                                  (property) => property.object_id === item.id,
                                )
                                .map((property) => property.property_name),
                            ),
                          ].join(" · ") || "仅引用"}
                        </td>
                        <td>
                          {sample.document?.head.updatedAt?.slice(0, 10) ||
                            sample.createdAt?.slice(0, 10) ||
                            "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </section>
      ) : (
        <section className="page">
          <ListHeader
            title="资源"
            description="管理可在编辑器中引用和复用的原料、设备、过程，以及属性字典和量纲单位。"
            create={() => edit()}
            createLabel="新建"
          />
          {tools.toolbar}
          <div className="tabs">
            {tabs
              .filter(
                ([key]) =>
                  key !== "other" ||
                  objects.some((object) => object.role === "other"),
              )
              .map(([key, label]) => (
                <button
                  className={tab === key ? "active" : ""}
                  key={key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
          </div>
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
                {filtered.map((row) => (
                  <tr key={row.id} onClick={() => setSelected(row.id)}>
                    {values(row).map(
                      (value, index) =>
                        tools.visible(columns[index]) && (
                          <td
                            key={columns[index]}
                            className={index === 0 ? "primaryCell" : ""}
                          >
                            {value}
                          </td>
                        ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <div className="empty">暂无匹配资源</div>}
          {tools.panel}
        </section>
      )}
      {editing && (
        <Modal
          title={`${item ? "编辑" : "新建"}${propertyTab ? "属性" : roleName(tab)}`}
          close={() => setEditing(false)}
          footer={
            <button className="primary" onClick={() => void save()}>
              保存
            </button>
          }
        >
          <div className="field">
            <label>
              标准名称
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </div>
          <div className="field">
            <label>
              手动别名（每行一个）
              <textarea
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
              />
            </label>
          </div>
          {propertyTab ? (
            <>
              <div className="field">
                <label>
                  量纲
                  <input
                    value={dimension}
                    onChange={(event) => setDimension(event.target.value)}
                  />
                </label>
              </div>
              <div className="field">
                <label>
                  推荐单位
                  <input
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                  />
                </label>
              </div>
            </>
          ) : (
            <div className="field">
              <label>
                标识信息
                <input
                  value={identity}
                  onChange={(event) => setIdentity(event.target.value)}
                />
              </label>
            </div>
          )}
        </Modal>
      )}
      {recommendationsOpen && (
        <Modal
          title="使用时推荐属性"
          close={() => setRecommendationsOpen(false)}
          footer={
            <button
              className="primary"
              onClick={() => void saveRecommendations()}
            >
              保存
            </button>
          }
        >
          <p>只帮助填写，样品可使用任何全局属性。</p>
          <div className="columnChecks">
            {properties.map((property) => (
              <label key={property.id}>
                <input
                  type="checkbox"
                  checked={recommendedIds.includes(property.id)}
                  onChange={() =>
                    setRecommendedIds((current) =>
                      current.includes(property.id)
                        ? current.filter((id) => id !== property.id)
                        : [...current, property.id],
                    )
                  }
                />
                {property.canonicalName}
              </label>
            ))}
          </div>
          {!properties.length && <p>请先在属性字典中添加属性。</p>}
        </Modal>
      )}
      {more && item && (
        <Modal title="资源操作" close={() => setMore(false)}>
          <p>手动别名：{item.aliases.join(" · ") || "未填写"}</p>
          <button
            onClick={() => {
              setMore(false);
              edit(item);
            }}
          >
            编辑标准名与别名
          </button>
          {"lifecycle" in item && item.lifecycle !== "merged" && (
            <>
              <button
                onClick={() =>
                  void request(`/objects/${item.id}`, {
                    method: "PUT",
                    body: JSON.stringify({
                      lifecycle:
                        item.lifecycle === "active" ? "deprecated" : "active",
                      expectedVersion: item.version,
                    }),
                  })
                    .then(async () => {
                      await refresh();
                      setMore(false);
                    })
                    .catch((error) => notify(error.message))
                }
              >
                {item.lifecycle === "active" ? "废弃" : "重新启用"}
              </button>
              <button
                onClick={() => {
                  const target = objects.find(
                    (object) =>
                      object.id !== item.id &&
                      object.role === item.role &&
                      object.lifecycle === "active",
                  );
                  setMergeTargetId(target?.id || "");
                  setMore(false);
                  setDangerousAction("merge");
                }}
              >
                合并到其他对象
              </button>
              <button
                onClick={() => {
                  setMore(false);
                  setDangerousAction("delete");
                }}
              >
                永久删除
              </button>
            </>
          )}
        </Modal>
      )}
      {dangerousAction && item && "role" in item && (
        <Modal
          title={dangerousAction === "merge" ? "合并对象" : "永久删除对象"}
          close={() => setDangerousAction(undefined)}
          footer={
            <>
              <button
                className="ghost"
                onClick={() => setDangerousAction(undefined)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={dangerousAction === "merge" && !mergeTargetId}
                onClick={() => void runDangerous()}
              >
                {dangerousAction === "merge" ? "确认合并" : "确认永久删除"}
              </button>
            </>
          }
        >
          {dangerousAction === "merge" ? (
            <div className="field">
              <label>
                将「{item.canonicalName}」合并到
                <select
                  aria-label="合并目标"
                  value={mergeTargetId}
                  onChange={(event) => setMergeTargetId(event.target.value)}
                >
                  <option value="">请选择同类别启用对象</option>
                  {objects
                    .filter(
                      (object) =>
                        object.id !== item.id &&
                        object.role === item.role &&
                        object.lifecycle === "active",
                    )
                    .map((object) => (
                      <option value={object.id} key={object.id}>
                        {object.canonicalName}
                      </option>
                    ))}
                </select>
              </label>
              <p>
                样品中的稳定引用会转向目标对象；原名称会成为目标对象的手动别名。
              </p>
            </div>
          ) : (
            <p>
              将永久删除「{item.canonicalName}
              」。仍被任何样品引用时，删除会被拒绝。
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

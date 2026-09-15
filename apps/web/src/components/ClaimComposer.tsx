import { Fragment, useEffect, useRef, useState } from "react";
import type { ClaimRecord } from "@workbench/core";
import { request } from "../api";
import { ResearchEditor } from "../editor/ResearchEditor";
import { draftRead, draftWrite } from "../editor/drafts";
import { claimDrafts } from "../editor/claim-draft";

/** Data and Analysis use the same editable bullet surface and explicit host. */
export function ClaimComposer({
  hostType,
  hostId,
  claims,
  open,
  beforeCreate,
  refresh,
  notify,
}: {
  hostType: "data" | "analysis";
  hostId: string;
  claims: ClaimRecord[];
  open: (id: string) => void;
  beforeCreate: () => Promise<void>;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const body = useRef("- ");
  const busy = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const submitted = useRef(new Map<string, { text: string; key: string }>());
  const cacheKey = `claim-draft/${hostType}/${hostId}`;
  const [initialBody, setInitialBody] = useState<string>();
  const cacheWrite = useRef(Promise.resolve());
  const errors = useRef(notify);
  errors.current = notify;
  const persist = (clear = false) => {
    const content = clear
      ? null
      : JSON.stringify({
          schema: "swb.claim-draft/1",
          body: body.current,
          attempts: [...submitted.current],
        });
    const next = cacheWrite.current.then(() => draftWrite(cacheKey, content));
    cacheWrite.current = next.catch((error) =>
      errors.current(`论点草稿缓存失败：${error.message}`),
    );
    return next;
  };
  useEffect(() => {
    let active = true;
    void draftRead(cacheKey)
      .then((raw) => {
        if (!active) return;
        if (raw) {
          const saved = JSON.parse(raw) as {
            schema: string;
            body: string;
            attempts: [string, { text: string; key: string }][];
          };
          if (
            saved.schema !== "swb.claim-draft/1" ||
            typeof saved.body !== "string" ||
            !Array.isArray(saved.attempts)
          )
            throw Error("论点草稿格式无效");
          body.current = saved.body;
          submitted.current = new Map(saved.attempts);
        }
        setInitialBody(body.current);
        setHasDraft(claimDrafts(body.current).length > 0);
      })
      .catch((error) => {
        if (active) {
          errors.current(error.message);
          setInitialBody("- ");
        }
      });
    return () => {
      active = false;
    };
  }, [cacheKey]);
  const create = async () => {
    if (busy.current) return;
    const captured = body.current;
    const entries = claimDrafts(captured);
    if (!entries.length) return;
    busy.current = true;
    try {
      await beforeCreate();
      for (const entry of entries) {
        let attempt = submitted.current.get(entry.blockId);
        if (!attempt || attempt.text !== entry.text) {
          attempt = { text: entry.text, key: crypto.randomUUID() };
          submitted.current.set(entry.blockId, attempt);
        }
        await persist();
        await request("/claims", {
          method: "POST",
          headers: { "Idempotency-Key": attempt.key },
          body: JSON.stringify({ hostType, hostId, text: entry.text }),
        });
      }
      if (body.current === captured) {
        body.current = "- ";
        setHasDraft(false);
        setGeneration((value) => value + 1);
        submitted.current.clear();
        setInitialBody("- ");
        await persist(true);
      }
      await refresh();
    } catch (error) {
      notify(String(error));
    } finally {
      busy.current = false;
    }
  };
  return (
    <section className="block hostedClaimComposer">
      <div className="blockTitle">
        <span>论点</span>
        <span>当前 {hostType === "data" ? "Data" : "Analysis/View"}</span>
      </div>
      <div className="liveBulletArea sharedBulletArea claimSharedArea">
        {claims
          .filter(
            (claim) => claim.hostType === hostType && claim.hostId === hostId,
          )
          .map((claim) => {
            const [title, ...children] = claim.text.split("\n");
            return (
              <Fragment key={claim.id}>
                <div className="liveBulletLine" data-level="1">
                  <span className="liveBulletDot">•</span>
                  <span className="claimEditorBadge">论点</span>
                  <button
                    className="claimTextLink liveBulletEdit"
                    onClick={() => open(claim.id)}
                  >
                    {title.replace(/^- /, "")}
                  </button>
                </div>
                {children.map((line, index) => (
                  <div className="liveBulletLine" data-level="2" key={index}>
                    <span className="liveBulletDot">•</span>
                    <button
                      className="claimTextLink liveBulletEdit"
                      onClick={() => open(claim.id)}
                    >
                      {line.trim().replace(/^- /, "")}
                    </button>
                  </div>
                ))}
              </Fragment>
            );
          })}
        <div className="claimDraft">
          <span className="claimEditorBadge">论点</span>
          {initialBody !== undefined && (
            <ResearchEditor
              key={generation}
              body={initialBody}
              onChange={(value) => {
                body.current = value;
                setHasDraft(claimDrafts(value).length > 0);
                void persist().catch(() => {
                  /* Cache failures are displayed by the serialized writer. */
                });
              }}
              onError={notify}
              label="新论点正文"
              placeholder={
                hostType === "data"
                  ? "基于当前 Data 输入新的论点……"
                  : "输入新的论点……"
              }
            />
          )}
        </div>
      </div>
      {hasDraft && (
        <button className="addLink" onClick={() => void create()}>
          保存为正式论点
        </button>
      )}
      <div className="claimDirectNote">
        保存时固定当前来源正文与附件版本。来源上下文不表示论点已得到证明。
      </div>
    </section>
  );
}

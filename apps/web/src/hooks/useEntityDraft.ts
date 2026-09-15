import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "../api";
import { SaveQueue, type SaveState } from "../editor/SaveQueue";
import { draftRead, draftWrite } from "../editor/drafts";

/** One mounted editor owns one serialized queue. Server versions are never inferred locally. */
export function useEntityDraft<T extends { id: string; version: number }>(
  initial: T,
  endpoint: string,
  notify: (message: string) => void,
) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<SaveState>("saved");
  const [recovery, setRecovery] = useState<string>();
  const current = useRef(initial);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const queue = useRef<SaveQueue | undefined>(undefined);
  const key = endpoint;
  const install = useCallback(
    (record: T) => {
      queue.current?.dispose();
      queue.current = new SaveQueue(
        JSON.stringify(record),
        record.version,
        async (serialized, expectedVersion) => {
          const submitted = JSON.parse(serialized) as T;
          const saved = await request<T>(endpoint, {
            method: "PUT",
            body: JSON.stringify({ ...submitted, expectedVersion }),
          });
          return { contentVersion: saved.version };
        },
        (status, error) => {
          setState(status);
          if (error) notifyRef.current(error.message);
        },
        (draft) => {
          void draftWrite(key, draft).catch((error) =>
            notifyRef.current(`草稿缓存失败：${error.message}`),
          );
        },
      );
    },
    [endpoint, key],
  );
  useEffect(() => {
    install(initial);
    let active = true;
    void draftRead(key)
      .then((draft) => {
        if (active && draft && draft !== JSON.stringify(initial))
          setRecovery(draft);
      })
      .catch((error) => notifyRef.current(error.message));
    return () => {
      active = false;
      queue.current?.dispose();
    };
  }, [install, key, initial.id]);
  const change = (patch: Partial<T>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setValue(next);
    queue.current?.change(JSON.stringify(next));
  };
  const flush = useCallback(async () => {
    await queue.current?.flush();
    await request(`${endpoint}/finalize`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: queue.current?.confirmedVersion,
      }),
    });
  }, [endpoint]);
  const reload = async (fromDisk = false) => {
    try {
      await queue.current?.settle();
    } catch {
      /* The user explicitly selected loading the latest record. */
    }
    const latest = fromDisk
      ? await request<T>(`${endpoint}/reload`, {
          method: "POST",
          body: JSON.stringify({
            expectedVersion:
              queue.current?.confirmedVersion ?? current.current.version,
          }),
        })
      : await request<T>(endpoint);
    current.current = latest;
    setValue(latest);
    install(latest);
    setState("saved");
    setRecovery(undefined);
    await draftWrite(key, null);
  };
  const confirmedVersion = () =>
    queue.current?.confirmedVersion ?? current.current.version;
  const acceptVersion = (version: number) => {
    queue.current?.acceptServer(version);
    current.current = { ...current.current, version };
    setValue(current.current);
  };
  return {
    value,
    state,
    change,
    flush,
    reload,
    confirmedVersion,
    acceptVersion,
    recovery,
    dismissRecovery: () => setRecovery(undefined),
    copy: () => {
      const record = current.current;
      const content =
        "body" in record && typeof record.body === "string"
          ? record.body
          : "text" in record && typeof record.text === "string"
            ? record.text
            : JSON.stringify(record, null, 2);
      return navigator.clipboard.writeText(content);
    },
    recover: () => {
      if (recovery) {
        const restored = JSON.parse(recovery) as T;
        if (restored.id !== initial.id) throw Error("草稿身份不匹配");
        change(restored);
        setRecovery(undefined);
      }
    },
  };
}

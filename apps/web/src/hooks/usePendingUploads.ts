import { useCallback, useRef } from "react";

/** Navigation/evidence barriers wait until uploaded files have been associated with the draft. */
export function usePendingUploads() {
  const pending = useRef(new Set<Promise<void>>());
  const track = useCallback((task: Promise<void>) => {
    pending.current.add(task);
    void task.then(
      () => pending.current.delete(task),
      () => pending.current.delete(task),
    );
  }, []);
  const wait = useCallback(async () => {
    while (pending.current.size) await Promise.all([...pending.current]);
  }, []);
  return { track, wait };
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveQueue } from "./SaveQueue";
afterEach(() => vi.useRealTimers());
describe("save queue", () => {
  it("serializes writes with acknowledged versions", async () => {
    const calls: [string, number][] = [];
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = new SaveQueue(
      "",
      1,
      async (body, version) => {
        calls.push([body, version]);
        if (body === "one") await first;
        return { contentVersion: version + 1 };
      },
      () => {},
      () => {},
    );
    queue.change("one");
    const pending = queue.flush();
    queue.change("two");
    release();
    await pending;
    expect(calls).toEqual([
      ["one", 1],
      ["two", 2],
    ]);
    queue.dispose();
  });
  it("saves changed binding metadata even when visible text is unchanged", async () => {
    const write = vi.fn(async (_body: string, version: number) => ({
      contentVersion: version + 1,
    }));
    const queue = new SaveQueue(
      "[重名对象]",
      3,
      write,
      () => {},
      () => {},
    );
    queue.change("[重名对象]");
    expect(queue.hasUnsavedChanges).toBe(true);
    await queue.flush();
    expect(write).toHaveBeenCalledWith("[重名对象]", 3);
    expect(queue.confirmedVersion).toBe(4);
    expect(queue.hasUnsavedChanges).toBe(false);
    queue.dispose();
  });
  it("retains draft and permits retry after failure", async () => {
    let fail = true;
    const draft = vi.fn();
    const state = vi.fn();
    const queue = new SaveQueue(
      "",
      1,
      async () => {
        if (fail) throw Error("offline");
        return { contentVersion: 2 };
      },
      state,
      draft,
    );
    queue.change("保留文字");
    await expect(queue.flush()).rejects.toThrow("offline");
    expect(draft).not.toHaveBeenCalledWith(null);
    fail = false;
    await queue.flush();
    expect(draft).toHaveBeenLastCalledWith(null);
    queue.dispose();
  });
  it("writes during continuous input within two seconds", async () => {
    vi.useFakeTimers();
    const write = vi.fn(async (_body: string, version: number) => ({
      contentVersion: version + 1,
    }));
    const queue = new SaveQueue(
      "",
      1,
      write,
      () => {},
      () => {},
    );
    for (let i = 0; i < 10; i++) {
      queue.change(String(i));
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(write).toHaveBeenCalled();
    queue.dispose();
  });
});

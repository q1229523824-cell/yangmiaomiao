import { describe, expect, it, vi } from "vitest";
import {
  VersionedRepository,
  namespacedKey,
  type StorageAdapter,
} from "../miniprogram/repositories/storage";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const values = new Map<string, unknown>();
  // Deliberately retain object references to catch accidental mutation leakage.
  const adapter: StorageAdapter = {
    get: async <T>(key: string) => values.get(key) as T | undefined,
    set: async <T>(key: string, value: T) => { values.set(key, value); },
    remove: vi.fn(async (key: string) => { values.delete(key); }),
    keys: vi.fn(async () => [...values.keys()]),
  };
  vi.spyOn(adapter, "get");
  vi.spyOn(adapter, "set");
  const repository = new VersionedRepository(adapter, "state", () => ({
    name: "默认",
    checked: [] as string[],
    count: 0,
  }));
  return { adapter, repository, values };
}

describe("shared repository transactions", () => {
  it("reads inside the shared queue and merges independent delayed edits", async () => {
    const { adapter, repository, values } = fixture();
    const entered = deferred();
    const release = deferred();
    vi.spyOn(adapter, "set").mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      values.set(key, value);
    });

    const shopping = repository.update((latest) => ({ ...latest, checked: ["rice"] }));
    await entered.promise;
    const profile = repository.update((latest) => ({ ...latest, name: "小杨" }));
    const refresh = repository.update((latest) => ({ ...latest, count: latest.count + 1 }));
    expect(adapter.get).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([shopping, profile, refresh]);

    await expect(repository.load()).resolves.toEqual({
      checked: ["rice"], name: "小杨", count: 1,
    });
  });

  it("failed callbacks and writes do not leak mutations or poison the queue", async () => {
    const { adapter, repository } = fixture();
    await repository.save({ name: "小杨", checked: ["rice"], count: 1 });

    await expect(repository.update((latest) => {
      latest.checked.push("leaked");
      throw new Error("calculation failed");
    })).rejects.toThrow("calculation failed");
    vi.spyOn(adapter, "set").mockRejectedValueOnce(new Error("disk full"));
    const failedWrite = repository.update((latest) => ({ ...latest, checked: ["bad"] }));
    const recovered = repository.update((latest) => ({ ...latest, name: "小苗" }));
    await expect(failedWrite).rejects.toThrow("disk full");
    await recovered;

    const read = await repository.load();
    expect(read).toEqual({ checked: ["rice"], name: "小苗", count: 1 });
    read.checked.push("also leaked");
    await expect(repository.load()).resolves.toEqual({
      checked: ["rice"], name: "小苗", count: 1,
    });
  });

  it("serializes clear after pending saves and cancels pre-reset queued work", async () => {
    const { adapter, repository, values } = fixture();
    await repository.save({ name: "旧资料", checked: ["rice"], count: 1 });
    values.set("other-app:state", "保留");
    values.set(namespacedKey("legacy"), "旧缓存");
    const entered = deferred();
    const release = deferred();
    vi.spyOn(adapter, "set").mockImplementationOnce(async (key, value) => {
      entered.resolve();
      await release.promise;
      values.set(key, value);
    });
    const oldSave = repository.update((latest) => ({ ...latest, count: 2 }));
    await entered.promise;
    const clearing = repository.clearOwnedData();
    const staleWrite = repository.update((latest) => ({ ...latest, name: "失效操作" }));
    const rejected = expect(staleWrite).rejects.toThrow("刚刚已清除");
    release.resolve();
    await Promise.all([oldSave, clearing, rejected]);

    expect([...values.entries()]).toEqual([["other-app:state", "保留"]]);
    await repository.update((latest) => ({ ...latest, name: "新资料" }));
    await expect(repository.load()).resolves.toEqual({
      name: "新资料", checked: [], count: 0,
    });
  });

  it("waits for all removals to finish even when one deletion fails", async () => {
    const { adapter, repository, values } = fixture();
    values.set(namespacedKey("state"), "unreadable");
    values.set(namespacedKey("legacy"), "legacy");
    const entered = deferred();
    const release = deferred();
    vi.spyOn(adapter, "remove").mockImplementation(async (key) => {
      if (key === namespacedKey("state")) throw new Error("remove failed");
      entered.resolve();
      await release.promise;
      values.delete(key);
    });
    const clear = repository.clearOwnedData();
    const rejected = expect(clear).rejects.toThrow("remove failed");
    await entered.promise;
    const read = repository.load();
    const invalidRead = expect(read).rejects.toThrow("本地数据格式已损坏");
    expect(adapter.get).not.toHaveBeenCalled();
    release.resolve();
    await Promise.all([rejected, invalidRead]);
    expect(values.has(namespacedKey("legacy"))).toBe(false);
  });

  it("does not save an unchanged state on repeated initializers", async () => {
    const { adapter, repository } = fixture();
    await Promise.all(Array.from({ length: 3 }, () =>
      repository.update((latest) => latest.count > 0
        ? latest
        : { ...latest, count: 1 })
    ));
    expect(adapter.set).toHaveBeenCalledTimes(1);
    expect((await repository.load()).count).toBe(1);
  });
});

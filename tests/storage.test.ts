import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  StorageAdapter,
  VersionedRepository,
  clearAllOwnedData,
  createWxStorageAdapter,
  namespacedKey
} from "../miniprogram/repositories/storage";

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

describe("VersionedRepository", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips current schema data", async () => {
    const adapter = new MemoryStorage();
    const repository = new VersionedRepository(adapter, "profile", () => ({ n: 0 }));

    await repository.save({ n: 7 });

    await expect(repository.load()).resolves.toEqual({ n: 7 });
  });

  it("falls back when the cached schema is stale", async () => {
    const adapter = new MemoryStorage();
    adapter.values.set(namespacedKey("profile"), {
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      savedAt: new Date().toISOString(),
      data: { n: 99 }
    });
    const repository = new VersionedRepository(adapter, "profile", () => ({ n: 1 }));

    await expect(repository.load()).resolves.toEqual({ n: 1 });
  });

  it("migrates and re-saves an older valid schema", async () => {
    const adapter = new MemoryStorage();
    adapter.values.set(namespacedKey("profile"), {
      schemaVersion: 1,
      savedAt: "2026-09-06T00:00:00.000Z",
      data: { legacyValue: 7 }
    });
    const repository = new VersionedRepository(
      adapter,
      "profile",
      () => ({ n: 0 }),
      CURRENT_SCHEMA_VERSION,
      (value): value is { n: number } =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as { n?: unknown }).n === "number",
      (value, fromVersion) =>
        fromVersion === 1 &&
        typeof value === "object" &&
        value !== null &&
        typeof (value as { legacyValue?: unknown }).legacyValue === "number"
          ? { n: (value as { legacyValue: number }).legacyValue }
          : undefined
    );

    await expect(repository.load()).resolves.toEqual({ n: 7 });
    expect(adapter.values.get(namespacedKey("profile"))).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: { n: 7 }
    });
  });

  it("falls back when current-schema data is malformed", async () => {
    const adapter = new MemoryStorage();
    adapter.values.set(namespacedKey("profile"), {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      data: "broken"
    });
    const repository = new VersionedRepository(
      adapter,
      "profile",
      () => ({ n: 1 }),
      CURRENT_SCHEMA_VERSION,
      (value): value is { n: number } =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as { n?: unknown }).n === "number"
    );

    await expect(repository.load()).resolves.toEqual({ n: 1 });
  });

  it("clears only data owned by this app", async () => {
    const adapter = new MemoryStorage();
    adapter.values.set(namespacedKey("profile"), 1);
    adapter.values.set(namespacedKey("plan"), 2);
    adapter.values.set("another-app:key", 3);

    await clearAllOwnedData(adapter);

    expect([...adapter.values.entries()]).toEqual([["another-app:key", 3]]);
  });

  it("treats only a missing wx storage key as empty", async () => {
    vi.stubGlobal("wx", {
      getStorage: vi
        .fn()
        .mockRejectedValue({ errMsg: "getStorage:fail data not found" })
    });

    await expect(createWxStorageAdapter().get("missing")).resolves.toBeUndefined();
  });

  it("surfaces wx storage failures instead of silently overwriting state", async () => {
    const failure = { errMsg: "getStorage:fail storage unavailable" };
    vi.stubGlobal("wx", {
      getStorage: vi.fn().mockRejectedValue(failure)
    });

    await expect(createWxStorageAdapter().get("app-state")).rejects.toBe(failure);
  });
});

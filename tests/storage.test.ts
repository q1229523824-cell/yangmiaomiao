import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  StorageDataError,
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

  it("returns a fresh fallback only when the storage key is absent", async () => {
    const adapter = new MemoryStorage();
    const set = vi.spyOn(adapter, "set");
    const fallback = vi.fn(() => ({ n: 1 }));
    const repository = new VersionedRepository(adapter, "profile", fallback);

    await expect(repository.load()).resolves.toEqual({ n: 1 });
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  it("round-trips current schema data", async () => {
    const adapter = new MemoryStorage();
    const repository = new VersionedRepository(adapter, "profile", () => ({ n: 0 }));

    await repository.save({ n: 7 });

    await expect(repository.load()).resolves.toEqual({ n: 7 });
  });

  it("rejects a future schema without saving over the original value", async () => {
    const adapter = new MemoryStorage();
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      savedAt: new Date().toISOString(),
      data: { n: 99 }
    };
    adapter.values.set(namespacedKey("profile"), stored);
    const set = vi.spyOn(adapter, "set");
    const repository = new VersionedRepository(adapter, "profile", () => ({ n: 1 }));

    await expect(repository.load()).rejects.toMatchObject({
      name: "StorageDataError",
      code: "UNSUPPORTED_FUTURE_SCHEMA",
      message: expect.stringContaining("更高版本")
    } satisfies Partial<StorageDataError>);
    expect(set).not.toHaveBeenCalled();
    expect(adapter.values.get(namespacedKey("profile"))).toBe(stored);
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

  it("rejects a malformed envelope without saving over it", async () => {
    const adapter = new MemoryStorage();
    const stored = { schemaVersion: "two", data: { n: 7 } };
    adapter.values.set(namespacedKey("profile"), stored);
    const set = vi.spyOn(adapter, "set");
    const repository = new VersionedRepository(adapter, "profile", () => ({ n: 1 }));

    await expect(repository.load()).rejects.toMatchObject({
      name: "StorageDataError",
      code: "INVALID_ENVELOPE",
      message: expect.stringContaining("避免覆盖原数据")
    } satisfies Partial<StorageDataError>);
    expect(set).not.toHaveBeenCalled();
    expect(adapter.values.get(namespacedKey("profile"))).toBe(stored);
  });

  it("rejects invalid current-schema data without saving over it", async () => {
    const adapter = new MemoryStorage();
    const stored = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      data: "broken"
    };
    adapter.values.set(namespacedKey("profile"), stored);
    const set = vi.spyOn(adapter, "set");
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

    await expect(repository.load()).rejects.toMatchObject({
      name: "StorageDataError",
      code: "INVALID_CURRENT_DATA",
      message: expect.stringContaining("校验失败")
    } satisfies Partial<StorageDataError>);
    expect(set).not.toHaveBeenCalled();
    expect(adapter.values.get(namespacedKey("profile"))).toBe(stored);
  });

  it("rejects an unconvertible old schema without saving over it", async () => {
    const adapter = new MemoryStorage();
    const stored = {
      schemaVersion: 1,
      savedAt: "2026-09-06T00:00:00.000Z",
      data: { legacyValue: "broken" }
    };
    adapter.values.set(namespacedKey("profile"), stored);
    const set = vi.spyOn(adapter, "set");
    const repository = new VersionedRepository(
      adapter,
      "profile",
      () => ({ n: 0 }),
      CURRENT_SCHEMA_VERSION,
      (value): value is { n: number } =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as { n?: unknown }).n === "number",
      () => undefined
    );

    await expect(repository.load()).rejects.toMatchObject({
      name: "StorageDataError",
      code: "MIGRATION_FAILED",
      message: expect.stringContaining("无法安全迁移")
    } satisfies Partial<StorageDataError>);
    expect(set).not.toHaveBeenCalled();
    expect(adapter.values.get(namespacedKey("profile"))).toBe(stored);
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

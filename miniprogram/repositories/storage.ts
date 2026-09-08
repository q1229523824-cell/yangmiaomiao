export const STORAGE_NAMESPACE = "fitness-couple";
export const CURRENT_SCHEMA_VERSION = 2;

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

function promiseWithTimeout<T>(
  operation: PromiseLike<T> | T,
  timeoutMs: number,
  description: string
): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<T>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${description}（本地操作超时）`)),
        timeoutMs,
      );
    }),
  ]);
}

export interface StoredEnvelope<T> {
  schemaVersion: number;
  savedAt: string;
  data: T;
}

export type StorageDataErrorCode =
  | "INVALID_ENVELOPE"
  | "INVALID_CURRENT_DATA"
  | "UNSUPPORTED_FUTURE_SCHEMA"
  | "MIGRATION_FAILED";

/**
 * Existing local data must never be mistaken for a fresh installation.
 * Pages surface this Chinese message and, most importantly, do not save a
 * generated fallback over the only copy of the user's data.
 */
export class StorageDataError extends Error {
  constructor(
    public readonly code: StorageDataErrorCode,
    message: string
  ) {
    super(message);
    this.name = "StorageDataError";
  }
}

function isStoredEnvelope(value: unknown): value is StoredEnvelope<unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const envelope = value as Partial<StoredEnvelope<unknown>>;
  return (
    Number.isInteger(envelope.schemaVersion) &&
    (envelope.schemaVersion as number) >= 1 &&
    typeof envelope.savedAt === "string" &&
    !Number.isNaN(Date.parse(envelope.savedAt)) &&
    Object.prototype.hasOwnProperty.call(envelope, "data")
  );
}

export function namespacedKey(key: string): string {
  return `${STORAGE_NAMESPACE}:${key}`;
}

export function createWxStorageAdapter(): StorageAdapter {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      try {
        const result = await wx.getStorage<T>({ key });
        return result.data;
      } catch (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "errMsg" in error &&
          typeof error.errMsg === "string"
            ? error.errMsg
            : error instanceof Error
              ? error.message
              : "";
        if (/data not found|no such key/i.test(message)) return undefined;
        throw error;
      }
    },

  async set<T>(key: string, value: T): Promise<void> {
    await promiseWithTimeout(
      wx.setStorage({ key, data: value }),
      5000,
      "wx.setStorage"
    );
  },

    async remove(key: string): Promise<void> {
      await wx.removeStorage({ key });
    },

    async keys(): Promise<string[]> {
      const result = await wx.getStorageInfo();
      return result.keys;
    }
  };
}

export class VersionedRepository<T> {
  private queue: Promise<void> = Promise.resolve();
  private resetGeneration = 0;

  constructor(
    private readonly adapter: StorageAdapter,
    private readonly logicalKey: string,
    private readonly fallback: () => T,
    private readonly schemaVersion = CURRENT_SCHEMA_VERSION,
    private readonly validate: (value: unknown) => value is T = (
      value: unknown
    ): value is T => value !== undefined && value !== null,
    private readonly migrate?: (
      value: unknown,
      fromSchemaVersion: number
    ) => T | undefined
  ) {}

  /** All pages share this queue, including reads that may migrate old data. */
  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.queue.then(operation);
    // One failed read/write must not prevent later retries or a confirmed reset.
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  load(): Promise<T> {
    return this.enqueue(() => this.loadUnlocked());
  }

  private async loadUnlocked(): Promise<T> {
    const stored = await this.adapter.get<unknown>(
      namespacedKey(this.logicalKey)
    );

    // Storage adapters return undefined only for a genuinely absent key.
    // Every present-but-unreadable value is an integrity error, not a fresh
    // installation, so callers cannot overwrite it with generated defaults.
    if (stored === undefined) {
      return this.fallback();
    }
    if (!isStoredEnvelope(stored)) {
      throw new StorageDataError(
        "INVALID_ENVELOPE",
        "本地数据格式已损坏，已停止加载以避免覆盖原数据。"
      );
    }

    if (stored.schemaVersion === this.schemaVersion) {
      if (this.validate(stored.data)) return cloneStorageValue(stored.data);
      throw new StorageDataError(
        "INVALID_CURRENT_DATA",
        "本地数据校验失败，已停止加载以避免覆盖原数据。"
      );
    }

    if (stored.schemaVersion > this.schemaVersion) {
      throw new StorageDataError(
        "UNSUPPORTED_FUTURE_SCHEMA",
        `本地数据来自更高版本（${stored.schemaVersion}），当前版本无法安全读取，已停止加载以避免覆盖原数据。`
      );
    }

    if (this.migrate) {
      let migrated: T | undefined;
      try {
        migrated = this.migrate(stored.data, stored.schemaVersion);
      } catch {
        throw new StorageDataError(
          "MIGRATION_FAILED",
          "本地旧版本数据迁移失败，已停止加载以避免覆盖原数据。"
        );
      }
      if (migrated !== undefined && this.validate(migrated)) {
        await this.saveUnlocked(migrated);
        return cloneStorageValue(migrated);
      }
    }

    throw new StorageDataError(
      "MIGRATION_FAILED",
      "本地旧版本数据无法安全迁移，已停止加载以避免覆盖原数据。"
    );
  }

  /** Full replacement is for imports/fixtures; page edits must use update. */
  save(data: T): Promise<void> {
    const generation = this.resetGeneration;
    const snapshot = cloneStorageValue(data);
    return this.enqueue(async () => {
      this.assertGeneration(generation);
      await this.saveUnlocked(snapshot);
    });
  }

  /** Compute an immutable change from the latest persisted state inside the queue. */
  update(change: (current: T) => T | Promise<T>): Promise<T> {
    return this.transaction(async (current) => ({
      state: await change(current),
      value: undefined
    })).then((result) => result.state);
  }

  /** Callbacks compute state only; calling this repository inside one would deadlock. */
  transaction<R>(
    change: (current: T) =>
      | { state: T; value: R }
      | Promise<{ state: T; value: R }>
  ): Promise<{ state: T; value: R }> {
    const generation = this.resetGeneration;
    return this.enqueue(async () => {
      this.assertGeneration(generation);
      const current = await this.loadUnlocked();
      const result = await change(current);
      // Returning the input means no change (e.g. opening an existing menu).
      if (result.state !== current) await this.saveUnlocked(result.state);
      return { state: cloneStorageValue(result.state), value: result.value };
    });
  }

  private assertGeneration(expected: number): void {
    if (expected !== this.resetGeneration) {
      throw new Error("本地数据刚刚已清除，请重新打开当前页面后再操作。");
    }
  }

  private async saveUnlocked(data: T): Promise<void> {
    const envelope: StoredEnvelope<T> = {
      schemaVersion: this.schemaVersion,
      savedAt: new Date().toISOString(),
      data: cloneStorageValue(data)
    };
    await this.adapter.set(namespacedKey(this.logicalKey), envelope);
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      this.resetGeneration += 1;
      await this.adapter.remove(namespacedKey(this.logicalKey));
    });
  }

  clearOwnedData(): Promise<void> {
    return this.enqueue(async () => {
      this.resetGeneration += 1;
      await clearAllOwnedData(this.adapter);
    });
  }
}

/** Match WeChat storage's value semantics even with a reference-based adapter. */
function cloneStorageValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function clearAllOwnedData(
  adapter: StorageAdapter
): Promise<void> {
  const prefix = `${STORAGE_NAMESPACE}:`;
  const keys = await adapter.keys();
  const removals = await Promise.allSettled(
    keys.filter((key) => key.startsWith(prefix)).map((key) => adapter.remove(key))
  );
  const failed = removals.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

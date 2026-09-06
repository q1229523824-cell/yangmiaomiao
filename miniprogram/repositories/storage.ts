export const STORAGE_NAMESPACE = "fitness-couple";
export const CURRENT_SCHEMA_VERSION = 2;

export interface StorageAdapter {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface StoredEnvelope<T> {
  schemaVersion: number;
  savedAt: string;
  data: T;
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
      await wx.setStorage({ key, data: value });
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

  async load(): Promise<T> {
    const stored = await this.adapter.get<StoredEnvelope<T>>(
      namespacedKey(this.logicalKey)
    );

    if (!stored || typeof stored.schemaVersion !== "number") {
      return this.fallback();
    }

    if (stored.schemaVersion === this.schemaVersion) {
      return this.validate(stored.data) ? stored.data : this.fallback();
    }

    if (stored.schemaVersion < this.schemaVersion && this.migrate) {
      const migrated = this.migrate(stored.data, stored.schemaVersion);
      if (migrated !== undefined && this.validate(migrated)) {
        await this.save(migrated);
        return migrated;
      }
    }

    return this.fallback();
  }

  async save(data: T): Promise<void> {
    const envelope: StoredEnvelope<T> = {
      schemaVersion: this.schemaVersion,
      savedAt: new Date().toISOString(),
      data
    };
    await this.adapter.set(namespacedKey(this.logicalKey), envelope);
  }

  async clear(): Promise<void> {
    await this.adapter.remove(namespacedKey(this.logicalKey));
  }
}

export async function clearAllOwnedData(
  adapter: StorageAdapter
): Promise<void> {
  const prefix = `${STORAGE_NAMESPACE}:`;
  const keys = await adapter.keys();
  await Promise.all(
    keys.filter((key) => key.startsWith(prefix)).map((key) => adapter.remove(key))
  );
}

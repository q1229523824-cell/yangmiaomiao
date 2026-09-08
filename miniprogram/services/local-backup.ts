import {
  isAppState,
  migrateAppState,
  type AppState,
} from "../repositories/app-state";
import { CURRENT_SCHEMA_VERSION } from "../repositories/storage";

/** A deliberately explicit marker so arbitrary clipboard text is never treated as a backup. */
export const LOCAL_BACKUP_FORMAT = "fitness-couple-local-backup" as const;

/** Keep clipboard imports bounded like the single local-storage record. */
export const LOCAL_BACKUP_MAX_CHARS = 1_200_000;

export interface LocalBackupEnvelope {
  format: typeof LOCAL_BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: AppState;
}

export type LocalBackupErrorCode =
  | "EMPTY_INPUT"
  | "TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_FORMAT"
  | "UNSUPPORTED_FUTURE_SCHEMA"
  | "INVALID_DATA"
  | "MIGRATION_FAILED";

export class LocalBackupError extends Error {
  constructor(
    public readonly code: LocalBackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalBackupError";
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function assertEnvelope(value: unknown): asserts value is {
  format: unknown;
  schemaVersion: unknown;
  exportedAt: unknown;
  data: unknown;
} {
  if (!isRecord(value)) {
    throw new LocalBackupError(
      "INVALID_FORMAT",
      "剪贴板内容不是本小程序的备份格式。",
    );
  }
  if (value.format !== LOCAL_BACKUP_FORMAT) {
    throw new LocalBackupError(
      "INVALID_FORMAT",
      "剪贴板内容不是本小程序的备份，未写入本机数据。",
    );
  }
  if (
    !Number.isInteger(value.schemaVersion) ||
    (value.schemaVersion as number) < 1 ||
    !isValidDateString(value.exportedAt) ||
    !Object.prototype.hasOwnProperty.call(value, "data")
  ) {
    throw new LocalBackupError(
      "INVALID_FORMAT",
      "备份缺少有效的版本或导出时间，未写入本机数据。",
    );
  }
}

/** Build a portable, JSON-only snapshot from the latest persisted state. */
export function createLocalBackup(
  state: AppState,
  exportedAt = new Date().toISOString(),
): LocalBackupEnvelope {
  if (!isAppState(state)) {
    throw new LocalBackupError(
      "INVALID_DATA",
      "当前本地数据校验失败，无法生成备份。",
    );
  }
  if (!isValidDateString(exportedAt)) {
    throw new LocalBackupError("INVALID_FORMAT", "导出时间无效。");
  }
  return {
    format: LOCAL_BACKUP_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt,
    data: clone(state),
  };
}

export function serializeLocalBackup(
  state: AppState,
  exportedAt?: string,
): string {
  const serialized = JSON.stringify(createLocalBackup(state, exportedAt));
  if (serialized.length > LOCAL_BACKUP_MAX_CHARS) {
    throw new LocalBackupError(
      "TOO_LARGE",
      "本地历史太大，暂时无法复制备份；可先减少历史菜单后重试。",
    );
  }
  return serialized;
}

/**
 * Parse and validate clipboard content without touching storage. Older v1
 * snapshots use the same migration path as the repository; future versions
 * are rejected so an import can never downgrade or corrupt current data.
 */
export function parseLocalBackup(raw: string): AppState {
  const normalized = raw.trim();
  if (!normalized) {
    throw new LocalBackupError("EMPTY_INPUT", "剪贴板没有可恢复的本地备份。");
  }
  if (normalized.length > LOCAL_BACKUP_MAX_CHARS) {
    throw new LocalBackupError(
      "TOO_LARGE",
      "剪贴板内容过大，不像是本小程序生成的备份。",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized) as unknown;
  } catch {
    throw new LocalBackupError(
      "INVALID_JSON",
      "剪贴板内容不是有效的备份文本。",
    );
  }

  assertEnvelope(parsed);
  const schemaVersion = parsed.schemaVersion as number;
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new LocalBackupError(
      "UNSUPPORTED_FUTURE_SCHEMA",
      `备份来自更高版本（${schemaVersion}），请先更新小程序后再恢复。`,
    );
  }

  let state: AppState | undefined;
  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    state = isAppState(parsed.data) ? clone(parsed.data) : undefined;
  } else {
    try {
      state = migrateAppState(parsed.data, schemaVersion);
    } catch {
      state = undefined;
    }
  }
  if (!state || !isAppState(state)) {
    throw new LocalBackupError(
      schemaVersion < CURRENT_SCHEMA_VERSION
        ? "MIGRATION_FAILED"
        : "INVALID_DATA",
      "备份中的档案或菜单校验失败，未写入本机数据。",
    );
  }
  return clone(state);
}

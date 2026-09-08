import { describe, expect, it } from "vitest";
import {
  LOCAL_BACKUP_FORMAT,
  LOCAL_BACKUP_MAX_CHARS,
  LocalBackupError,
  parseLocalBackup,
  serializeLocalBackup,
} from "../miniprogram/services/local-backup";
import { createDefaultAppState } from "../miniprogram/repositories/app-state";
import { CURRENT_SCHEMA_VERSION } from "../miniprogram/repositories/storage";
import { ensureInitialPlan } from "../miniprogram/services/plan-service";

const EXPORTED_AT = "2026-09-08T04:00:00.000Z";

function stateWithPlan() {
  return ensureInitialPlan(createDefaultAppState(), {
    date: "2026-09-08",
    createdAt: EXPORTED_AT,
  }).state;
}

function expectBackupError(action: () => unknown, code: LocalBackupError["code"]): void {
  try {
    action();
    throw new Error("expected backup parsing to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(LocalBackupError);
    expect((error as LocalBackupError).code).toBe(code);
  }
}

describe("本地剪贴板备份", () => {
  it("round-trips a current app state without changing it", () => {
    const state = stateWithPlan();
    const serialized = serializeLocalBackup(state, EXPORTED_AT);

    expect(JSON.parse(serialized)).toMatchObject({
      format: LOCAL_BACKUP_FORMAT,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: EXPORTED_AT,
    });
    expect(parseLocalBackup(serialized)).toEqual(state);
  });

  it("rejects empty, foreign, malformed, and invalid state content", () => {
    expectBackupError(() => parseLocalBackup("  "), "EMPTY_INPUT");
    expectBackupError(() => parseLocalBackup("not json"), "INVALID_JSON");
    expectBackupError(
      () => parseLocalBackup(JSON.stringify({ format: "other" })),
      "INVALID_FORMAT",
    );
    expectBackupError(
      () =>
        parseLocalBackup(
          JSON.stringify({
            format: LOCAL_BACKUP_FORMAT,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            exportedAt: EXPORTED_AT,
            data: { broken: true },
          }),
        ),
      "INVALID_DATA",
    );
  });

  it("rejects future versions and oversized clipboard content before import", () => {
    const future = {
      format: LOCAL_BACKUP_FORMAT,
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      exportedAt: EXPORTED_AT,
      data: stateWithPlan(),
    };
    expectBackupError(() => parseLocalBackup(JSON.stringify(future)), "UNSUPPORTED_FUTURE_SCHEMA");
    expectBackupError(
      () => parseLocalBackup("x".repeat(LOCAL_BACKUP_MAX_CHARS + 1)),
      "TOO_LARGE",
    );
  });

  it("uses the repository migration path for schema v1 backups", () => {
    const state = stateWithPlan();
    const {
      planNeedsRefresh: _planNeedsRefresh,
      planRefreshReason: _planRefreshReason,
      ...legacyData
    } = state;
    const legacy = {
      format: LOCAL_BACKUP_FORMAT,
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
      data: legacyData,
    };

    const restored = parseLocalBackup(JSON.stringify(legacy));
    expect(restored.currentPlan?.id).toBe(state.currentPlan?.id);
    expect(restored.planNeedsRefresh).toBe(false);
    expect(restored.planRefreshReason).toBeNull();
  });
});

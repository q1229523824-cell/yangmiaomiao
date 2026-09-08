import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseLocalBackup } from "../miniprogram/services/local-backup";
import { serializeLocalBackup } from "../miniprogram/services/local-backup";
import { createDefaultAppState } from "../miniprogram/repositories/app-state";
import { namespacedKey } from "../miniprogram/repositories/storage";
import {
  installMiniProgramRuntime,
  type MiniProgramRuntime,
  type RuntimePage,
} from "./helpers/miniprogram-runtime";

interface BackupPage extends RuntimePage {
  data: RuntimePage["data"] & {
    pageError: string;
    savedMessage: string;
    loadFailed: boolean;
  };
  onShow(): Promise<void>;
  onExportBackup(): Promise<void>;
  onImportBackup(): Promise<void>;
}

let runtime: MiniProgramRuntime;

beforeEach(() => {
  vi.resetModules();
  runtime = installMiniProgramRuntime();
});

afterEach(() => {
  runtime.cleanup();
  vi.restoreAllMocks();
});

describe("profile local backup actions", () => {
  it("copies the latest committed state and restores it through the repository queue", async () => {
    await import("../miniprogram/pages/profile/profile");
    const page = runtime.createPage<BackupPage>();
    await page.onShow();

    await page.onExportBackup();
    expect(runtime.wx.setClipboardData).toHaveBeenCalledTimes(1);
    const copied = runtime.wx.setClipboardData.mock.calls[0][0].data as string;
    expect(parseLocalBackup(copied).profiles).toHaveLength(2);
    expect(page.data.savedMessage).toContain("本地备份已复制");

    await page.onImportBackup();
    expect(runtime.wx.getClipboardData).toHaveBeenCalledTimes(1);
    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(1);
    expect(page.data.loadFailed).toBe(false);
    expect(page.data.savedMessage).toContain("本地备份已恢复");
    expect(runtime.storage.has(namespacedKey("app-state"))).toBe(true);
  });

  it("does not write storage when the clipboard is not a valid backup", async () => {
    await import("../miniprogram/pages/profile/profile");
    const page = runtime.createPage<BackupPage>();
    await page.onShow();
    await runtime.wx.setClipboardData({ data: "not a backup" });
    const writesBefore = runtime.wx.setStorage.mock.calls.length;

    await page.onImportBackup();

    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(writesBefore);
    expect(page.data.pageError).toContain("恢复备份失败");
    expect(page.data.pageError).toContain("不是有效的备份文本");
  });

  it("can recover from a corrupt local envelope after confirming a valid backup", async () => {
    const key = namespacedKey("app-state");
    runtime.storage.set(key, {
      schemaVersion: 2,
      savedAt: "2026-09-08T00:00:00.000Z",
      data: "corrupt",
    });
    await import("../miniprogram/pages/profile/profile");
    const page = runtime.createPage<BackupPage>();
    await page.onShow();
    expect(page.data.loadFailed).toBe(true);

    await runtime.wx.setClipboardData({
      data: serializeLocalBackup(createDefaultAppState()),
    });
    await page.onImportBackup();

    expect(page.data.loadFailed).toBe(false);
    expect(page.data.pageError).toBe("");
    expect((runtime.storage.get(key) as any).data.profiles).toHaveLength(2);
  });
});

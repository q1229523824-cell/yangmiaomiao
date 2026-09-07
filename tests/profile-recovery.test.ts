import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { namespacedKey } from "../miniprogram/repositories/storage";
import {
  installMiniProgramRuntime,
  type MiniProgramRuntime,
  type RuntimePage,
} from "./helpers/miniprogram-runtime";

interface ProfileRecoveryPage extends RuntimePage {
  data: RuntimePage["data"] & {
    drafts: unknown[];
    loadFailed: boolean;
    pageError: string;
  };
  onShow(): Promise<void>;
  onClearData(): Promise<void>;
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

describe("profile cache recovery", () => {
  it("keeps invalid data intact until the user confirms a destructive reset", async () => {
    const key = namespacedKey("app-state");
    const invalidEnvelope = {
      schemaVersion: 2,
      savedAt: "2026-09-07T00:00:00.000Z",
      data: "broken",
    };
    runtime.storage.set(key, invalidEnvelope);

    await import("../miniprogram/pages/profile/profile");
    const page = runtime.createPage<ProfileRecoveryPage>();
    await page.onShow();

    expect(page.data.loadFailed).toBe(true);
    expect(page.data.pageError).toContain("避免覆盖原数据");
    expect(runtime.storage.get(key)).toEqual(invalidEnvelope);
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();

    runtime.wx.showModal.mockResolvedValueOnce({
      confirm: false,
      cancel: true,
      errMsg: "showModal:ok",
    });
    await page.onClearData();

    expect(runtime.storage.get(key)).toEqual(invalidEnvelope);
    expect(runtime.wx.removeStorage).not.toHaveBeenCalled();
    expect(page.data.loadFailed).toBe(true);
    expect(page.data.pageError).toContain("避免覆盖原数据");

    await page.onClearData();

    expect(runtime.wx.showModal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("清除本地数据"),
        content: expect.stringMatching(/档案.*历史/),
      }),
    );
    expect(runtime.storage.has(key)).toBe(false);
    expect(page.data.loadFailed).toBe(false);
    expect(page.data.pageError).toBe("");
    expect(page.data.drafts).toHaveLength(2);
  });
});

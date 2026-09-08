import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installMiniProgramRuntime,
  type MiniProgramRuntime,
  type RuntimePage,
} from "./helpers/miniprogram-runtime";

interface ProfilePage extends RuntimePage {
  data: RuntimePage["data"] & {
    hasUnsavedChanges: boolean;
    drafts: Array<{ heightCm: string; errors: { heightCm?: string } }>;
  };
  onShow(): Promise<void>;
  onDraftInput(event: unknown): void;
  onSave(): Promise<void>;
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

async function invalidProfilePage(memberIndex: number): Promise<ProfilePage> {
  await import("../miniprogram/pages/profile/profile");
  const page = runtime.createPage<ProfilePage>();
  await page.onShow();
  page.onDraftInput({
    currentTarget: { dataset: { index: memberIndex, field: "heightCm" } },
    detail: { value: "0" },
  });
  return page;
}

describe("profile validation navigation", () => {
  it.each([0, 1])("scrolls to invalid member %i without saving or discarding edits", async (memberIndex) => {
    const page = await invalidProfilePage(memberIndex);
    await page.onSave();

    expect(runtime.wx.pageScrollTo).toHaveBeenCalledWith({
      selector: `#profile-member-${memberIndex}`, duration: 250,
    });
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();
    expect(page.data.hasUnsavedChanges).toBe(true);
    expect(page.data.drafts[memberIndex].heightCm).toBe("0");
    expect(page.data.drafts[memberIndex].errors.heightCm).toBeTruthy();
  });

  it("surfaces the member number when scrolling fails and permits correction and retry", async () => {
    const page = await invalidProfilePage(1);
    runtime.wx.pageScrollTo.mockRejectedValueOnce(new Error("selector unavailable"));
    await expect(page.onSave()).resolves.toBeUndefined();
    expect(runtime.wx.showToast).toHaveBeenLastCalledWith({
      title: "请检查第 2 位成员", icon: "none",
    });
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();

    page.onDraftInput({
      currentTarget: { dataset: { index: 1, field: "heightCm" } },
      detail: { value: "179" },
    });
    await page.onSave();
    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(1);
    expect(page.data.hasUnsavedChanges).toBe(false);
  });
});

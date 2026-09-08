import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../miniprogram/repositories/app-state";
import { namespacedKey } from "../miniprogram/repositories/storage";
import {
  installMiniProgramRuntime,
  type MiniProgramRuntime,
  type RuntimePage,
} from "./helpers/miniprogram-runtime";

interface IndexPage extends RuntimePage {
  data: RuntimePage["data"] & {
    planNotice: string;
    generateButtonText: string;
    profiles: Array<{ name: string }>;
  };
  onShow(): Promise<void>;
  applyPreference(text: string): Promise<void>;
  onGenerateTap(): Promise<void>;
}
interface ProfilePage extends RuntimePage {
  data: RuntimePage["data"] & {
    drafts: Array<{ name: string; heightCm: string }>;
    hasUnsavedChanges: boolean;
    savedMessage: string;
    pageError: string;
  };
  onShow(): Promise<void>;
  onDraftInput(event: unknown): void;
  onSave(): Promise<void>;
  onClearData(): Promise<void>;
}
interface ShoppingPage extends RuntimePage {
  data: RuntimePage["data"] & {
    items: Array<{ foodId: string; checked: boolean }>;
    errorMessage: string;
    hasPlan: boolean;
    date: string;
  };
  onShow(): Promise<void>;
  onToggle(event: unknown): Promise<void>;
}
interface HistoryPage extends RuntimePage {
  data: RuntimePage["data"] & {
    errorMessage: string;
    items: Array<{ id: string; isCurrent: boolean }>;
  };
  onShow(): Promise<void>;
  onRestoreTap(event: unknown): Promise<void>;
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function delayNextWrite(fail = false) {
  const entered = deferred();
  const release = deferred();
  const write = runtime.wx.setStorage.getMockImplementation()!;
  runtime.wx.setStorage.mockImplementationOnce(async (...args: unknown[]) => {
    entered.resolve();
    await release.promise;
    if (fail) throw new Error("磁盘空间不足");
    return write(...args);
  });
  return { entered: entered.promise, release: release.resolve };
}

async function repository() {
  const { getAppStateRepository } = await import("../miniprogram/repositories/app-state");
  return getAppStateRepository();
}

async function seedState(): Promise<AppState> {
  const { createDefaultAppState } = await import("../miniprogram/repositories/app-state");
  const { regeneratePlan } = await import("../miniprogram/services/plan-service");
  const state = regeneratePlan(createDefaultAppState(), {
    date: "2026-09-08", createdAt: "2026-09-08T08:00:00.000Z",
  });
  await (await repository()).save(state);
  return state;
}

async function pages() {
  await import("../miniprogram/pages/index/index");
  const index = runtime.createPage<IndexPage>();
  await import("../miniprogram/pages/profile/profile");
  const profile = runtime.createPage<ProfilePage>();
  await import("../miniprogram/pages/shopping/shopping");
  const shopping = runtime.createPage<ShoppingPage>();
  await import("../miniprogram/pages/history/history");
  const history = runtime.createPage<HistoryPage>();
  await Promise.all([index.onShow(), profile.onShow(), shopping.onShow(), history.onShow()]);
  return { index, profile, shopping, history };
}

function editHeight(profile: ProfilePage, height: number) {
  profile.onDraftInput({
    currentTarget: { dataset: { index: 0, field: "heightCm" } },
    detail: { value: String(height) },
  });
}

describe("cross-page persistence", () => {
  it("merges a delayed shopping toggle and profile save without changing the menu", async () => {
    const initial = await seedState();
    const { profile, shopping } = await pages();
    const foodId = shopping.data.items[0].foodId;
    const nextHeight = initial.profiles[0].heightCm + 1;
    editHeight(profile, nextHeight);
    const delay = delayNextWrite();

    const toggle = shopping.onToggle({ detail: { value: [foodId] } });
    await delay.entered;
    const save = profile.onSave();
    delay.release();
    await Promise.all([toggle, save]);

    const current = await (await repository()).load();
    expect(current.checkedFoodIdsByPlanId[initial.currentPlan!.id]).toEqual([foodId]);
    expect(current.profiles[0].heightCm).toBe(nextHeight);
    expect(current.currentPlan).toEqual(initial.currentPlan);
    expect(current.planRefreshReason).toBe("profile_changed");
  });

  it("keeps a queued toggle attached to the clicked menu while preferences generate a new menu", async () => {
    const initial = await seedState();
    const { index, shopping } = await pages();
    const foodId = shopping.data.items[0].foodId;
    const delay = delayNextWrite();

    const preference = index.applyPreference("不要番茄");
    await delay.entered;
    const toggle = shopping.onToggle({ detail: { value: [foodId] } });
    delay.release();
    await Promise.all([preference, toggle]);

    const current = await (await repository()).load();
    expect(current.currentPlan?.id).not.toBe(initial.currentPlan!.id);
    expect(current.preferences.excludedFoodIds).toContain("tomato");
    expect(current.checkedFoodIdsByPlanId[initial.currentPlan!.id]).toEqual([foodId]);
    expect(current.checkedFoodIdsByPlanId[current.currentPlan!.id]).toBeUndefined();
    expect(current.currentPlan?.meals.flatMap((meal) => meal.items.map((item) => item.foodId)))
      .not.toContain("tomato");
    expect(current.generationCounter).toBe(2);
  });

  it("parses a preference against the latest pending allergy record rather than the page cache", async () => {
    await seedState();
    const { index } = await pages();
    const repo = await repository();
    const { preparePreferencePlanChange } = await import("../miniprogram/services/plan-service");
    const delay = delayNextWrite();
    const allergy = repo.update((latest) => preparePreferencePlanChange(latest, {
      ...latest.preferences, allergens: ["milk"],
    }, { date: "2026-09-08" }).state);
    await delay.entered;
    const preference = index.applyPreference("不要番茄");
    delay.release();
    await Promise.all([allergy, preference]);

    const current = await repo.load();
    expect(current.preferences.allergens).toEqual(["milk"]);
    expect(current.preferences.excludedFoodIds).toContain("tomato");
    expect(current.currentPlan?.preferencesSnapshot.allergens).toEqual(["milk"]);
    expect(current.currentPlan?.preferencesSnapshot.excludedFoodIds).toContain("tomato");
    expect(current.generationCounter).toBe(3);
  });

  it("restores history only after checking allergies committed while confirmation was open", async () => {
    const initial = await seedState();
    const { DEFAULT_PROFILES, DEFAULT_PREFERENCES } = await import("../miniprogram/data/catalog");
    const { generateDailyPlan } = await import("../miniprogram/domain/menu-generator");
    const unsafe = Array.from({ length: 32 }, (_, seed) => generateDailyPlan({
      date: "2026-09-07", seed, profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES, createdAt: "2026-09-07T08:00:00.000Z",
    })).find((plan) => plan.meals.some((meal) => meal.items.some((item) =>
      ["greek_yogurt", "skim_milk", "whey_protein"].includes(item.foodId)
    )))!;
    expect(unsafe).toBeDefined();
    const repo = await repository();
    await repo.save({ ...initial, history: [initial.currentPlan!, unsafe] });
    const { index, history } = await pages();
    const modal = deferred();
    runtime.wx.showModal.mockImplementationOnce(async () => {
      await modal.promise;
      return { confirm: true, cancel: false, errMsg: "showModal:ok" };
    });

    const restore = history.onRestoreTap({ currentTarget: { dataset: { planId: unsafe.id } } });
    await index.applyPreference("牛奶过敏");
    const safePlanId = (await repo.load()).currentPlan!.id;
    modal.resolve();
    await restore;

    expect(history.data.errorMessage).toContain("过敏原");
    const current = await repo.load();
    expect(current.preferences.allergens).toEqual(["milk"]);
    expect(current.currentPlan!.id).toBe(safePlanId);
    expect(runtime.wx.switchTab).not.toHaveBeenCalled();
  });

  it("does not leak a failed shopping edit, and a queued profile save plus later retry succeeds", async () => {
    const initial = await seedState();
    const { profile, shopping } = await pages();
    const foodId = shopping.data.items[0].foodId;
    editHeight(profile, initial.profiles[0].heightCm + 1);
    const delay = delayNextWrite(true);

    const toggle = shopping.onToggle({ detail: { value: [foodId] } });
    await delay.entered;
    const save = profile.onSave();
    delay.release();
    await Promise.all([toggle, save]);
    const repo = await repository();
    const afterFailure = await repo.load();
    expect(afterFailure.checkedFoodIdsByPlanId[initial.currentPlan!.id]).toBeUndefined();
    expect(afterFailure.profiles[0].heightCm).toBe(initial.profiles[0].heightCm + 1);
    expect(shopping.data.errorMessage).toContain("保存勾选失败");
    expect(shopping.data.items.find((item) => item.foodId === foodId)?.checked).toBe(false);

    await shopping.onToggle({ detail: { value: [foodId] } });
    const afterRetry = await repo.load();
    expect(afterRetry.checkedFoodIdsByPlanId[initial.currentPlan!.id]).toEqual([foodId]);
    expect(afterRetry.profiles[0].heightCm).toBe(initial.profiles[0].heightCm + 1);
  });

  it("clears after an in-flight write and refuses stale shopping clicks without reviving deleted data", async () => {
    await seedState();
    const { profile, shopping } = await pages();
    const foodId = shopping.data.items[0].foodId;
    const delay = delayNextWrite();
    const toggle = shopping.onToggle({ detail: { value: [foodId] } });
    await delay.entered;
    const clear = profile.onClearData();
    await vi.waitFor(() => expect(runtime.wx.showModal).toHaveBeenCalled());
    delay.release();
    await Promise.all([toggle, clear]);
    expect(runtime.storage.has(namespacedKey("app-state"))).toBe(false);

    runtime.wx.setStorage.mockClear();
    await shopping.onToggle({ detail: { value: [foodId] } });
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();
    expect(runtime.storage.has(namespacedKey("app-state"))).toBe(false);
    expect(shopping.data.hasPlan).toBe(false);
    expect(shopping.data.items).toEqual([]);
    expect(shopping.data.errorMessage).toContain("原菜单已不存在");
  });
});

describe("deferred page visibility refresh", () => {
  it("coalesces today-page onShow requests during a preference save and renders the later profile change", async () => {
    const initial = await seedState();
    const { index, profile } = await pages();
    editHeight(profile, initial.profiles[0].heightCm + 1);
    runtime.wx.getStorage.mockClear();
    const delay = delayNextWrite();
    const preference = index.applyPreference("不要番茄");
    await delay.entered;
    const save = profile.onSave();
    await Promise.all([index.onShow(), index.onShow()]);
    delay.release();
    await Promise.all([preference, save]);

    expect(index.data.planNotice).toContain("档案已更新");
    expect(index.data.generateButtonText).toBe("按新设置重算");
    // One read per mutation plus one coalesced visibility refresh.
    expect(runtime.wx.getStorage).toHaveBeenCalledTimes(3);
    expect((await (await repository()).load()).generationCounter).toBe(2);
  });

  it("refreshes the shopping view after a toggle when a later queued preference saves another menu", async () => {
    const initial = await seedState();
    const { index, shopping } = await pages();
    const selected = shopping.data.items[0].foodId;
    const delay = delayNextWrite();
    const toggle = shopping.onToggle({ detail: { value: [selected] } });
    await delay.entered;
    const preference = index.applyPreference("不要番茄");
    await shopping.onShow();
    delay.release();
    await Promise.all([toggle, preference]);

    const current = await (await repository()).load();
    expect(current.checkedFoodIdsByPlanId[initial.currentPlan!.id]).toEqual([selected]);
    expect(current.currentPlan!.id).not.toBe(initial.currentPlan!.id);
    expect(shopping.data.items.length).toBeGreaterThan(0);
    expect(shopping.data.items.every((item) => !item.checked)).toBe(true);
    expect(shopping.data.items.map((item) => item.foodId)).not.toContain("tomato");
  });

  it("refreshes history after a restore if another tab generates a newer menu before it becomes visible", async () => {
    const initial = await seedState();
    const repo = await repository();
    const { regeneratePlan } = await import("../miniprogram/services/plan-service");
    await repo.update((latest) => regeneratePlan(latest, { date: "2026-09-08" }));
    const { index, history } = await pages();
    const delay = delayNextWrite();
    const restore = history.onRestoreTap({ currentTarget: { dataset: { planId: initial.currentPlan!.id } } });
    await delay.entered;
    const generate = index.onGenerateTap();
    await history.onShow();
    delay.release();
    await Promise.all([restore, generate]);

    const current = await repo.load();
    expect(history.data.items.find((item) => item.isCurrent)?.id).toBe(current.currentPlan!.id);
    expect(history.data.items).toHaveLength(3);
  });

  it("refreshes a saved profile after busy onShow while retaining the save confirmation", async () => {
    const initial = await seedState();
    const { profile } = await pages();
    const repo = await repository();
    editHeight(profile, initial.profiles[0].heightCm + 1);
    const delay = delayNextWrite();
    const save = profile.onSave();
    await delay.entered;
    const rename = repo.update((latest) => ({
      ...latest,
      profiles: latest.profiles.map((item, index) => index === 0 ? { ...item, name: "新称呼" } : item),
    }));
    await profile.onShow();
    delay.release();
    await Promise.all([save, rename]);

    expect(profile.data.drafts[0].name).toBe("新称呼");
    expect(profile.data.hasUnsavedChanges).toBe(false);
    expect(profile.data.savedMessage).toContain("已保存在本机");
  });

  it("keeps failed profile drafts and errors when onShow occurred during the failing save", async () => {
    const initial = await seedState();
    const { profile } = await pages();
    const nextHeight = initial.profiles[0].heightCm + 1;
    editHeight(profile, nextHeight);
    const delay = delayNextWrite(true);
    const save = profile.onSave();
    await delay.entered;
    await profile.onShow();
    delay.release();
    await save;

    expect(profile.data.drafts[0].heightCm).toBe(String(nextHeight));
    expect(profile.data.hasUnsavedChanges).toBe(true);
    expect(profile.data.pageError).toContain("磁盘空间不足");
    expect((await (await repository()).load()).profiles[0].heightCm).toBe(initial.profiles[0].heightCm);
  });

  it.each(["index", "profile", "shopping", "history"] as const)(
    "%s reloads once when onShow occurs during an earlier read",
    async (pageName) => {
      await seedState();
      const allPages = await pages();
      const repo = await repository();
      const { regeneratePlan } = await import("../miniprogram/services/plan-service");
      const entered = deferred();
      const release = deferred();
      const read = runtime.wx.getStorage.getMockImplementation()!;
      runtime.wx.getStorage.mockClear();
      runtime.wx.getStorage.mockImplementationOnce(async (...args: unknown[]) => {
        const snapshot = await read(...args);
        entered.resolve();
        await release.promise;
        return snapshot;
      });
      const page = allPages[pageName];
      const loading = page.onShow();
      await entered.promise;
      const change = repo.update((latest) => regeneratePlan({
        ...latest,
        profiles: latest.profiles.map((profile, index) => index === 0 ? { ...profile, name: "最新称呼" } : profile),
      }, { date: "2026-09-09" }));
      await Promise.all([page.onShow(), page.onShow()]);
      release.resolve();
      await Promise.all([loading, change]);

      expect(runtime.wx.getStorage).toHaveBeenCalledTimes(3);
      if (pageName === "index") expect(allPages.index.data.profiles[0].name).toBe("最新称呼");
      if (pageName === "profile") expect(allPages.profile.data.drafts[0].name).toBe("最新称呼");
      if (pageName === "shopping") expect(allPages.shopping.data.date).toBe("2026-09-09");
      if (pageName === "history") expect(allPages.history.data.items).toHaveLength(2);
      expect((await repo.load()).generationCounter).toBe(2);
    },
  );
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyPlan } from "../miniprogram/domain/models";
import type { AppState } from "../miniprogram/repositories/app-state";
import {
  namespacedKey,
  type StoredEnvelope,
} from "../miniprogram/repositories/storage";
import {
  installMiniProgramRuntime,
  type MiniProgramRuntime,
  type RuntimePage,
} from "./helpers/miniprogram-runtime";

interface IndexPage extends RuntimePage {
  data: RuntimePage["data"] & {
    busy: boolean;
    preferenceInput: string;
    meals: unknown[];
  };
  onShow(): Promise<void>;
  onPreferenceInput(event: unknown): void;
  onPreferenceSubmit(): void;
}

interface ProfilePage extends RuntimePage {
  data: RuntimePage["data"] & {
    hasUnsavedChanges: boolean;
  };
  onShow(): Promise<void>;
  onDraftInput(event: unknown): void;
  onSave(): Promise<void>;
}

interface ShoppingPage extends RuntimePage {
  data: RuntimePage["data"] & {
    busy: boolean;
    canUsePlan: boolean;
    items: Array<{ foodId: string; checked: boolean }>;
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

async function loadIndexPage(): Promise<IndexPage> {
  await import("../miniprogram/pages/index/index");
  return runtime.createPage<IndexPage>();
}

async function savedState(): Promise<AppState> {
  const { getAppStateRepository } = await import(
    "../miniprogram/repositories/app-state"
  );
  return getAppStateRepository().load();
}

async function saveState(state: AppState): Promise<void> {
  const { getAppStateRepository } = await import(
    "../miniprogram/repositories/app-state"
  );
  await getAppStateRepository().save(state);
}

async function createGeneratedState(): Promise<AppState> {
  const { createDefaultAppState } = await import(
    "../miniprogram/repositories/app-state"
  );
  const { regeneratePlan } = await import(
    "../miniprogram/services/plan-service"
  );
  return regeneratePlan(createDefaultAppState(), {
    date: "2026-09-07",
    createdAt: "2026-09-07T08:00:00.000Z",
  });
}

describe("Mini Program storage runtime", () => {
  it("uses JSON value semantics and rejects a value over one key's byte budget", async () => {
    const original = { nested: { value: 1 } };
    await runtime.wx.setStorage({ key: "round-trip", data: original });

    original.nested.value = 2;
    const firstRead = await runtime.wx.getStorage({ key: "round-trip" });
    expect(firstRead.data).toEqual({ nested: { value: 1 } });

    firstRead.data.nested.value = 3;
    await expect(
      runtime.wx.getStorage({ key: "round-trip" }),
    ).resolves.toEqual({ data: { nested: { value: 1 } } });

    await expect(
      runtime.wx.setStorage({
        key: "too-large",
        data: "x".repeat(1_000_001),
      }),
    ).rejects.toMatchObject({
      errMsg: expect.stringContaining("exceeds 1000000 bytes"),
    });
    expect(runtime.storage.has("too-large")).toBe(false);
  });
});

describe("WeChat page controllers", () => {
  it("首次进入生成并保存菜单，冷重启后保持同一快照", async () => {
    const firstPage = await loadIndexPage();

    await firstPage.onShow();
    const first = await savedState();
    expect(first.currentPlan).not.toBeNull();
    expect(first.generationCounter).toBe(1);
    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(1);

    runtime.resetPageRegistration();
    vi.resetModules();
    const restartedPage = await loadIndexPage();
    await restartedPage.onShow();
    const reopened = await savedState();
    expect(reopened.currentPlan?.id).toBe(first.currentPlan?.id);
    expect(reopened.currentPlan).toEqual(first.currentPlan);
    expect(reopened.generationCounter).toBe(1);
    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(1);
  });

  it("从首页输入“不要番茄”后持久化硬排除且新菜单不含番茄", async () => {
    const page = await loadIndexPage();
    await page.onShow();
    const oldPlanId = (await savedState()).currentPlan?.id;

    page.onPreferenceInput({
      currentTarget: { dataset: {} },
      detail: { value: "不要番茄" },
    });
    page.onPreferenceSubmit();
    await vi.waitFor(() =>
      expect(runtime.wx.setStorage).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() => {
      const envelope = runtime.storage.get(
        namespacedKey("app-state"),
      ) as StoredEnvelope<AppState> | undefined;
      expect(envelope?.data.preferences.excludedFoodIds).toContain("tomato");
    });
    await vi.waitFor(() => expect(page.data.busy).toBe(false));

    const state = await savedState();
    const foodIds =
      state.currentPlan?.meals.flatMap((meal) =>
        meal.items.map((item) => item.foodId),
      ) ?? [];
    const visibleMealNames = state.currentPlan?.meals.map((meal) => meal.name) ?? [];
    expect(state.preferences.excludedFoodIds).toContain("tomato");
    expect(state.currentPlan?.preferencesSnapshot.excludedFoodIds).toContain(
      "tomato",
    );
    expect(state.currentPlan?.id).not.toBe(oldPlanId);
    expect(foodIds).not.toContain("tomato");
    expect(visibleMealNames.some((name) => name.includes("番茄"))).toBe(false);
    expect(state.planNeedsRefresh).toBe(false);
  });

  it("档案页修改身高并保存时保留旧菜单，同时标记需要主动重算", async () => {
    const initial = await createGeneratedState();
    await saveState(initial);
    const oldPlan = structuredClone(initial.currentPlan) as DailyPlan;
    const originalHeight = oldPlan.profilesSnapshot[0].heightCm;
    const updatedHeight = originalHeight < 230
      ? originalHeight + 1
      : originalHeight - 1;

    await import("../miniprogram/pages/profile/profile");
    const page = runtime.createPage<ProfilePage>();
    await page.onShow();
    page.onDraftInput({
      currentTarget: { dataset: { index: 0, field: "heightCm" } },
      detail: { value: String(updatedHeight) },
    });
    expect(page.data.hasUnsavedChanges).toBe(true);

    await page.onSave();
    const state = await savedState();
    expect(state.profiles[0].heightCm).toBe(updatedHeight);
    expect(state.currentPlan).toEqual(oldPlan);
    expect(state.currentPlan?.profilesSnapshot[0].heightCm).toBe(originalHeight);
    expect(state.planNeedsRefresh).toBe(true);
    expect(state.planRefreshReason).toBe("profile_changed");
  });

  it("购物页勾选食材后保存到对应菜单，并在再次进入时恢复", async () => {
    const initial = await createGeneratedState();
    await saveState(initial);

    await import("../miniprogram/pages/shopping/shopping");
    const page = runtime.createPage<ShoppingPage>();
    await page.onShow();
    expect(page.data.canUsePlan).toBe(true);
    expect(page.data.items.length).toBeGreaterThan(0);
    const selectedFoodId = page.data.items[0].foodId;

    await page.onToggle({ detail: { value: [selectedFoodId] } });
    const state = await savedState();
    expect(state.checkedFoodIdsByPlanId[initial.currentPlan!.id]).toEqual([
      selectedFoodId,
    ]);

    await page.onShow();
    expect(
      page.data.items.find((item) => item.foodId === selectedFoodId)?.checked,
    ).toBe(true);
  });

  it("历史页拒绝恢复含当前过敏原的旧菜单且不覆盖本地状态", async () => {
    const { DEFAULT_PREFERENCES, DEFAULT_PROFILES } = await import(
      "../miniprogram/data/catalog"
    );
    const { generateDailyPlan } = await import(
      "../miniprogram/domain/menu-generator"
    );
    const { createDefaultAppState } = await import(
      "../miniprogram/repositories/app-state"
    );

    const unsafePlan = Array.from({ length: 64 }, (_, seed) =>
      generateDailyPlan({
        date: "2026-09-06",
        profiles: DEFAULT_PROFILES,
        preferences: DEFAULT_PREFERENCES,
        seed,
        createdAt: "2026-09-06T08:00:00.000Z",
      }),
    ).find((plan) =>
      plan.meals
        .flatMap((meal) => meal.items)
        .some((item) =>
          ["greek_yogurt", "skim_milk", "whey_protein"].includes(item.foodId),
        ),
    );
    expect(unsafePlan).toBeDefined();
    if (!unsafePlan) throw new Error("测试目录中没有乳制品历史菜单");

    const safePreferences = {
      ...DEFAULT_PREFERENCES,
      allergens: ["milk" as const],
    };
    const currentPlan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: safePreferences,
      seed: 100,
      createdAt: "2026-09-07T08:00:00.000Z",
    });
    const initial: AppState = {
      ...createDefaultAppState(),
      preferences: safePreferences,
      currentPlan,
      history: [currentPlan, unsafePlan],
      generationCounter: 2,
    };
    await saveState(initial);

    await import("../miniprogram/pages/history/history");
    const page = runtime.createPage<HistoryPage>();
    await page.onShow();
    runtime.wx.setStorage.mockClear();

    await page.onRestoreTap({
      currentTarget: { dataset: { planId: unsafePlan.id } },
    });

    expect(page.data.errorMessage).toContain("过敏原");
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();
    expect(runtime.wx.switchTab).not.toHaveBeenCalled();
    expect((await savedState()).currentPlan?.id).toBe(currentPlan.id);
  });
});

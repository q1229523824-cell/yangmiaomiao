import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
} from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import { toHistoryPlanViewModels } from "../miniprogram/presentation/history-view-models";
import {
  MAX_LOCAL_HISTORY,
  createDefaultAppState,
} from "../miniprogram/repositories/app-state";
import {
  HistoryPlanNotFoundError,
  HistoryPlanSafetyError,
  restorePlanFromHistory,
} from "../miniprogram/services/history-service";

function plan(seed: number, date = "2026-09-07") {
  return generateDailyPlan({
    date,
    profiles: DEFAULT_PROFILES,
    preferences: {
      ...DEFAULT_PREFERENCES,
      excludedFoodIds: seed % 2 === 0 ? ["tomato"] : [],
    },
    seed,
    createdAt: `2026-09-07T08:${String(seed % 60).padStart(2, "0")}:00`,
  });
}

describe("history view models", () => {
  it("最多展示 60 份，并包含日期、时间、三餐和两人热量", () => {
    const history = Array.from({ length: MAX_LOCAL_HISTORY + 5 }, (_, index) =>
      plan(index, `2026-09-${String((index % 28) + 1).padStart(2, "0")}`),
    );

    const items = toHistoryPlanViewModels(history, history[1].id);

    expect(items).toHaveLength(MAX_LOCAL_HISTORY);
    expect(items[0].id).toBe(history[0].id);
    expect(items[1].isCurrent).toBe(true);
    expect(items[0].dateLabel).toMatch(/^2026年\d+月\d+日$/);
    expect(items[0].createdAtLabel).toMatch(/^2026-09-07 \d{2}:\d{2}$/);
    expect(items[0].meals.map((meal) => meal.type)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
    ]);
    expect(items[0].meals.every((meal) => meal.name !== "未记录")).toBe(true);
    expect(items[0].calories).toHaveLength(2);
    expect(items[0].calories.every((item) => /^\d+(?:\.\d+)? kcal$/.test(item.value))).toBe(
      true,
    );
  });

  it("对不完整展示字段使用安全占位文本", () => {
    const incomplete = plan(1);
    incomplete.meals = incomplete.meals.filter((meal) => meal.type !== "dinner");
    incomplete.createdAt = "not-a-date";

    const [item] = toHistoryPlanViewModels([incomplete]);

    expect(item.meals.find((meal) => meal.type === "dinner")?.name).toBe("未记录");
    expect(item.createdAtLabel).toBe("生成时间未知");
  });
});

describe("restorePlanFromHistory", () => {
  it("恢复选中快照及其偏好，同时保留当前可编辑档案和历史", () => {
    const older = plan(2, "2026-09-06");
    const latest = plan(3, "2026-09-07");
    const state = {
      ...createDefaultAppState(),
      profiles: createDefaultAppState().profiles.map((profile) => ({
        ...profile,
        name: `${profile.name}-当前档案`,
      })),
      preferences: {
        ...DEFAULT_PREFERENCES,
        excludedFoodIds: ["chicken_breast"],
      },
      currentPlan: latest,
      history: [latest, older],
      generationCounter: 9,
      planNeedsRefresh: true,
      planRefreshReason: "preferences_changed" as const,
    };

    const restored = restorePlanFromHistory(state, older.id);

    expect(restored.currentPlan).toBe(older);
    expect(restored.preferences).toEqual(older.preferencesSnapshot);
    expect(restored.preferences).not.toBe(older.preferencesSnapshot);
    expect(restored.preferences.excludedFoodIds).not.toBe(
      older.preferencesSnapshot.excludedFoodIds,
    );
    expect(restored.profiles).toBe(state.profiles);
    expect(restored.history).toEqual([older, latest]);
    expect(state.history).toEqual([latest, older]);
    expect(restored.generationCounter).toBe(9);
    expect(restored.planNeedsRefresh).toBe(true);
    expect(restored.planRefreshReason).toBe("profile_changed");
    expect(state.currentPlan).toBe(latest);
  });

  it("档案仍与历史快照一致时恢复后无需重新计算", () => {
    const older = plan(2, "2026-09-06");
    const latest = plan(3, "2026-09-07");
    const state = {
      ...createDefaultAppState(),
      currentPlan: latest,
      history: [latest, older],
      planNeedsRefresh: true,
      planRefreshReason: "preferences_changed" as const,
    };

    const restored = restorePlanFromHistory(state, older.id);

    expect(restored.planNeedsRefresh).toBe(false);
    expect(restored.planRefreshReason).toBeNull();
  });

  it("含当前过敏原的历史菜单会被拒绝且原状态保持不变", () => {
    const older = Array.from({ length: 32 }, (_, seed) => plan(seed)).find(
      (candidate) =>
        candidate.meals
          .flatMap((meal) => meal.items)
          .some((item) =>
            ["greek_yogurt", "skim_milk", "whey_protein"].includes(item.foodId),
          ),
    );
    expect(older).toBeDefined();
    if (!older) throw new Error("测试目录中没有可验证的乳制品菜单");
    const state = {
      ...createDefaultAppState(),
      preferences: {
        ...DEFAULT_PREFERENCES,
        allergens: ["milk" as const],
      },
      currentPlan: older,
      history: [older],
    };

    const before = structuredClone(state);
    expect(() => restorePlanFromHistory(state, older.id)).toThrowError(
      HistoryPlanSafetyError,
    );
    expect(state).toEqual(before);
  });

  it("找不到快照时显式失败且不修改原状态", () => {
    const state = createDefaultAppState();
    const before = structuredClone(state);

    expect(() => restorePlanFromHistory(state, "missing-plan")).toThrowError(
      HistoryPlanNotFoundError,
    );
    expect(state).toEqual(before);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, DEFAULT_PROFILES } from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import {
  MAX_LOCAL_HISTORY,
  appendPlanToHistory,
  createDefaultAppState,
  isAppState,
  migrateAppState,
  refreshFlagsAfterProfileSave
} from "../miniprogram/repositories/app-state";

describe("app state", () => {
  it("creates independent default state values", () => {
    const first = createDefaultAppState();
    const second = createDefaultAppState();
    first.profiles[0].name = "改名";
    first.preferences.excludedFoodIds.push("chicken_breast");

    expect(second.profiles[0].name).toBe("女生");
    expect(second.preferences.excludedFoodIds).toEqual([]);
  });

  it("keeps bounded, newest-first immutable menu history", () => {
    let state = createDefaultAppState();
    for (let seed = 0; seed < MAX_LOCAL_HISTORY + 3; seed += 1) {
      const plan = generateDailyPlan({
        date: `2026-09-${String((seed % 28) + 1).padStart(2, "0")}`,
        profiles: DEFAULT_PROFILES,
        preferences: DEFAULT_PREFERENCES,
        seed,
        createdAt: `2026-09-07T00:00:${String(seed).padStart(2, "0")}.000Z`
      });
      state = appendPlanToHistory(state, plan);
    }

    expect(state.history).toHaveLength(MAX_LOCAL_HISTORY);
    expect(state.history[0].seed).toBe(MAX_LOCAL_HISTORY + 2);
    expect(state.currentPlan?.id).toBe(state.history[0].id);
  });

  it("rejects malformed nested cache values instead of loading them", () => {
    expect(
      isAppState({
        profiles: [{}],
        preferences: {},
        currentPlan: "broken",
        history: [],
        generationCounter: Number.NaN,
        checkedFoodIdsByPlanId: "broken",
        planNeedsRefresh: false,
        planRefreshReason: null
      })
    ).toBe(false);
  });

  it("rejects unknown cached safety enum values", () => {
    const state = createDefaultAppState();
    expect(
      isAppState({
        ...state,
        preferences: {
          ...state.preferences,
          allergens: ["milk_typo"]
        }
      })
    ).toBe(false);
  });

  it("rejects a cached plan with an unsupported meal type", () => {
    const state = createDefaultAppState();
    const plan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 17,
      createdAt: "2026-09-07T00:00:00.000Z"
    });
    const malformed = {
      ...plan,
      meals: plan.meals.map((meal, index) =>
        index === 0 ? { ...meal, type: "brunch" } : meal
      )
    };

    expect(
      isAppState({
        ...state,
        currentPlan: malformed,
        history: [malformed]
      })
    ).toBe(false);
  });

  it("rejects a current menu that violates active hard preferences unless it is hidden as stale", () => {
    const base = createDefaultAppState();
    const currentPlan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 21,
      createdAt: "2026-09-07T00:00:00.000Z"
    });
    const presentFoodId = currentPlan.meals[0].items[0].foodId;
    const conflicting = {
      ...base,
      preferences: {
        ...base.preferences,
        excludedFoodIds: [presentFoodId]
      },
      currentPlan,
      history: [currentPlan]
    };

    expect(isAppState(conflicting)).toBe(false);
    expect(
      isAppState({
        ...conflicting,
        planNeedsRefresh: true,
        planRefreshReason: "preferences_changed"
      })
    ).toBe(true);
  });

  it("migrates valid schema v1 data without discarding plans or profiles", () => {
    const legacy = createDefaultAppState();
    const currentPlan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 9,
      createdAt: "2026-09-07T00:00:00.000Z"
    });
    const { planNeedsRefresh: _needsRefresh, planRefreshReason: _reason, ...v1 } = {
      ...legacy,
      currentPlan,
      history: [currentPlan]
    };

    const migrated = migrateAppState(v1, 1);
    expect(migrated?.currentPlan?.id).toBe(currentPlan.id);
    expect(migrated?.profiles).toHaveLength(2);
    expect(migrated?.planNeedsRefresh).toBe(false);
    expect(isAppState(migrated)).toBe(true);
  });

  it("migrates a v1 menu that conflicts with current preferences as hidden stale data", () => {
    const currentPlan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 29,
      createdAt: "2026-09-07T00:00:00.000Z"
    });
    const presentFoodId = currentPlan.meals[0].items[0].foodId;
    const base = createDefaultAppState();
    const { planNeedsRefresh: _needsRefresh, planRefreshReason: _reason, ...v1 } = {
      ...base,
      preferences: {
        ...base.preferences,
        excludedFoodIds: [presentFoodId]
      },
      currentPlan,
      history: [currentPlan]
    };

    const migrated = migrateAppState(v1, 1);
    expect(migrated?.currentPlan).toBe(currentPlan);
    expect(migrated?.planNeedsRefresh).toBe(true);
    expect(migrated?.planRefreshReason).toBe("preferences_changed");
    expect(isAppState(migrated)).toBe(true);
  });

  it("keeps an unsafe preference block hidden when profiles are edited", () => {
    const state = {
      ...createDefaultAppState(),
      currentPlan: generateDailyPlan({
        date: "2026-09-07",
        profiles: DEFAULT_PROFILES,
        preferences: DEFAULT_PREFERENCES,
        seed: 33,
        createdAt: "2026-09-07T00:00:00.000Z"
      }),
      planNeedsRefresh: true,
      planRefreshReason: "preferences_changed" as const
    };

    expect(refreshFlagsAfterProfileSave(state, true)).toEqual({
      planNeedsRefresh: true,
      planRefreshReason: "preferences_changed"
    });
  });
});

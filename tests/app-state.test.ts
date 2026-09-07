import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  FOOD_BY_ID
} from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import type { Preferences } from "../miniprogram/domain/models";
import {
  MAX_LOCAL_HISTORY,
  appendPlanToHistory,
  createDefaultAppState,
  isAppState,
  migrateAppState,
  refreshFlagsAfterProfileSave
} from "../miniprogram/repositories/app-state";
import { CURRENT_SCHEMA_VERSION } from "../miniprogram/repositories/storage";

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

  it("keeps a fully checked 60-plan envelope below the storage regression budget", () => {
    const profiles = DEFAULT_PROFILES.map((profile, index) => ({
      ...profile,
      name: index === 0 ? "成员称呼测试上限甲乙丙丁" : "成员称呼测试上限戊己庚辛",
      goalSettings: { ...profile.goalSettings }
    }));
    const broadPreferences: Preferences = {
      ...DEFAULT_PREFERENCES,
      preferredFoodIds: Object.keys(FOOD_BY_ID),
      preferredCookingMethods: [
        "air_fryer",
        "steam",
        "braise",
        "microwave",
        "boil",
        "ready_to_eat"
      ],
      preferredFlavors: [
        "spicy",
        "garlic",
        "black_pepper",
        "cumin",
        "tomato",
        "lemon",
        "light"
      ],
      lightDinner: true
    };
    let state = {
      ...createDefaultAppState(),
      profiles,
      preferences: broadPreferences
    };
    for (let seed = 0; seed < MAX_LOCAL_HISTORY; seed += 1) {
      const plan = generateDailyPlan({
        date: `2026-${String(Math.floor(seed / 28) + 1).padStart(2, "0")}-${String((seed % 28) + 1).padStart(2, "0")}`,
        profiles,
        preferences: broadPreferences,
        seed,
        createdAt: `2026-09-07T00:00:${String(seed).padStart(2, "0")}.000Z`
      });
      state = appendPlanToHistory(state, plan);
    }

    const fullyCheckedState = {
      ...state,
      checkedFoodIdsByPlanId: Object.fromEntries(
        state.history.map((plan) => [
          plan.id,
          [
            ...new Set(
              plan.meals.flatMap((meal) =>
                meal.items.map((item) => item.foodId)
              )
            )
          ]
        ])
      )
    };
    expect(isAppState(fullyCheckedState)).toBe(true);
    const serializedBytes = Buffer.byteLength(
      JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: "2026-09-07T00:00:00.000Z",
        data: fullyCheckedState
      }),
      "utf8"
    );

    // WeChat allows 1 MB per key; this tighter guard reserves roughly half for growth.
    expect(serializedBytes).toBeLessThan(512 * 1024);
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

  it("rejects current-schema history beyond the local retention limit", () => {
    const plan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 71,
      createdAt: "2026-09-07T00:00:00.000Z"
    });
    const history = Array.from(
      { length: MAX_LOCAL_HISTORY + 1 },
      (_, index) => (index === 0 ? plan : { ...plan, id: `${plan.id}-${index}` })
    );

    expect(
      isAppState({
        ...createDefaultAppState(),
        currentPlan: plan,
        history
      })
    ).toBe(false);
  });

  it("rejects shopping check state for a plan no longer retained in history", () => {
    const plan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 72,
      createdAt: "2026-09-07T00:00:00.000Z"
    });

    expect(
      isAppState({
        ...createDefaultAppState(),
        currentPlan: plan,
        history: [plan],
        checkedFoodIdsByPlanId: { "removed-plan": ["tomato"] }
      })
    ).toBe(false);
  });

  it("rejects a current plan that is missing from retained history", () => {
    const plan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 73,
      createdAt: "2026-09-07T00:00:00.000Z"
    });

    expect(
      isAppState({
        ...createDefaultAppState(),
        currentPlan: plan,
        history: []
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

  it("normalizes legacy history references without discarding its current plan", () => {
    const currentPlan = generateDailyPlan({
      date: "2026-09-07",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 74,
      createdAt: "2026-09-07T00:00:00.000Z"
    });
    const olderPlan = generateDailyPlan({
      date: "2026-09-06",
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 75,
      createdAt: "2026-09-06T00:00:00.000Z"
    });
    const base = createDefaultAppState();
    const { planNeedsRefresh: _needsRefresh, planRefreshReason: _reason, ...v1 } = {
      ...base,
      currentPlan,
      history: [olderPlan],
      checkedFoodIdsByPlanId: {
        [olderPlan.id]: [olderPlan.meals[0].items[0].foodId],
        "removed-plan": ["tomato"]
      }
    };

    const migrated = migrateAppState(v1, 1);

    expect(migrated?.history.map((plan) => plan.id)).toEqual([
      currentPlan.id,
      olderPlan.id
    ]);
    expect(migrated?.checkedFoodIdsByPlanId).toEqual({
      [olderPlan.id]: [olderPlan.meals[0].items[0].foodId]
    });
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

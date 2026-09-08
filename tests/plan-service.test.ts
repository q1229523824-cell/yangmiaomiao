import { describe, expect, it, vi } from "vitest";
import { RECIPES } from "../miniprogram/data/catalog";
import { seedFromText } from "../miniprogram/domain/menu-generator";
import * as planValidator from "../miniprogram/domain/plan-validator";
import { removePreference } from "../miniprogram/domain/preference-actions";
import { createDefaultAppState } from "../miniprogram/repositories/app-state";
import {
  ensureInitialPlan,
  preparePreferencePlanChange,
  regeneratePlan,
  savePreferencePlanChange
} from "../miniprogram/services/plan-service";

const FIRST_DATE = "2026-09-07";
const NEXT_DATE = "2026-09-08";

describe("plan lifecycle", () => {
  it("generates exactly once for a fresh installation", () => {
    const result = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    });

    expect(result.generated).toBe(true);
    expect(result.state.currentPlan?.date).toBe(FIRST_DATE);
    expect(result.state.generationCounter).toBe(1);
  });

  it("keeps the same immutable plan when reopened on the same day", () => {
    const first = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    }).state;
    const reopened = ensureInitialPlan(first, { date: FIRST_DATE });

    expect(reopened.generated).toBe(false);
    expect(reopened.state).toBe(first);
    expect(reopened.state.currentPlan?.id).toBe(first.currentPlan?.id);
    expect(reopened.state.generationCounter).toBe(1);
  });

  it("does not silently replace a saved plan after the date changes", () => {
    const first = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    }).state;
    const nextDay = ensureInitialPlan(first, { date: NEXT_DATE });

    expect(nextDay.generated).toBe(false);
    expect(nextDay.state.currentPlan?.date).toBe(FIRST_DATE);
    expect(nextDay.state.currentPlan?.id).toBe(first.currentPlan?.id);
  });

  it("keeps the old snapshot after profile edits until explicit regeneration", () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    }).state;
    const oldId = initial.currentPlan?.id;
    const edited = {
      ...initial,
      profiles: initial.profiles.map((profile, index) =>
        index === 0 ? { ...profile, heightCm: 175, weightKg: 70 } : profile
      ),
      planNeedsRefresh: true,
      planRefreshReason: "profile_changed" as const
    };

    const reopened = ensureInitialPlan(edited, { date: NEXT_DATE });
    expect(reopened.generated).toBe(false);
    expect(reopened.state.currentPlan?.id).toBe(oldId);
    expect(reopened.state.currentPlan?.profilesSnapshot[0].weightKg).toBe(60);

    const recalculated = regeneratePlan(reopened.state, {
      date: NEXT_DATE,
      createdAt: "2026-09-08T00:00:00.000Z"
    });
    expect(recalculated.currentPlan?.id).not.toBe(oldId);
    expect(recalculated.currentPlan?.profilesSnapshot[0]).toMatchObject({
      heightCm: 175,
      weightKg: 70
    });
    expect(recalculated.planNeedsRefresh).toBe(false);
    expect(recalculated.planRefreshReason).toBeNull();
  });

  it("changes the plan only on explicit regeneration", () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    }).state;
    const changed = regeneratePlan(initial, {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:01:00.000Z"
    });

    expect(changed.generationCounter).toBe(2);
    expect(changed.currentPlan?.id).not.toBe(initial.currentPlan?.id);
    expect(changed.history).toHaveLength(2);
  });

  it("recovers an unusable random combination without sticking or consuming the next plan ID", () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE
    }).state;
    const regressionState = {
      ...initial,
      generationCounter: 13,
      profiles: [{
        ...initial.profiles[1],
        heightCm: 180,
        weightKg: 60,
        ageYears: 25,
        goalSettings: {
          ...initial.profiles[1].goalSettings,
          activityFactor: 1.725,
          calorieTargetRatio: 1
        }
      }]
    };
    const recovered = regeneratePlan(regressionState, { date: NEXT_DATE });
    const next = regeneratePlan(recovered, { date: NEXT_DATE });

    expect(recovered.generationCounter).toBe(14);
    expect(recovered.currentPlan?.seed).toBe(465688859);
    expect(next.generationCounter).toBe(15);
    expect(next.currentPlan?.seed).toBe(seedFromText(`${NEXT_DATE}:15`));
    expect(next.currentPlan?.id).not.toBe(recovered.currentPlan?.id);
    expect(next.history).toHaveLength(3);
    expect(regressionState.generationCounter).toBe(13);
    expect(regressionState.currentPlan).toBe(initial.currentPlan);
  });

  it("keeps the previous plan, history and counter when every candidate exceeds portion limits", () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE
    }).state;
    const impossible = {
      ...initial,
      profiles: [{
        ...initial.profiles[0],
        heightCm: 160,
        weightKg: 180,
        ageYears: 60,
        goalSettings: {
          ...initial.profiles[0].goalSettings,
          activityFactor: 1.2,
          calorieTargetRatio: 0.75
        }
      }]
    };
    const before = structuredClone(impossible);
    expect(() => regeneratePlan(impossible, { date: NEXT_DATE }))
      .toThrowError("原有菜单不会被替换");
    expect(impossible).toEqual(before);
  });

  it("does not turn a programming error into a saved preference conflict", async () => {
    const initial = ensureInitialPlan(createDefaultAppState(), { date: FIRST_DATE }).state;
    const validation = vi.spyOn(planValidator, "validateDailyPlan")
      .mockReturnValue({ valid: false, errors: ["菜单结构损坏"] });
    const save = vi.fn();
    try {
      await expect(savePreferencePlanChange(initial, initial.preferences, {
        date: FIRST_DATE
      }, save)).rejects.toMatchObject({ code: "INVALID_PLAN" });
      expect(save).not.toHaveBeenCalled();
      expect(validation).toHaveBeenCalledTimes(1);
    } finally {
      validation.mockRestore();
    }
  });

  it("keeps an impossible preference edit so conflicts can be removed progressively", () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    }).state;
    const allRecipeProteins = [
      ...new Set(RECIPES.map((recipe) => recipe.mainProteinFoodId))
    ];
    const impossible = {
      ...initial.preferences,
      excludedFoodIds: [...allRecipeProteins, "tomato"]
    };

    const blocked = preparePreferencePlanChange(initial, impossible, {
      date: FIRST_DATE
    });
    expect(blocked.generated).toBe(false);
    expect(blocked.generationError?.code).toBe("NO_RECIPE_MATCH");
    expect(blocked.state.currentPlan).toBe(initial.currentPlan);
    expect(blocked.state.preferences).toBe(impossible);
    expect(blocked.state.planRefreshReason).toBe("preferences_changed");

    const stillImpossible = removePreference(
      blocked.state.preferences,
      "exclude_food",
      "tomato"
    );
    const progressivelyUnblocked = preparePreferencePlanChange(
      blocked.state,
      stillImpossible,
      { date: FIRST_DATE }
    );
    expect(progressivelyUnblocked.generated).toBe(false);
    expect(progressivelyUnblocked.state.preferences.excludedFoodIds).not.toContain(
      "tomato"
    );
    expect(progressivelyUnblocked.state.planRefreshReason).toBe(
      "preferences_changed"
    );

    const possible = removePreference(
      progressivelyUnblocked.state.preferences,
      "exclude_food",
      "chicken_breast"
    );
    const recovered = preparePreferencePlanChange(
      progressivelyUnblocked.state,
      possible,
      { date: FIRST_DATE }
    );
    expect(recovered.generated).toBe(true);
    expect(recovered.generationError).toBeNull();
    expect(recovered.state.planNeedsRefresh).toBe(false);
    expect(recovered.state.planRefreshReason).toBeNull();
  });

  it("attempts one save only and leaves the caller state unchanged when saving fails", async () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {
      date: FIRST_DATE,
      createdAt: "2026-09-07T00:00:00.000Z"
    }).state;
    const impossible = {
      ...initial.preferences,
      excludedFoodIds: [
        ...new Set(RECIPES.map((recipe) => recipe.mainProteinFoodId))
      ]
    };
    const saveFailure = new Error("storage unavailable");
    const save = vi.fn().mockRejectedValue(saveFailure);

    await expect(
      savePreferencePlanChange(initial, impossible, { date: FIRST_DATE }, save)
    ).rejects.toBe(saveFailure);
    expect(save).toHaveBeenCalledTimes(1);
    expect(initial.preferences.excludedFoodIds).toEqual([]);
    expect(initial.planNeedsRefresh).toBe(false);
  });
});

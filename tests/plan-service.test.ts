import { describe, expect, it, vi } from "vitest";
import { RECIPES } from "../miniprogram/data/catalog";
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

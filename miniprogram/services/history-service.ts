import type { Preferences, Profile } from "../domain/models";
import { validatePlanAgainstPreferences } from "../domain/plan-validator";
import type { AppState } from "../repositories/app-state";
import { diningChoice, usableTakeout } from "../domain/meal-planning";

export class HistoryPlanNotFoundError extends Error {
  constructor(planId: string) {
    super(`找不到历史菜单：${planId}`);
    this.name = "HistoryPlanNotFoundError";
  }
}

export class HistoryPlanSafetyError extends Error {
  constructor() {
    super("这份历史菜单含当前记录的过敏原，不能恢复");
    this.name = "HistoryPlanSafetyError";
  }
}

function clonePreferences(preferences: Preferences): Preferences {
  return {
    ...preferences,
    excludedFoodIds: [...preferences.excludedFoodIds],
    preferredFoodIds: [...preferences.preferredFoodIds],
    excludedFoodGroups: [...preferences.excludedFoodGroups],
    preferredCookingMethods: [...preferences.preferredCookingMethods],
    preferredFlavors: [...preferences.preferredFlavors],
    allergens: [...preferences.allergens],
  };
}

function profilesMatchSnapshot(
  profiles: readonly Profile[],
  snapshot: readonly Profile[]
): boolean {
  if (profiles.length !== snapshot.length) return false;
  const snapshotById = new Map(snapshot.map((profile) => [profile.id, profile]));
  return profiles.every((profile) => {
    const saved = snapshotById.get(profile.id);
    return Boolean(
      saved &&
        profile.name === saved.name &&
        profile.gender === saved.gender &&
        profile.heightCm === saved.heightCm &&
        profile.weightKg === saved.weightKg &&
        profile.ageYears === saved.ageYears &&
        profile.goalSettings.activityFactor === saved.goalSettings.activityFactor &&
        profile.goalSettings.calorieTargetRatio ===
          saved.goalSettings.calorieTargetRatio &&
        profile.goalSettings.proteinGPerKg === saved.goalSettings.proteinGPerKg &&
        profile.goalSettings.fatGPerKg === saved.goalSettings.fatGPerKg
    );
  });
}

/**
 * Restore a saved immutable snapshot without generating a new plan.
 * Profiles remain the user's latest editable profiles; the restored plan keeps
 * its own profilesSnapshot for historically accurate portions and nutrition.
 */
export function restorePlanFromHistory(
  state: AppState,
  planId: string,
): AppState {
  const selected = state.history.find((plan) => plan.id === planId);
  if (!selected) throw new HistoryPlanNotFoundError(planId);
  const usesCurrentProfiles = profilesMatchSnapshot(
    state.profiles,
    selected.profilesSnapshot
  );
  const restoredPreferences = clonePreferences(selected.preferencesSnapshot);
  restoredPreferences.allergens = [
    ...new Set([
      ...restoredPreferences.allergens,
      ...state.preferences.allergens,
    ]),
  ];
  const violatesCurrentSafety = !validatePlanAgainstPreferences(
    selected,
    restoredPreferences,
  ).valid;
  const blockedTakeout = selected.meals.some(meal => selected.memberIds.some(id => {
    const choice = diningChoice(meal, id);
    return choice.source === "takeout" && choice.takeout && !usableTakeout(meal, selected, id, restoredPreferences);
  }));
  if (violatesCurrentSafety || blockedTakeout) throw new HistoryPlanSafetyError();

  return {
    ...state,
    currentPlan: selected,
    // A restore is an explicit choice for that date, not just a temporary view.
    // Keep every revision but promote this one for subsequent date navigation.
    history: [selected, ...state.history.filter(plan => plan.id !== selected.id)],
    preferences: restoredPreferences,
    planNeedsRefresh: !usesCurrentProfiles,
    planRefreshReason: usesCurrentProfiles ? null : "profile_changed",
  };
}

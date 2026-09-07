import { DEFAULT_PROFILES } from "../data/catalog";
import { createEmptyPreferences } from "../domain/preference-parser";
import type { DailyPlan, Preferences, Profile } from "../domain/models";
import {
  validateDailyPlan,
  validatePlanAgainstPreferences
} from "../domain/plan-validator";
import {
  CURRENT_SCHEMA_VERSION,
  VersionedRepository,
  createWxStorageAdapter
} from "./storage";

export const MAX_LOCAL_HISTORY = 60;

export type PlanRefreshReason = "profile_changed" | "preferences_changed" | null;

export interface AppState {
  profiles: Profile[];
  preferences: Preferences;
  currentPlan: DailyPlan | null;
  history: DailyPlan[];
  generationCounter: number;
  checkedFoodIdsByPlanId: Record<string, string[]>;
  /** Existing plans are immutable; this flag asks the user to recalculate explicitly. */
  planNeedsRefresh: boolean;
  planRefreshReason: PlanRefreshReason;
}

export function createDefaultAppState(): AppState {
  return {
    profiles: DEFAULT_PROFILES.map((profile) => ({
      ...profile,
      goalSettings: { ...profile.goalSettings }
    })),
    preferences: createEmptyPreferences(),
    currentPlan: null,
    history: [],
    generationCounter: 0,
    checkedFoodIdsByPlanId: {},
    planNeedsRefresh: false,
    planRefreshReason: null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAllowedStringArray(
  value: unknown,
  allowed: ReadonlySet<string>
): value is string[] {
  return isStringArray(value) && value.every((item) => allowed.has(item));
}

const KNOWN_FOOD_GROUPS = new Set([
  "poultry", "pork", "beef", "fish", "shellfish", "egg", "dairy",
  "soy", "supplement", "grain", "tuber", "vegetable"
]);
const KNOWN_COOKING_METHODS = new Set([
  "air_fryer", "steam", "braise", "microwave", "boil", "ready_to_eat"
]);
const KNOWN_FLAVORS = new Set([
  "spicy", "garlic", "black_pepper", "cumin", "tomato", "lemon", "light"
]);
const KNOWN_ALLERGENS = new Set([
  "egg", "milk", "soy", "fish", "shellfish", "gluten"
]);

function isProfile(value: unknown): value is Profile {
  if (!isRecord(value) || !isRecord(value.goalSettings)) return false;
  const settings = value.goalSettings;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.gender === "female" || value.gender === "male") &&
    isFiniteNumber(value.heightCm) &&
    isFiniteNumber(value.weightKg) &&
    isFiniteNumber(value.ageYears) &&
    isFiniteNumber(value.portionMultiplier) &&
    isFiniteNumber(settings.activityFactor) &&
    isFiniteNumber(settings.calorieTargetRatio) &&
    isFiniteNumber(settings.proteinGPerKg) &&
    isFiniteNumber(settings.fatGPerKg)
  );
}

function isPreferences(value: unknown): value is Preferences {
  if (!isRecord(value)) return false;
  return (
    isStringArray(value.excludedFoodIds) &&
    isStringArray(value.preferredFoodIds) &&
    isAllowedStringArray(value.excludedFoodGroups, KNOWN_FOOD_GROUPS) &&
    typeof value.avoidWhey === "boolean" &&
    isAllowedStringArray(value.preferredCookingMethods, KNOWN_COOKING_METHODS) &&
    isAllowedStringArray(value.preferredFlavors, KNOWN_FLAVORS) &&
    typeof value.lightDinner === "boolean" &&
    isAllowedStringArray(value.allergens, KNOWN_ALLERGENS)
  );
}

function isNutritionMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (item) =>
      isRecord(item) &&
      isFiniteNumber(item.caloriesKcal) &&
      isFiniteNumber(item.proteinG) &&
      isFiniteNumber(item.carbsG) &&
      isFiniteNumber(item.fatG)
  );
}

export function isDailyPlan(value: unknown): value is DailyPlan {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.date !== "string" ||
    !isFiniteNumber(value.seed) ||
    !isFiniteNumber(value.catalogVersion) ||
    !isStringArray(value.memberIds) ||
    !Array.isArray(value.profilesSnapshot) ||
    !value.profilesSnapshot.every(isProfile) ||
    !Array.isArray(value.meals) ||
    !isNutritionMap(value.goalsByMemberId) ||
    !isNutritionMap(value.nutritionByMemberId) ||
    !isPreferences(value.preferencesSnapshot) ||
    typeof value.createdAt !== "string"
  ) {
    return false;
  }

  for (const meal of value.meals) {
    if (
      !isRecord(meal) ||
      typeof meal.id !== "string" ||
      !["breakfast", "lunch", "dinner", "snack"].includes(
        meal.type as string
      ) ||
      typeof meal.name !== "string" ||
      !isStringArray(meal.cookingMethods) ||
      !Array.isArray(meal.items)
    ) {
      return false;
    }
    for (const item of meal.items) {
      if (
        !isRecord(item) ||
        typeof item.id !== "string" ||
        typeof item.foodId !== "string" ||
        typeof item.role !== "string" ||
        !isRecord(item.portionsByMemberId) ||
        !Object.values(item.portionsByMemberId).every(isFiniteNumber)
      ) {
        return false;
      }
    }
  }

  return validateDailyPlan(value as unknown as DailyPlan).valid;
}

function isCheckedMap(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(isStringArray);
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

export function isAppState(value: unknown): value is AppState {
  if (!isRecord(value)) return false;
  const structurallyValid =
    Array.isArray(value.profiles) &&
    value.profiles.length > 0 &&
    value.profiles.every(isProfile) &&
    isPreferences(value.preferences) &&
    (value.currentPlan === null || isDailyPlan(value.currentPlan)) &&
    Array.isArray(value.history) &&
    value.history.length <= MAX_LOCAL_HISTORY &&
    value.history.every(isDailyPlan) &&
    Number.isInteger(value.generationCounter) &&
    (value.generationCounter as number) >= 0 &&
    isCheckedMap(value.checkedFoodIdsByPlanId) &&
    typeof value.planNeedsRefresh === "boolean" &&
    (value.planRefreshReason === null ||
      value.planRefreshReason === "profile_changed" ||
      value.planRefreshReason === "preferences_changed");
  if (!structurallyValid) return false;

  const currentPlan = value.currentPlan as DailyPlan | null;
  const history = value.history as DailyPlan[];
  const historyPlanIds = new Set(history.map((plan) => plan.id));
  if (currentPlan && !historyPlanIds.has(currentPlan.id)) return false;
  if (
    Object.keys(value.checkedFoodIdsByPlanId as Record<string, string[]>).some(
      (planId) => !historyPlanIds.has(planId)
    )
  ) {
    return false;
  }
  if (
    currentPlan &&
    !validatePlanAgainstPreferences(
      currentPlan,
      value.preferences as Preferences
    ).valid &&
    !(
      value.planNeedsRefresh === true &&
      value.planRefreshReason === "preferences_changed"
    )
  ) {
    return false;
  }
  return true;
}

/** Preserve valid v1 user data while adding explicit plan-refresh state. */
export function migrateAppState(
  value: unknown,
  fromSchemaVersion: number
): AppState | undefined {
  if (fromSchemaVersion !== 1 || !isRecord(value)) return undefined;
  const profiles = Array.isArray(value.profiles)
      ? value.profiles.filter(isProfile)
      : [];
  const preferences = isPreferences(value.preferences)
      ? value.preferences
      : createEmptyPreferences();
  const currentPlan = isDailyPlan(value.currentPlan) ? value.currentPlan : null;
  const preferencesConflict = Boolean(
    currentPlan &&
      !validatePlanAgainstPreferences(currentPlan, preferences).valid
  );
  const profileConflict = Boolean(
    currentPlan && !profilesMatchSnapshot(profiles, currentPlan.profilesSnapshot)
  );
  let history = Array.isArray(value.history)
    ? value.history.filter(isDailyPlan).slice(0, MAX_LOCAL_HISTORY)
    : [];
  if (currentPlan && !history.some((plan) => plan.id === currentPlan.id)) {
    history = [currentPlan, ...history].slice(0, MAX_LOCAL_HISTORY);
  }
  const retainedPlanIds = new Set(history.map((plan) => plan.id));
  const checkedFoodIdsByPlanId = isCheckedMap(value.checkedFoodIdsByPlanId)
    ? Object.fromEntries(
        Object.entries(value.checkedFoodIdsByPlanId).filter(([planId]) =>
          retainedPlanIds.has(planId)
        )
      )
    : {};
  const candidate: AppState = {
    profiles,
    preferences,
    currentPlan,
    history,
    generationCounter:
      Number.isInteger(value.generationCounter) &&
      (value.generationCounter as number) >= 0
        ? (value.generationCounter as number)
        : 0,
    checkedFoodIdsByPlanId,
    planNeedsRefresh: preferencesConflict || profileConflict,
    planRefreshReason: preferencesConflict
      ? "preferences_changed"
      : profileConflict
        ? "profile_changed"
        : null
  };
  return isAppState(candidate) ? candidate : undefined;
}

export function appendPlanToHistory(state: AppState, plan: DailyPlan): AppState {
  const history = [
    plan,
    ...state.history.filter((item) => item.id !== plan.id)
  ].slice(0, MAX_LOCAL_HISTORY);
  const retainedPlanIds = new Set(history.map((item) => item.id));
  const checkedFoodIdsByPlanId = Object.fromEntries(
    Object.entries(state.checkedFoodIdsByPlanId).filter(([planId]) =>
      retainedPlanIds.has(planId)
    )
  );
  return {
    ...state,
    currentPlan: plan,
    history,
    checkedFoodIdsByPlanId,
    planNeedsRefresh: false,
    planRefreshReason: null
  };
}

/** A profile edit must never downgrade a preference-safety block to a visible plan. */
export function refreshFlagsAfterProfileSave(
  state: AppState,
  profilesChanged: boolean
): Pick<AppState, "planNeedsRefresh" | "planRefreshReason"> {
  if (!profilesChanged || !state.currentPlan) {
    return {
      planNeedsRefresh: state.planNeedsRefresh,
      planRefreshReason: state.planRefreshReason
    };
  }
  if (state.planRefreshReason === "preferences_changed") {
    return {
      planNeedsRefresh: true,
      planRefreshReason: "preferences_changed"
    };
  }
  return { planNeedsRefresh: true, planRefreshReason: "profile_changed" };
}

let repository: VersionedRepository<AppState> | undefined;

export function getAppStateRepository(): VersionedRepository<AppState> {
  repository ??= new VersionedRepository(
    createWxStorageAdapter(),
    "app-state",
    createDefaultAppState,
    CURRENT_SCHEMA_VERSION,
    isAppState,
    migrateAppState
  );
  return repository;
}

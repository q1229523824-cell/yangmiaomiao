import { FOOD_BY_ID } from "../data/catalog";
import type { DailyPlan, Meal, MealDiningChoice, Nutrition, PlannedTakeout, Preferences } from "./models";
import { addNutrition, nutritionForGrams, roundNutrition, ZERO_NUTRITION } from "./nutrition";
import { getTakeoutRecommendations, type TakeoutMealType } from "./takeout";

export function diningChoice(meal: Meal, memberId: string): MealDiningChoice {
  return meal.diningByMemberId?.[memberId] ?? { source: "home" };
}

export function isPlannableMeal(value: unknown): value is TakeoutMealType {
  return value === "breakfast" || value === "lunch" || value === "dinner";
}

/** Recheck current exclusions, meal type and catalog availability on every read. */
export function usableTakeout(meal: Meal, plan: DailyPlan, memberId: string, preferences: Preferences): PlannedTakeout | undefined {
  const choice = diningChoice(meal, memberId);
  const profile = plan.profilesSnapshot.find(item => item.id === memberId);
  if (choice.source !== "takeout" || !choice.takeout || !profile || !isPlannableMeal(meal.type)) return undefined;
  const result = getTakeoutRecommendations({profile, preferences, mealType: meal.type});
  const safe = [...result.matches, ...result.alternatives].some(item => item.template.id === choice.takeout?.templateId);
  return safe ? choice.takeout : undefined;
}

/** Totals follow each person's chosen source; unfinished meals stay explicit. */
export function plannedNutrition(plan: DailyPlan, memberId: string, preferences = plan.preferencesSnapshot) {
  let min = {...ZERO_NUTRITION};
  let max = {...ZERO_NUTRITION};
  let pendingMeals = 0;
  let hasTakeout = false;
  for (const meal of plan.meals) {
    if (diningChoice(meal, memberId).source === "takeout") {
      hasTakeout = true;
      const selected = usableTakeout(meal, plan, memberId, preferences);
      if (!selected) { pendingMeals++; continue; }
      min = addNutrition(min, selected.nutrition.min);
      max = addNutrition(max, selected.nutrition.max);
    } else {
      const nutrition = addNutrition(...meal.items.map(item => nutritionForGrams(FOOD_BY_ID[item.foodId], item.portionsByMemberId[memberId] ?? 0)));
      min = addNutrition(min, nutrition);
      max = addNutrition(max, nutrition);
    }
  }
  return {min: roundNutrition(min), max: roundNutrition(max), pendingMeals, hasTakeout};
}

export function nutritionRangeText(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

/** Persisted data is untrusted, including JSON clipboard imports. */
export function isDiningChoices(value: unknown, memberIds: readonly string[], mealType: string): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value) || !isPlannableMeal(mealType)) return false;
  return Object.entries(value).every(([id, raw]) => {
    if (!memberIds.includes(id) || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const choice = raw as MealDiningChoice;
    if (choice.source !== "home" && choice.source !== "takeout") return false;
    if (choice.takeout === undefined) return true;
    const saved = choice.takeout;
    if (!saved || typeof saved !== "object") return false;
    if (![saved.templateId, saved.name, saved.orderText, saved.searchKeyword, saved.portionDescription]
      .every(text => typeof text === "string" && text.trim().length > 0 && text.length <= 500)) return false;
    if (!saved.nutrition?.min || !saved.nutrition?.max) return false;
    return (["caloriesKcal", "proteinG", "carbsG", "fatG"] as Array<keyof Nutrition>).every(key => {
      const min = saved.nutrition.min[key], max = saved.nutrition.max[key];
      return typeof min === "number" && typeof max === "number" && Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min && max <= 10000;
    });
  });
}

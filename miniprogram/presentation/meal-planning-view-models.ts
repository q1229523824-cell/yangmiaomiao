import type { AppState } from "../repositories/app-state";
import { diningChoice, isPlannableMeal, usableTakeout, nutritionRangeText, plannedNutrition } from "../domain/meal-planning";
import { getTakeoutRecommendations } from "../domain/takeout";
import { toMealViewModels } from "./view-models";

export function toPlannedMeals(state: AppState, memberId: string, expandedMeals: readonly string[] = []) {
  const plan = state.currentPlan;
  if (!plan) return [];
  const profile = state.profiles.find(item => item.id === memberId) ?? state.profiles[0];
  return toMealViewModels(plan, state.preferences.allergens).map(view => {
    const meal = plan.meals.find(item => item.id === view.id)!;
    const choice = diningChoice(meal, memberId);
    const result = isPlannableMeal(meal.type)
      ? getTakeoutRecommendations({profile, preferences: state.preferences, mealType: meal.type}) : undefined;
    const saved = usableTakeout(meal, plan, memberId, state.preferences);
    const sorted = [...(result?.matches ?? [])].sort((a, b) =>
      Number(state.takeout.favoriteTemplateIds.includes(b.template.id)) - Number(state.takeout.favoriteTemplateIds.includes(a.template.id)));
    const expanded = expandedMeals.includes(meal.type);
    const pending = choice.source === "takeout" && !saved;
    const selectedMeetsTargets = result?.matches.some(item => item.template.id === saved?.templateId);
    return {...view, source: choice.source, canChooseSource: isPlannableMeal(meal.type),
      planningFor: profile.name, selectedTakeout: saved ?? null,
      selectedCalories: saved ? nutritionRangeText(saved.nutrition.min.caloriesKcal, saved.nutrition.max.caloriesKcal) : "",
      selectedProtein: saved ? nutritionRangeText(saved.nutrition.min.proteinG, saved.nutrition.max.proteinG) : "",
      selectedWarning: saved && !selectedMeetsTargets ? "当前档案的目标已变化，这份已选外卖未达新目标，可重新选择。" : "",
      pending, blockedReason: result?.blockedReason ?? "",
      targetText: result ? `本餐参考：热量上限 ${result.targets.maxCaloriesKcal} 千卡 · 蛋白质下限 ${result.targets.minProteinG} 克` : "",
      choices: (expanded ? sorted : sorted.slice(0, 3)).map(item => ({
        id: item.template.id, name: item.template.name, orderText: item.template.orderText,
        portion: item.template.portionDescription,
        calories: nutritionRangeText(item.nutrition.min.caloriesKcal, item.nutrition.max.caloriesKcal),
        protein: nutritionRangeText(item.nutrition.min.proteinG, item.nutrition.max.proteinG),
        carbs: nutritionRangeText(item.nutrition.min.carbsG, item.nutrition.max.carbsG),
        fat: nutritionRangeText(item.nutrition.min.fatG, item.nutrition.max.fatG),
        isFavorite: state.takeout.favoriteTemplateIds.includes(item.template.id),
        isSelected: saved?.templateId === item.template.id
      })),
      hasMore: sorted.length > 3, expanded,
      householdSummary: plan.profilesSnapshot.map(person => {
        const option = diningChoice(meal, person.id);
        const selected = usableTakeout(meal, plan, person.id, state.preferences);
        return `${person.name}：${option.source === "home" ? "自己做" : selected?.name ?? "外卖待选"}`;
      }).join("；"),
    };
  });
}

export function planningSummary(state: AppState): string {
  const plan = state.currentPlan;
  if (!plan) return "";
  const pending = plan.memberIds.reduce((count, id) => count + plannedNutrition(plan, id, state.preferences).pendingMeals, 0);
  return pending ? `已保存 · 还有 ${pending} 人餐外卖待选择；概览仅合计已选部分。` : "当天安排已保存 · 可随时修改，重新打开会保留。";
}

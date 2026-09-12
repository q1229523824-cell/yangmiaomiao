import type { AppState } from "../repositories/app-state";
import { appendPlanToHistory, profilesMatchSnapshot } from "../repositories/app-state";
import type { MealDiningChoice } from "../domain/models";
import { diningChoice, isPlannableMeal } from "../domain/meal-planning";
import { validatePlanAgainstPreferences } from "../domain/plan-validator";
import { getTakeoutRecommendations } from "../domain/takeout";
import { regeneratePlan } from "./plan-service";
import { isCalendarDate } from "./takeout-state";

export function selectPlanDate(state: AppState, date: string): AppState {
  if (!isCalendarDate(date)) throw new Error("请选择有效的计划日期。");
  if (state.currentPlan?.date === date) return state;
  const saved = state.history.find(plan => plan.date === date);
  if (!saved) return regeneratePlan(state, {date});
  const blocked = !validatePlanAgainstPreferences(saved, state.preferences).valid;
  const changed = !profilesMatchSnapshot(state.profiles, saved.profilesSnapshot);
  return {...state, currentPlan: saved, planNeedsRefresh: blocked || changed,
    planRefreshReason: blocked ? "preferences_changed" : changed ? "profile_changed" : null};
}

/** Called in a repository transaction with the visible plan ID for stale-click protection. */
export function setMealDining(state: AppState, planId: string, mealType: string, memberId: string,
  source: "home" | "takeout", templateId?: string): AppState {
  const plan = state.currentPlan;
  if (!plan || plan.id !== planId) throw new Error("计划已变化，请在当前日期重新选择。");
  if (!isPlannableMeal(mealType) || !plan.memberIds.includes(memberId) || (source !== "home" && source !== "takeout")) {
    throw new Error("请选择有效的成员、餐次和用餐方式。");
  }
  if (state.planRefreshReason === "preferences_changed") throw new Error("请先调整禁忌并重新生成自炊菜单。");
  const meal = plan.meals.find(item => item.type === mealType)!;
  const previous = diningChoice(meal, memberId);
  let choice: MealDiningChoice = {...previous, source};
  if (templateId !== undefined) {
    const profile = state.profiles.find(item => item.id === memberId);
    if (!profile || source !== "takeout") throw new Error("请重新选择成员和外卖。");
    const selected = getTakeoutRecommendations({profile, preferences: state.preferences, mealType}).matches
      .find(item => item.template.id === templateId);
    if (!selected) throw new Error("这份外卖已不满足当前禁忌或目标，请重新选择。");
    const {template, nutrition} = selected;
    choice = {source, takeout: {templateId, name: template.name, orderText: template.orderText,
      searchKeyword: template.searchKeyword, portionDescription: template.portionDescription,
      nutrition: {min: {...nutrition.min}, max: {...nutrition.max}}}};
  }
  if (JSON.stringify(choice) === JSON.stringify(previous)) return state;
  const generationCounter = state.generationCounter + 1;
  const edited = {...plan, id: `${plan.date}:edit:${generationCounter}`, createdAt: new Date().toISOString(),
    meals: plan.meals.map(item => item.type === mealType
      ? {...item, diningByMemberId: {...item.diningByMemberId, [memberId]: choice}} : item)};
  // Ingredient amounts may have increased when returning home: start a fresh shopping checklist.
  const next = appendPlanToHistory({...state, generationCounter}, edited);
  return {...next, planNeedsRefresh: state.planNeedsRefresh, planRefreshReason: state.planRefreshReason};
}

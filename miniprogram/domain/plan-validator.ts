import { FOOD_BY_ID } from "../data/catalog";
import type { DailyPlan, Preferences } from "./models";

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

/** Check only hard food-safety constraints against an already built plan. */
export function validatePlanAgainstPreferences(
  plan: DailyPlan,
  preferences: Preferences,
): PlanValidationResult {
  const errors: string[] = [];
  for (const meal of plan.meals) {
    for (const item of meal.items) {
      const food = FOOD_BY_ID[item.foodId];
      if (!food) continue;
      if (preferences.excludedFoodIds.includes(item.foodId)) {
        errors.push(`${meal.name} 包含已排除食材：${food.name}`);
      }
      const excludedGroup = food.groups.find((group) =>
        preferences.excludedFoodGroups.includes(group),
      );
      if (excludedGroup) {
        errors.push(`${meal.name} 包含已排除食材组：${food.name}`);
      }
      const allergen = food.allergens?.find((value) =>
        preferences.allergens.includes(value),
      );
      if (allergen) {
        errors.push(`${meal.name} 包含过敏原食材：${food.name}`);
      }
      if (preferences.avoidWhey && item.foodId === "whey_protein") {
        errors.push(`${meal.name} 包含已禁用的乳清蛋白粉`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateDailyPlan(plan: DailyPlan): PlanValidationResult {
  const errors: string[] = [];
  const memberIds = new Set(plan.memberIds);
  const supportedMealTypes = new Set(["breakfast", "lunch", "dinner", "snack"]);

  if (plan.memberIds.length === 0) errors.push("菜单没有家庭成员");
  if (new Set(plan.memberIds).size !== plan.memberIds.length) {
    errors.push("家庭成员 ID 重复");
  }
  if (new Set(plan.meals.map((meal) => meal.type)).size !== plan.meals.length) {
    errors.push("同一餐次出现了多个菜单对象");
  }
  for (const requiredType of ["breakfast", "lunch", "dinner"] as const) {
    if (!plan.meals.some((meal) => meal.type === requiredType)) {
      errors.push(`菜单缺少${requiredType}`);
    }
  }
  if (plan.meals.some((meal) => !supportedMealTypes.has(meal.type))) {
    errors.push("菜单包含未知餐次");
  }
  const snapshotIds = plan.profilesSnapshot.map((profile) => profile.id);
  if (
    snapshotIds.length !== plan.memberIds.length ||
    new Set(snapshotIds).size !== snapshotIds.length ||
    snapshotIds.some((memberId) => !memberIds.has(memberId))
  ) {
    errors.push("成员档案快照与菜单成员不一致");
  }

  for (const meal of plan.meals) {
    if (meal.items.length === 0) errors.push(`${meal.name} 没有食材`);
    for (const item of meal.items) {
      if (!FOOD_BY_ID[item.foodId]) errors.push(`未知食材：${item.foodId}`);
      for (const memberId of memberIds) {
        const grams = item.portionsByMemberId[memberId];
        if (typeof grams !== "number" || !Number.isFinite(grams) || grams < 0) {
          errors.push(`${meal.name}/${item.foodId} 缺少 ${memberId} 的有效克数`);
        }
      }
      const extraIds = Object.keys(item.portionsByMemberId).filter(
        (memberId) => !memberIds.has(memberId)
      );
      if (extraIds.length > 0) {
        errors.push(`${meal.name}/${item.foodId} 含未知成员克数`);
      }
    }
  }

  for (const memberId of plan.memberIds) {
    if (!plan.goalsByMemberId[memberId]) errors.push(`缺少 ${memberId} 的营养目标`);
    if (!plan.nutritionByMemberId[memberId]) errors.push(`缺少 ${memberId} 的营养汇总`);
  }

  const hardPreferenceValidation = validatePlanAgainstPreferences(
    plan,
    plan.preferencesSnapshot,
  );
  errors.push(...hardPreferenceValidation.errors);

  return { valid: errors.length === 0, errors };
}

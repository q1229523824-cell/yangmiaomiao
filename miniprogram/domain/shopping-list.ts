import type {
  DailyPlan,
  MemberId,
  PortionsByMemberId,
  ShoppingItem
} from "./models";
import { diningChoice } from "./meal-planning";

export function buildShoppingList(plan: DailyPlan): ShoppingItem[] {
  const byFoodId = new Map<
    string,
    { totalGrams: number; portionsByMemberId: PortionsByMemberId }
  >();

  for (const meal of plan.meals) {
    for (const item of meal.items) {
      const current = byFoodId.get(item.foodId) ?? {
        totalGrams: 0,
        portionsByMemberId: Object.fromEntries(
          plan.memberIds.map((memberId) => [memberId, 0])
        ) as Record<MemberId, number>
      };
      for (const memberId of plan.memberIds) {
        if (diningChoice(meal, memberId).source === "takeout") continue;
        const grams = item.portionsByMemberId[memberId] ?? 0;
        current.portionsByMemberId[memberId] += grams;
        current.totalGrams += grams;
      }
      byFoodId.set(item.foodId, current);
    }
  }

  return [...byFoodId.entries()]
    .map(([foodId, value]) => ({
      foodId,
      totalGrams: value.totalGrams,
      portionsByMemberId: value.portionsByMemberId,
      checked: false
    }))
    .filter((item) => item.totalGrams > 0)
    .sort((left, right) => right.totalGrams - left.totalGrams);
}

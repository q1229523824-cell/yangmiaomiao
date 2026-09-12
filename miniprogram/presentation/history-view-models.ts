import type { DailyPlan, MealType } from "../domain/models";
import { MAX_LOCAL_HISTORY } from "../repositories/app-state";
import { diningChoice, nutritionRangeText, plannedNutrition, usableTakeout } from "../domain/meal-planning";

const CORE_MEAL_TYPES: ReadonlyArray<MealType> = [
  "breakfast",
  "lunch",
  "dinner",
];

const CORE_MEAL_LABELS: Record<MealType, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐",
};

export interface HistoryPlanViewModel {
  id: string;
  date: string;
  dateLabel: string;
  createdAtLabel: string;
  isCurrent: boolean;
  meals: Array<{
    type: MealType;
    label: string;
    name: string;
  }>;
  calories: Array<{
    memberId: string;
    memberName: string;
    emoji: string;
    value: string;
  }>;
}

function formatPlanDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "生成时间未知";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toHistoryPlanViewModels(
  history: readonly DailyPlan[],
  currentPlanId?: string,
): HistoryPlanViewModel[] {
  return history.slice(0, MAX_LOCAL_HISTORY).map((plan) => ({
    id: plan.id,
    date: plan.date,
    dateLabel: formatPlanDate(plan.date),
    createdAtLabel: formatCreatedAt(plan.createdAt),
    isCurrent: plan.id === currentPlanId,
    meals: CORE_MEAL_TYPES.map((type) => ({
      type,
      label: CORE_MEAL_LABELS[type],
      name: (() => {
        const meal = plan.meals.find(item => item.type === type);
        if (!meal) return "未记录";
        if (!plan.memberIds.some(id => diningChoice(meal, id).source === "takeout")) return meal.name;
        return plan.profilesSnapshot.map(person => `${person.name}：${diningChoice(meal, person.id).source === "home"
          ? meal.name : usableTakeout(meal, plan, person.id, plan.preferencesSnapshot)?.name ?? "外卖待选"}`).join("；");
      })(),
    })),
    calories: plan.memberIds.slice(0, 2).map((memberId) => {
      const profile = plan.profilesSnapshot.find((item) => item.id === memberId);
      const calories = plan.nutritionByMemberId[memberId]?.caloriesKcal;
      const estimate = plannedNutrition(plan, memberId);
      return {
        memberId,
        memberName: profile?.name ?? memberId,
        emoji: profile?.emoji ?? "👤",
        value: estimate.hasTakeout
          ? `${nutritionRangeText(estimate.min.caloriesKcal, estimate.max.caloriesKcal)} kcal${estimate.pendingMeals ? "（部分待选）" : ""}`
          : Number.isFinite(calories) ? `${calories} kcal` : "未记录",
      };
    }),
  }));
}

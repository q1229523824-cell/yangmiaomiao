import { FOOD_BY_ID } from "../data/catalog";
import type {
  Allergen,
  DailyPlan,
  FoodGroup,
  MealType,
  Preferences,
  Profile,
  ShoppingItem
} from "../domain/models";

const MEAL_LABELS: Record<MealType, { emoji: string; label: string }> = {
  breakfast: { emoji: "🌅", label: "早餐" },
  lunch: { emoji: "☀️", label: "午餐" },
  dinner: { emoji: "🌙", label: "晚餐" },
  snack: { emoji: "🥤", label: "加餐" }
};

const METHOD_LABELS: Record<string, string> = {
  air_fryer: "空气炸锅",
  steam: "蒸箱/清蒸",
  braise: "水焖",
  microwave: "微波",
  boil: "水煮",
  ready_to_eat: "直接食用"
};

const FLAVOR_LABELS: Record<string, string> = {
  spicy: "辣味",
  garlic: "蒜香",
  black_pepper: "黑胡椒",
  cumin: "孜然",
  tomato: "番茄",
  lemon: "柠檬",
  light: "清淡"
};

const GROUP_LABELS: Record<FoodGroup, string> = {
  fish: "鱼类",
  poultry: "禽肉",
  pork: "猪肉",
  beef: "牛肉",
  shellfish: "虾贝类",
  egg: "蛋类",
  dairy: "奶制品",
  soy: "豆制品",
  supplement: "营养补剂",
  grain: "谷物主食",
  tuber: "薯类主食",
  vegetable: "蔬菜"
};

const ALLERGEN_LABELS: Record<Allergen, string> = {
  egg: "蛋类",
  milk: "牛奶",
  soy: "大豆",
  fish: "鱼类",
  shellfish: "虾贝类",
  gluten: "麸质"
};

export interface TodayProfileViewModel {
  id: string;
  name: string;
  emoji: string;
  stats: Array<{ label: string; value: string }>;
}

export interface MealViewModel {
  id: string;
  heading: string;
  name: string;
  method: string;
  tip: string;
  sauce: string;
  rows: Array<{
    id: string;
    foodName: string;
    weightState: string;
    portions: Array<{ memberId: string; memberName: string; gramsText: string }>;
  }>;
}

export interface PreferenceTagViewModel {
  id: string;
  kind: string;
  value: string;
  label: string;
  tone: "exclude" | "prefer" | "option" | "safety";
  removable: boolean;
}

export function toTodayProfileViewModels(
  plan: DailyPlan
): TodayProfileViewModel[] {
  return plan.profilesSnapshot.map((profile) => {
    const goals = plan.goalsByMemberId[profile.id];
    const actual = plan.nutritionByMemberId[profile.id];
    return {
      id: profile.id,
      name: profile.name,
      emoji: profile.emoji ?? "👤",
      stats: [
        {
          label: "热量",
          value: `${actual.caloriesKcal} / ${goals.caloriesKcal} kcal`
        },
        {
          label: "蛋白质",
          value: `${actual.proteinG} / ${goals.proteinG} g`
        },
        { label: "碳水", value: `${actual.carbsG} g` },
        { label: "脂肪", value: `${actual.fatG} g` }
      ]
    };
  });
}

function weightStateLabel(weightState: string): string {
  if (weightState === "dry") return "干重";
  if (weightState === "edible_raw") return "可食部生重";
  if (weightState === "as_sold") return "商品重量";
  return "生重";
}

export function toMealViewModels(plan: DailyPlan): MealViewModel[] {
  const profileById = Object.fromEntries(
    plan.profilesSnapshot.map((profile) => [profile.id, profile])
  ) as Record<string, Profile>;

  return plan.meals.map((meal) => {
    const meta = MEAL_LABELS[meal.type];
    return {
      id: meal.id,
      heading: `${meta.emoji} ${meta.label}`,
      name: meal.name,
      method: meal.cookingMethods.map((method) => METHOD_LABELS[method] ?? method).join(" / "),
      tip: meal.tip,
      sauce: meal.sauce ? `调味建议：${meal.sauce}` : "",
      rows: meal.items
        .filter((item) =>
          plan.memberIds.some((memberId) => (item.portionsByMemberId[memberId] ?? 0) > 0)
        )
        .map((item) => {
          const food = FOOD_BY_ID[item.foodId];
          return {
            id: item.id,
            foodName: food?.name ?? item.foodId,
            weightState: weightStateLabel(food?.weightState ?? "raw"),
            portions: plan.memberIds.map((memberId) => ({
              memberId,
              memberName: profileById[memberId]?.name ?? memberId,
              gramsText:
                (item.portionsByMemberId[memberId] ?? 0) > 0
                  ? `${item.portionsByMemberId[memberId]}g`
                  : "—"
            }))
          };
        })
    };
  });
}

export function preferenceSummary(
  preferences: Preferences
): PreferenceTagViewModel[] {
  return [
    ...preferences.excludedFoodIds.map((foodId) => ({
      id: `exclude_food:${foodId}`,
      kind: "exclude_food",
      value: foodId,
      label: `不吃 ${FOOD_BY_ID[foodId]?.name ?? foodId}`,
      tone: "exclude" as const,
      removable: true
    })),
    ...preferences.excludedFoodGroups.map((group) => ({
      id: `exclude_group:${group}`,
      kind: "exclude_group",
      value: group,
      label: `不吃 ${GROUP_LABELS[group]}`,
      tone: "exclude" as const,
      removable: true
    })),
    ...preferences.preferredFoodIds.map((foodId) => ({
      id: `prefer_food:${foodId}`,
      kind: "prefer_food",
      value: foodId,
      label: `优先 ${FOOD_BY_ID[foodId]?.name ?? foodId}`,
      tone: "prefer" as const,
      removable: true
    })),
    ...(preferences.avoidWhey
      ? [{
          id: "avoid_whey:true",
          kind: "avoid_whey",
          value: "true",
          label: "不使用蛋白粉",
          tone: "exclude" as const,
          removable: true
        }]
      : []),
    ...preferences.preferredCookingMethods.map((method) => ({
      id: `prefer_method:${method}`,
      kind: "prefer_method",
      value: method,
      label: `做法 ${METHOD_LABELS[method] ?? method}`,
      tone: "option" as const,
      removable: true
    })),
    ...preferences.preferredFlavors.map((flavor) => ({
      id: `prefer_flavor:${flavor}`,
      kind: "prefer_flavor",
      value: flavor,
      label: `口味 ${FLAVOR_LABELS[flavor] ?? flavor}`,
      tone: "option" as const,
      removable: true
    })),
    ...(preferences.lightDinner
      ? [{
          id: "light_dinner:true",
          kind: "light_dinner",
          value: "true",
          label: "晚餐清淡",
          tone: "option" as const,
          removable: true
        }]
      : []),
    ...preferences.allergens.map((allergen) => ({
      id: `allergen:${allergen}`,
      kind: "allergen",
      value: allergen,
      label: `过敏原 ${ALLERGEN_LABELS[allergen]}`,
      tone: "safety" as const,
      removable: false
    }))
  ];
}

export function toShoppingViewModels(
  plan: DailyPlan,
  items: readonly ShoppingItem[],
  checkedFoodIds: readonly string[]
) {
  return items.map((item) => ({
    foodId: item.foodId,
    name: FOOD_BY_ID[item.foodId]?.name ?? item.foodId,
    gramsText: `${item.totalGrams}g`,
    checked: checkedFoodIds.includes(item.foodId),
    detail: plan.profilesSnapshot
      .map((profile) => `${profile.name} ${item.portionsByMemberId[profile.id] ?? 0}g`)
      .join(" · ")
  }));
}

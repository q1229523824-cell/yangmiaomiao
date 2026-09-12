import { FOOD_BY_ID } from "../data/catalog";
import { TAKEOUT_TEMPLATES } from "../data/takeout-catalog";
import type { Allergen, FoodGroup, FoodId, Nutrition, Preferences, Profile } from "./models";
import { addNutrition, calculateGoals, nutritionForGrams } from "./nutrition";

export type TakeoutMealType = "lunch" | "dinner";
export type TakeoutCategory = "rice" | "hotpot" | "salad" | "noodles" | "vegetarian";

export interface TakeoutTemplate {
  id: string;
  name: string;
  category: TakeoutCategory;
  searchKeyword: string;
  orderText: string;
  portionDescription: string;
  assumptions: string[];
  tips: string[];
  ingredients: Array<{ foodId: FoodId; minGrams: number; maxGrams: number }>;
  addedOilGrams: { min: number; max: number };
  sauceCarbsGrams: { min: number; max: number };
  foodIds: FoodId[];
  possibleFoodIds: FoodId[];
  possibleFoodGroups: FoodGroup[];
  possibleAllergens: Allergen[];
}

export interface TakeoutTargets {
  maxCaloriesKcal: number;
  minProteinG: number;
  mealRatio: number;
  dailyCaloriesKcal: number;
  dailyProteinG: number;
}

export interface TakeoutTargetOverrides {
  maxCaloriesKcal?: number;
  minProteinG?: number;
}

export interface TakeoutRecommendation {
  template: TakeoutTemplate;
  nutrition: { min: Nutrition; max: Nutrition };
  meetsTargets: boolean;
  mismatchReasons: string[];
}

export interface TakeoutRecommendationOptions extends TakeoutTargetOverrides {
  profile: Profile;
  preferences: Preferences;
  mealType: TakeoutMealType;
  category?: TakeoutCategory | "all";
}

export interface TakeoutRecommendationResult {
  targets: TakeoutTargets;
  matches: TakeoutRecommendation[];
  alternatives: TakeoutRecommendation[];
  excludedCount: number;
  blockedReason?: string;
  notice: string;
}

export const TAKEOUT_ESTIMATE_NOTICE =
  "营养为所列食材、份量及少油少汁做法的组合估算，并非店铺实测。店铺实际用量可能超出区间；未评估卫生状况、钠含量或全部营养素。";

/** Meal percentages are editable software allocations, not clinical prescriptions. */
export function getTakeoutTargets(
  profile: Profile,
  mealType: TakeoutMealType,
  overrides: TakeoutTargetOverrides = {},
): TakeoutTargets {
  if (mealType !== "lunch" && mealType !== "dinner") {
    throw new Error("请选择午餐或晚餐。");
  }
  const profileValues = [
    profile.heightCm, profile.weightKg, profile.ageYears,
    profile.goalSettings.activityFactor, profile.goalSettings.calorieTargetRatio,
    profile.goalSettings.proteinGPerKg, profile.goalSettings.fatGPerKg,
  ];
  if (profileValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("请先完善有效的身高、体重和营养目标档案。");
  }
  const goals = calculateGoals(profile);
  if (!Number.isFinite(goals.caloriesKcal) || goals.caloriesKcal <= 0 || goals.proteinG <= 0) {
    throw new Error("当前档案无法计算有效的餐次参考值，请检查档案。");
  }
  if (overrides.maxCaloriesKcal !== undefined &&
      (!Number.isFinite(overrides.maxCaloriesKcal) || overrides.maxCaloriesKcal <= 0)) {
    throw new Error("热量上限需填写大于0的数字。");
  }
  if (overrides.minProteinG !== undefined &&
      (!Number.isFinite(overrides.minProteinG) || overrides.minProteinG < 0)) {
    throw new Error("蛋白质下限需填写大于或等于0的数字。");
  }
  const mealRatio = mealType === "lunch" ? 0.35 : 0.30;
  return {
    maxCaloriesKcal: overrides.maxCaloriesKcal ?? Math.round(goals.caloriesKcal * mealRatio),
    minProteinG: overrides.minProteinG ?? Math.ceil(goals.proteinG * mealRatio),
    mealRatio,
    dailyCaloriesKcal: goals.caloriesKcal,
    dailyProteinG: goals.proteinG,
  };
}

/** Outward rounding prevents a fractional amount from creating a false match. */
function outwardRound(value: Nutrition, direction: "min" | "max"): Nutrition {
  const round = direction === "min" ? Math.floor : Math.ceil;
  return {
    caloriesKcal: round(value.caloriesKcal),
    proteinG: round(value.proteinG),
    carbsG: round(value.carbsG),
    fatG: round(value.fatG),
  };
}

export function estimateTakeoutNutrition(template: TakeoutTemplate): { min: Nutrition; max: Nutrition } {
  const referencedFoodIds = [...template.foodIds, ...template.possibleFoodIds,
    ...template.ingredients.map((ingredient) => ingredient.foodId)];
  if (template.ingredients.length === 0 || referencedFoodIds.some((foodId) =>
    !Object.prototype.hasOwnProperty.call(FOOD_BY_ID, foodId))) {
    throw new Error("外卖组合食材数据无效，请更新小程序。");
  }
  const nutritionAt = (bound: "min" | "max"): Nutrition => {
    const ingredients = template.ingredients.map((ingredient) => {
      const food = FOOD_BY_ID[ingredient.foodId];
      if (!food || !Number.isFinite(ingredient.minGrams) || !Number.isFinite(ingredient.maxGrams) ||
          ingredient.minGrams < 0 || ingredient.maxGrams < ingredient.minGrams) {
        throw new Error("外卖组合食材数据无效，请更新小程序。");
      }
      return nutritionForGrams(food, bound === "min" ? ingredient.minGrams : ingredient.maxGrams);
    });
    for (const range of [template.addedOilGrams, template.sauceCarbsGrams]) {
      if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min < 0 || range.max < range.min) {
        throw new Error("外卖组合调料数据无效，请更新小程序。");
      }
    }
    const oil = template.addedOilGrams[bound];
    const carbs = template.sauceCarbsGrams[bound];
    return outwardRound(addNutrition(...ingredients, {
      caloriesKcal: oil * 9 + carbs * 4,
      proteinG: 0,
      carbsG: carbs,
      fatG: oil,
    }), bound);
  };
  return { min: nutritionAt("min"), max: nutritionAt("max") };
}

function conflictsWithPreferences(template: TakeoutTemplate, preferences: Preferences): boolean {
  const foodIds = [...template.foodIds, ...template.possibleFoodIds,
    ...template.ingredients.map((ingredient) => ingredient.foodId)];
  if (foodIds.some((foodId) => preferences.excludedFoodIds.includes(foodId))) return true;
  if (preferences.avoidWhey && foodIds.includes("whey_protein")) return true;
  // A species-unspecified broth/sauce may include a specifically excluded food.
  // Apply this only to uncertain groups: excluding bass must not prohibit a
  // known cod ingredient merely because both belong to the fish group.
  const excludedFoodGroups = preferences.excludedFoodIds.flatMap((foodId) =>
    Object.prototype.hasOwnProperty.call(FOOD_BY_ID, foodId) ? FOOD_BY_ID[foodId].groups : []);
  if (template.possibleFoodGroups.some((group) => excludedFoodGroups.includes(group))) return true;
  const groups = [...template.possibleFoodGroups,
    ...foodIds.flatMap((foodId) => FOOD_BY_ID[foodId]?.groups ?? [])];
  if (groups.some((group) => preferences.excludedFoodGroups.includes(group))) return true;
  const allergens = [...template.possibleAllergens,
    ...foodIds.flatMap((foodId) => FOOD_BY_ID[foodId]?.allergens ?? [])];
  return allergens.some((allergen) => preferences.allergens.includes(allergen));
}

export function getTakeoutRecommendations(options: TakeoutRecommendationOptions): TakeoutRecommendationResult {
  const targets = getTakeoutTargets(options.profile, options.mealType, options);
  const categories: string[] = ["all", "rice", "hotpot", "salad", "noodles", "vegetarian"];
  if (options.category !== undefined && !categories.includes(options.category)) {
    throw new Error("外卖分类无效，请重新选择。");
  }
  const candidates = TAKEOUT_TEMPLATES.filter((template) =>
    !options.category || options.category === "all" || template.category === options.category);
  const result: TakeoutRecommendationResult = {
    targets,
    matches: [],
    alternatives: [],
    excludedCount: 0,
    notice: TAKEOUT_ESTIMATE_NOTICE,
  };
  // Offline templates cannot verify store ingredients or cross-contact. A saved
  // allergy is not downgraded to a disclaimer under otherwise ordinary cards.
  if (options.preferences.allergens.length > 0) {
    result.excludedCount = candidates.length;
    result.blockedReason = "你记录了食物过敏。离线资料无法核实商家配料及交叉接触，因此暂不提供个性化外卖推荐。请先与商家确认，不要仅凭点单备注判断可食用。";
    return result;
  }
  for (const template of candidates) {
    const nutrition = estimateTakeoutNutrition(template);
    if (conflictsWithPreferences(template, options.preferences)) {
      result.excludedCount += 1;
      continue;
    }
    const mismatchReasons: string[] = [];
    if (nutrition.max.caloriesKcal > targets.maxCaloriesKcal) {
      mismatchReasons.push(`估算热量上界${nutrition.max.caloriesKcal}千卡，超过上限${targets.maxCaloriesKcal}千卡`);
    }
    if (nutrition.min.proteinG < targets.minProteinG) {
      mismatchReasons.push(`估算蛋白质下界${nutrition.min.proteinG}克，未达到下限${targets.minProteinG}克`);
    }
    const recommendation: TakeoutRecommendation = {
      template,
      nutrition,
      meetsTargets: mismatchReasons.length === 0,
      mismatchReasons,
    };
    (recommendation.meetsTargets ? result.matches : result.alternatives).push(recommendation);
  }
  // Catalog order is deliberately stable across reopening and switches.
  return result;
}

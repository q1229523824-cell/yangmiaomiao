import {
  BREAKFAST_TEMPLATES,
  FOOD_BY_ID,
  MAIN_MEAL_CARB_FOOD_IDS,
  RECIPES
} from "../data/catalog";
import type {
  BreakfastTemplate,
  DailyPlan,
  Food,
  FoodId,
  Goals,
  IngredientRole,
  Meal,
  MealItem,
  MemberId,
  Nutrition,
  Preferences,
  Profile,
  Recipe
} from "./models";
import {
  addNutrition,
  calculateGoals,
  nutritionForGrams,
  roundNutrition,
  roundToFive
} from "./nutrition";
import { validateDailyPlan } from "./plan-validator";

export const CATALOG_VERSION = 1;

export type MenuGenerationErrorCode =
  | "NO_MEMBERS"
  | "INVALID_PROFILE"
  | "NO_BREAKFAST_MATCH"
  | "NO_RECIPE_MATCH"
  | "NO_CARBOHYDRATE_MATCH"
  | "INVALID_PLAN";

export class MenuGenerationError extends Error {
  constructor(
    public readonly code: MenuGenerationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MenuGenerationError";
  }
}

export interface GenerateDailyPlanInput {
  date: string;
  profiles: readonly Profile[];
  preferences: Preferences;
  seed: number;
  createdAt?: string;
}

const REFERENCE_DAILY_CALORIES_KCAL = 1800;
const MIN_SERVING_SCALE = 0.55;
const MAX_SERVING_SCALE = 2.5;

function invalidProfile(message: string): never {
  throw new MenuGenerationError("INVALID_PROFILE", message);
}

function assertInRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
  memberName: string
): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    invalidProfile(`${memberName}的${label}应在 ${minimum}–${maximum} 之间。`);
  }
}

function validateProfiles(profiles: readonly Profile[]): void {
  const memberIds = new Set<string>();
  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") {
      invalidProfile("成员档案格式无效。");
    }
    const memberName =
      typeof profile.name === "string" && profile.name.trim()
        ? profile.name.trim()
        : "家庭成员";
    if (typeof profile.id !== "string" || !profile.id.trim()) {
      invalidProfile(`${memberName}缺少成员 ID。`);
    }
    if (memberIds.has(profile.id)) invalidProfile(`成员 ID 重复：${profile.id}。`);
    memberIds.add(profile.id);
    if (typeof profile.name !== "string" || !profile.name.trim()) {
      invalidProfile("成员称呼不能为空。");
    }
    if (profile.gender !== "female" && profile.gender !== "male") {
      invalidProfile(`${memberName}的生理性别设置无效。`);
    }
    assertInRange(profile.heightCm, 100, 230, "身高（cm）", memberName);
    assertInRange(profile.weightKg, 30, 300, "体重（kg）", memberName);
    assertInRange(profile.ageYears, 16, 100, "年龄", memberName);
    if (!profile.goalSettings || typeof profile.goalSettings !== "object") {
      invalidProfile(`${memberName}缺少营养目标设置。`);
    }
    assertInRange(
      profile.goalSettings.activityFactor,
      1,
      3,
      "活动系数",
      memberName
    );
    assertInRange(
      profile.goalSettings.calorieTargetRatio,
      0.4,
      1.2,
      "目标热量比例",
      memberName
    );
    assertInRange(
      profile.goalSettings.proteinGPerKg,
      0.5,
      4,
      "每公斤蛋白质",
      memberName
    );
    assertInRange(
      profile.goalSettings.fatGPerKg,
      0.2,
      2,
      "每公斤脂肪",
      memberName
    );
  }
}

/**
 * Recipe portions are authored around an 1800 kcal reference day. Scaling by
 * the member's current calculated energy target makes height, weight, age,
 * activity and target intensity all affect a newly generated plan. The clamp
 * prevents an extreme-but-valid profile from producing an unusable base meal;
 * the later protein/calorie adjustment still moves the plan toward its target.
 */
function servingScale(profile: Profile): number {
  const targetCalories = calculateGoals(profile).caloriesKcal;
  return Math.min(
    MAX_SERVING_SCALE,
    Math.max(MIN_SERVING_SCALE, targetCalories / REFERENCE_DAILY_CALORIES_KCAL)
  );
}

function portionForProfile(
  profile: Profile,
  baseGrams: number,
  minimum = 0
): number {
  return roundToFive(baseGrams * servingScale(profile), minimum);
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickOne<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function getFood(foodId: FoodId): Food {
  const food = FOOD_BY_ID[foodId];
  if (!food) throw new Error(`未知食材：${foodId}`);
  return food;
}

function isFoodAllowed(foodId: FoodId, preferences: Preferences): boolean {
  const food = getFood(foodId);
  if (preferences.excludedFoodIds.includes(foodId)) return false;
  if (food.groups.some((group) => preferences.excludedFoodGroups.includes(group))) {
    return false;
  }
  if (food.allergens?.some((allergen) => preferences.allergens.includes(allergen))) {
    return false;
  }
  return !(preferences.avoidWhey && foodId === "whey_protein");
}

function isRecipeAllowed(recipe: Recipe, preferences: Preferences): boolean {
  return [recipe.mainProteinFoodId, ...recipe.vegetableFoodIds].every((foodId) =>
    isFoodAllowed(foodId, preferences)
  );
}

function chooseRecipePool(preferences: Preferences): Recipe[] {
  let pool = RECIPES.filter((recipe) => isRecipeAllowed(recipe, preferences));
  if (pool.length === 0) {
    throw new MenuGenerationError(
      "NO_RECIPE_MATCH",
      "当前禁忌条件下没有可用正餐，请减少排除项后再试。"
    );
  }

  if (preferences.preferredCookingMethods.length > 0) {
    const matches = pool.filter((recipe) =>
      recipe.cookingMethods.some((method) =>
        preferences.preferredCookingMethods.includes(method)
      )
    );
    if (matches.length > 0) pool = matches;
  }

  if (preferences.preferredFlavors.length > 0) {
    const matches = pool.filter((recipe) =>
      recipe.flavors.some((flavor) => preferences.preferredFlavors.includes(flavor))
    );
    if (matches.length > 0) pool = matches;
  }

  if (preferences.preferredFoodIds.length > 0) {
    const matches = pool.filter((recipe) =>
      [recipe.mainProteinFoodId, ...recipe.vegetableFoodIds].some((foodId) =>
        preferences.preferredFoodIds.includes(foodId)
      )
    );
    if (matches.length > 0) pool = matches;
  }

  return pool;
}

function chooseBreakfast(
  preferences: Preferences,
  random: () => number
): BreakfastTemplate {
  let pool = BREAKFAST_TEMPLATES.filter((template) =>
    template.ingredients.every((item) => isFoodAllowed(item.foodId, preferences))
  );
  if (pool.length === 0) {
    throw new MenuGenerationError(
      "NO_BREAKFAST_MATCH",
      "当前禁忌条件下没有可用早餐。"
    );
  }
  if (preferences.preferredFoodIds.length > 0) {
    const matches = pool.filter((template) =>
      template.ingredients.some((item) =>
        preferences.preferredFoodIds.includes(item.foodId)
      )
    );
    if (matches.length > 0) pool = matches;
  }
  return pickOne(pool, random);
}

function chooseCarbohydrate(
  preferences: Preferences,
  random: () => number
): FoodId {
  let pool = MAIN_MEAL_CARB_FOOD_IDS.filter((foodId) =>
    isFoodAllowed(foodId, preferences)
  );
  if (pool.length === 0) {
    throw new MenuGenerationError(
      "NO_CARBOHYDRATE_MATCH",
      "当前禁忌条件下没有可用主食。"
    );
  }
  const preferred = pool.filter((foodId) =>
    preferences.preferredFoodIds.includes(foodId)
  );
  if (preferred.length > 0) pool = preferred;
  return pickOne(pool, random);
}

function portions(
  profiles: readonly Profile[],
  baseGrams: number,
  minimum = 0
): Record<MemberId, number> {
  return Object.fromEntries(
    profiles.map((profile) => [
      profile.id,
      portionForProfile(profile, baseGrams, minimum)
    ])
  );
}

function item(
  mealId: string,
  foodId: FoodId,
  role: IngredientRole,
  portionsByMemberId: Record<MemberId, number>
): MealItem {
  return {
    id: `${mealId}-${foodId}`,
    foodId,
    role,
    portionsByMemberId
  };
}

function buildBreakfastMeal(
  template: BreakfastTemplate,
  profiles: readonly Profile[]
): Meal {
  const id = "meal-breakfast";
  return {
    id,
    type: "breakfast",
    name: template.name,
    breakfastTemplateId: template.id,
    cookingMethods: [...template.cookingMethods],
    tip: template.tip,
    items: template.ingredients.map((ingredient) =>
      item(
        id,
        ingredient.foodId,
        ingredient.role,
        portions(profiles, ingredient.basePortionG)
      )
    )
  };
}

function isDryMainCarbohydrate(foodId: FoodId): boolean {
  return [
    "white_rice_raw",
    "brown_rice_raw",
    "pasta_dry",
    "buckwheat_noodles_dry"
  ].includes(foodId);
}

function buildMainMeal(
  type: "lunch" | "dinner",
  recipe: Recipe,
  carbohydrateId: FoodId,
  profiles: readonly Profile[]
): Meal {
  const id = `meal-${type}`;
  const proteinBase = type === "lunch" ? 165 : 155;
  const carbohydrateBase = isDryMainCarbohydrate(carbohydrateId) ? 65 : 180;
  return {
    id,
    type,
    name: recipe.name,
    recipeId: recipe.id,
    cookingMethods: [...recipe.cookingMethods],
    sauce: recipe.sauce,
    tip: recipe.tip,
    items: [
      item(id, carbohydrateId, "carbohydrate", portions(profiles, carbohydrateBase)),
      item(
        id,
        recipe.mainProteinFoodId,
        "protein",
        portions(profiles, proteinBase, 100)
      ),
      ...recipe.vegetableFoodIds.map((foodId) =>
        item(id, foodId, "vegetable", portions(profiles, 120))
      )
    ]
  };
}

function nutritionForMember(meals: readonly Meal[], memberId: MemberId): Nutrition {
  return meals.reduce<Nutrition>(
    (total, meal) =>
      addNutrition(
        total,
        ...meal.items.map((mealItem) =>
          nutritionForGrams(
            getFood(mealItem.foodId),
            mealItem.portionsByMemberId[memberId] ?? 0
          )
        )
      ),
    { caloriesKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

function addSnack(
  meals: Meal[],
  profiles: readonly Profile[],
  goalsByMemberId: Record<MemberId, Goals>,
  preferences: Preferences
): void {
  const id = "meal-snack";
  const snack: Meal = {
    id,
    type: "snack",
    name: "简单补蛋白",
    cookingMethods: ["ready_to_eat"],
    tip: "加餐用于让全天蛋白质接近目标，不追求每克都精准。",
    items: []
  };

  const selectedByMember = new Map<MemberId, { foodId: FoodId; grams: number }>();
  for (const profile of profiles) {
    const current = nutritionForMember(meals, profile.id);
    const gap = goalsByMemberId[profile.id].proteinG - current.proteinG;
    if (gap <= 8) continue;
    if (!preferences.avoidWhey && isFoodAllowed("whey_protein", preferences)) {
      const whey = getFood("whey_protein");
      const grams = roundToFive(
        Math.min(40, Math.max(15, gap / (whey.nutritionPer100g.proteinG / 100)))
      );
      selectedByMember.set(profile.id, { foodId: whey.id, grams });
    } else {
      const yogurt = getFood("greek_yogurt");
      if (!isFoodAllowed(yogurt.id, preferences)) {
        continue;
      }
      selectedByMember.set(profile.id, {
        foodId: yogurt.id,
        grams: portionForProfile(profile, 150, 100)
      });
    }
  }

  for (const foodId of new Set([...selectedByMember.values()].map((value) => value.foodId))) {
    snack.items.push(
      item(
        id,
        foodId,
        "extra",
        Object.fromEntries(
          profiles.map((profile) => [
            profile.id,
            selectedByMember.get(profile.id)?.foodId === foodId
              ? selectedByMember.get(profile.id)?.grams ?? 0
              : 0
          ])
        )
      )
    );
  }
  // A snack is optional. When all available snack foods are forbidden (for
  // example milk allergy plus disabled whey), omit the meal instead of
  // returning an invalid empty meal.
  if (snack.items.length > 0) meals.push(snack);
}

function adjustMemberPortions(
  meals: Meal[],
  profile: Profile,
  goals: Goals
): void {
  const lunch = meals.find((meal) => meal.type === "lunch");
  const dinner = meals.find((meal) => meal.type === "dinner");
  if (!lunch || !dinner) throw new Error("菜单缺少午餐或晚餐");
  const lunchProtein = lunch.items.find((mealItem) => mealItem.role === "protein");
  const dinnerProtein = dinner.items.find((mealItem) => mealItem.role === "protein");
  if (!lunchProtein || !dinnerProtein) throw new Error("正餐缺少蛋白质食材");

  for (let pass = 0; pass < 4; pass += 1) {
    const current = nutritionForMember(meals, profile.id);
    const gap = goals.proteinG - current.proteinG;
    if (Math.abs(gap) <= 8) break;
    const target = gap > 0 ? lunchProtein : dinnerProtein;
    const proteinPerGram = getFood(target.foodId).nutritionPer100g.proteinG / 100;
    const currentGrams = target.portionsByMemberId[profile.id] ?? 0;
    target.portionsByMemberId[profile.id] = roundToFive(
      currentGrams + gap / proteinPerGram / 2,
      100
    );
  }

  const current = nutritionForMember(meals, profile.id);
  const calorieGap = goals.caloriesKcal - current.caloriesKcal;
  if (Math.abs(calorieGap) > 180) {
    const lunchCarbohydrate = lunch.items.find(
      (mealItem) => mealItem.role === "carbohydrate"
    );
    if (!lunchCarbohydrate) throw new Error("午餐缺少主食");
    const caloriesPerGram =
      getFood(lunchCarbohydrate.foodId).nutritionPer100g.caloriesKcal / 100;
    const currentGrams = lunchCarbohydrate.portionsByMemberId[profile.id] ?? 0;
    lunchCarbohydrate.portionsByMemberId[profile.id] = roundToFive(
      currentGrams + (calorieGap / caloriesPerGram) * 0.55,
      30
    );
  }
}

function snapshotPreferences(preferences: Preferences): Preferences {
  return {
    ...preferences,
    excludedFoodIds: [...preferences.excludedFoodIds],
    preferredFoodIds: [...preferences.preferredFoodIds],
    excludedFoodGroups: [...preferences.excludedFoodGroups],
    preferredCookingMethods: [...preferences.preferredCookingMethods],
    preferredFlavors: [...preferences.preferredFlavors],
    allergens: [...preferences.allergens]
  };
}

function snapshotProfiles(profiles: readonly Profile[]): Profile[] {
  return profiles.map((profile) => ({
    ...profile,
    goalSettings: { ...profile.goalSettings }
  }));
}

export function generateDailyPlan(input: GenerateDailyPlanInput): DailyPlan {
  if (input.profiles.length === 0) {
    throw new MenuGenerationError("NO_MEMBERS", "至少需要一位家庭成员。 ");
  }
  validateProfiles(input.profiles);
  const random = createSeededRandom(input.seed);
  const recipePool = chooseRecipePool(input.preferences);
  const breakfast = chooseBreakfast(input.preferences, random);
  const lunchRecipe = pickOne(recipePool, random);

  let dinnerPool = recipePool.filter(
    (recipe) =>
      recipe.id !== lunchRecipe.id &&
      recipe.mainProteinFoodId !== lunchRecipe.mainProteinFoodId
  );
  if (dinnerPool.length === 0) {
    dinnerPool = recipePool.filter((recipe) => recipe.id !== lunchRecipe.id);
  }
  if (dinnerPool.length === 0) dinnerPool = [...recipePool];
  if (input.preferences.lightDinner) {
    const light = dinnerPool.filter(
      (recipe) =>
        recipe.flavors.includes("light") || recipe.cookingMethods.includes("steam")
    );
    if (light.length > 0) dinnerPool = light;
  }
  const dinnerRecipe = pickOne(dinnerPool, random);

  // Carbohydrates are selected exactly once per meal and then shared. This is
  // the central bug fix compared with the original per-person generator.
  const lunchCarbohydrateId = chooseCarbohydrate(input.preferences, random);
  const dinnerCarbohydrateId = chooseCarbohydrate(input.preferences, random);
  const meals: Meal[] = [
    buildBreakfastMeal(breakfast, input.profiles),
    buildMainMeal("lunch", lunchRecipe, lunchCarbohydrateId, input.profiles),
    buildMainMeal("dinner", dinnerRecipe, dinnerCarbohydrateId, input.profiles)
  ];

  const goalsByMemberId = Object.fromEntries(
    input.profiles.map((profile) => [profile.id, calculateGoals(profile)])
  );
  addSnack(meals, input.profiles, goalsByMemberId, input.preferences);
  for (const profile of input.profiles) {
    adjustMemberPortions(meals, profile, goalsByMemberId[profile.id]);
  }

  const nutritionByMemberId = Object.fromEntries(
    input.profiles.map((profile) => [
      profile.id,
      roundNutrition(nutritionForMember(meals, profile.id))
    ])
  );

  const plan: DailyPlan = {
    id: `plan-${input.date}-${input.seed >>> 0}`,
    date: input.date,
    seed: input.seed >>> 0,
    catalogVersion: CATALOG_VERSION,
    memberIds: input.profiles.map((profile) => profile.id),
    profilesSnapshot: snapshotProfiles(input.profiles),
    meals,
    goalsByMemberId,
    nutritionByMemberId,
    preferencesSnapshot: snapshotPreferences(input.preferences),
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const validation = validateDailyPlan(plan);
  if (!validation.valid) {
    throw new MenuGenerationError(
      "INVALID_PLAN",
      `菜单生成校验失败：${validation.errors.join("；")}`
    );
  }
  return plan;
}

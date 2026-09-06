/**
 * Domain contracts for the offline meal planner.
 *
 * A plan contains one shared set of meals. Individual serving sizes live on
 * each MealItem in portionsByMemberId; separate per-person menus are
 * intentionally not represented by this model.
 */

export type MemberId = string;
export type FoodId = string;
export type RecipeId = string;
export type BreakfastTemplateId = string;
export type MealId = string;
export type DailyPlanId = string;

export type BiologicalSex = "female" | "male";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type FoodCategory = "protein" | "carbohydrate" | "vegetable" | "extra";
export type IngredientRole =
  | "carbohydrate"
  | "protein"
  | "vegetable"
  | "extra"
  | "drink";

export type FoodWeightState = "raw" | "dry" | "edible_raw" | "as_sold";

export type CookingMethod =
  | "air_fryer"
  | "steam"
  | "braise"
  | "microwave"
  | "boil"
  | "ready_to_eat";

export type Flavor =
  | "spicy"
  | "garlic"
  | "black_pepper"
  | "cumin"
  | "tomato"
  | "lemon"
  | "light";

export type FoodGroup =
  | "poultry"
  | "pork"
  | "beef"
  | "fish"
  | "shellfish"
  | "egg"
  | "dairy"
  | "soy"
  | "supplement"
  | "grain"
  | "tuber"
  | "vegetable";

export type Allergen = "egg" | "milk" | "soy" | "fish" | "shellfish" | "gluten";

/** Energy and macronutrients for a stated amount of food. */
export interface Nutrition {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Calculated daily targets. */
export interface Goals extends Nutrition {
  bmrKcal: number;
  tdeeKcal: number;
}

export interface GoalSettings {
  /** Activity multiplier applied to BMR. The original prototype uses 1.55. */
  activityFactor: number;
  /** Daily energy target divided by TDEE. The original prototype uses 0.8. */
  calorieTargetRatio: number;
  proteinGPerKg: number;
  fatGPerKg: number;
}

export interface Profile {
  id: MemberId;
  name: string;
  gender: BiologicalSex;
  heightCm: number;
  weightKg: number;
  ageYears: number;
  emoji?: string;
  /**
   * Legacy multiplier retained so existing local data can still be read.
   * New menus derive serving sizes from the calculated goal instead.
   */
  portionMultiplier: number;
  goalSettings: GoalSettings;
}

export interface Food {
  id: FoodId;
  name: string;
  category: FoodCategory;
  /** Values are always expressed per 100 g in the declared weight state. */
  nutritionPer100g: Nutrition;
  weightState: FoodWeightState;
  groups: FoodGroup[];
  allergens?: Allergen[];
}

/** Lunch/dinner template. A carbohydrate is chosen separately by the engine. */
export interface Recipe {
  id: RecipeId;
  name: string;
  mainProteinFoodId: FoodId;
  vegetableFoodIds: FoodId[];
  cookingMethods: CookingMethod[];
  flavors: Flavor[];
  sauce: string;
  tip: string;
}

export interface BreakfastTemplateIngredient {
  foodId: FoodId;
  role: IngredientRole;
  /** Female/default base serving from the source prototype, in grams. */
  basePortionG: number;
}

export interface BreakfastTemplate {
  id: BreakfastTemplateId;
  name: string;
  ingredients: BreakfastTemplateIngredient[];
  cookingMethods: CookingMethod[];
  tip: string;
}

/** Grams of one shared ingredient allocated to each plan member. */
export type PortionsByMemberId = Record<MemberId, number>;

export interface MealItem {
  id: string;
  foodId: FoodId;
  role: IngredientRole;
  portionsByMemberId: PortionsByMemberId;
}

/**
 * A meal is common to every member in the plan. Only its item portions differ.
 */
export interface Meal {
  id: MealId;
  type: MealType;
  name: string;
  recipeId?: RecipeId;
  breakfastTemplateId?: BreakfastTemplateId;
  cookingMethods: CookingMethod[];
  sauce?: string;
  tip: string;
  items: MealItem[];
}

export interface Preferences {
  excludedFoodIds: FoodId[];
  preferredFoodIds: FoodId[];
  excludedFoodGroups: FoodGroup[];
  avoidWhey: boolean;
  preferredCookingMethods: CookingMethod[];
  preferredFlavors: Flavor[];
  lightDinner: boolean;
  allergens: Allergen[];
}

export interface DailyPlan {
  id: DailyPlanId;
  /** Local calendar date, formatted as YYYY-MM-DD. */
  date: string;
  /** Makes random choices reproducible for tests and saved history. */
  seed: number;
  /** Version of the bundled food and recipe catalog used for this snapshot. */
  catalogVersion: number;
  memberIds: MemberId[];
  profilesSnapshot: Profile[];
  /** One shared menu; portions are stored on each meal item. */
  meals: Meal[];
  goalsByMemberId: Record<MemberId, Goals>;
  nutritionByMemberId: Record<MemberId, Nutrition>;
  preferencesSnapshot: Preferences;
  createdAt: string;
}

export interface ShoppingItem {
  foodId: FoodId;
  totalGrams: number;
  portionsByMemberId: PortionsByMemberId;
  checked: boolean;
}

export type PreferenceChangeKind =
  | "exclude_food"
  | "prefer_food"
  | "exclude_group"
  | "add_allergen"
  | "remove_allergen"
  | "avoid_whey"
  | "allow_whey"
  | "prefer_method"
  | "prefer_flavor"
  | "light_dinner"
  | "reset";

export interface PreferenceChange {
  kind: PreferenceChangeKind;
  value?: string;
}

export interface ParseResult {
  input: string;
  preferences: Preferences;
  changes: PreferenceChange[];
  changed: boolean;
  reset: boolean;
  reply: string;
  unrecognized: string[];
  warnings: string[];
}

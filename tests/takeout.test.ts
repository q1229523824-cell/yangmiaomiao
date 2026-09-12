import { describe, expect, it } from "vitest";
import { FOOD_BY_ID } from "../miniprogram/data/catalog";
import { cloneDefaultProfiles, createEmptyPreferences } from "../miniprogram/data/defaults";
import { TAKEOUT_CATEGORIES, TAKEOUT_TEMPLATES } from "../miniprogram/data/takeout-catalog";
import { parsePreferences } from "../miniprogram/domain/preference-parser";
import {
  estimateTakeoutNutrition,
  getTakeoutRecommendations,
  getTakeoutTargets,
  type TakeoutMealType,
  type TakeoutRecommendationOptions,
} from "../miniprogram/domain/takeout";

function options(overrides: Partial<TakeoutRecommendationOptions> = {}): TakeoutRecommendationOptions {
  return {
    profile: cloneDefaultProfiles()[0],
    preferences: createEmptyPreferences(),
    mealType: "lunch",
    ...overrides,
  };
}

describe("offline takeout estimates", () => {
  it("uses complete catalog ingredients and declared portions for every order combination", () => {
    expect(TAKEOUT_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TAKEOUT_TEMPLATES.map((template) => template.id)).size).toBe(TAKEOUT_TEMPLATES.length);
    for (const template of TAKEOUT_TEMPLATES) {
      expect(TAKEOUT_CATEGORIES.some((category) => category.id === template.category)).toBe(true);
      for (const ingredient of template.ingredients) {
        expect(FOOD_BY_ID[ingredient.foodId]).toBeDefined();
        expect(template.foodIds).toContain(ingredient.foodId);
        expect(ingredient.minGrams).toBeGreaterThan(0);
        expect(ingredient.maxGrams).toBeGreaterThanOrEqual(ingredient.minGrams);
      }
      const nutrition = estimateTakeoutNutrition(template);
      for (const nutrient of ["caloriesKcal", "proteinG", "carbsG", "fatG"] as const) {
        expect(nutrition.min[nutrient]).toBeGreaterThan(0);
        expect(nutrition.max[nutrient]).toBeGreaterThanOrEqual(nutrition.min[nutrient]);
      }
      expect(template.orderText.length).toBeGreaterThan(20);
      expect(template.portionDescription.length).toBeGreaterThan(20);
      expect(template.assumptions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("calculates chicken rice from food amounts plus added oil and sauce, rounding outward", () => {
    const nutrition = estimateTakeoutNutrition(TAKEOUT_TEMPLATES[0]);
    // Min: 195g thigh + 40g rice + 100g broccoli + 100g cabbage + 3g oil + 2g sauce carbs.
    expect(nutrition.min).toEqual({ caloriesKcal: 476, proteinG: 45, carbsG: 44, fatG: 13 });
    // Max: 210g thigh + 45g rice + 115g broccoli + 115g cabbage + 5g oil + 4g sauce carbs.
    expect(nutrition.max).toEqual({ caloriesKcal: 548, proteinG: 49, carbsG: 53, fatG: 17 });
  });

  it("fails closed for broken amounts or unknown ingredients rather than undercounting a dish", () => {
    expect(() => estimateTakeoutNutrition({ ...TAKEOUT_TEMPLATES[0], ingredients: [{ foodId: "unknown", minGrams: 100, maxGrams: 120 }] })).toThrow("食材数据无效");
    expect(() => estimateTakeoutNutrition({ ...TAKEOUT_TEMPLATES[0], addedOilGrams: { min: 5, max: 1 } })).toThrow("调料数据无效");
  });

  it.each(["missing_sauce", "constructor", "__proto__"])("rejects unrecognized possible ingredients including object keys: %s", (foodId) => {
    expect(() => estimateTakeoutNutrition({ ...TAKEOUT_TEMPLATES[0], possibleFoodIds: [foodId] })).toThrow("食材数据无效");
  });

  it("rejects an empty combination instead of reporting sauce-only nutrition", () => {
    expect(() => estimateTakeoutNutrition({ ...TAKEOUT_TEMPLATES[0], ingredients: [] })).toThrow("食材数据无效");
  });
});

describe("takeout targets and matching", () => {
  it("uses the current member goals and an explicit meal allocation", () => {
    expect(getTakeoutTargets(cloneDefaultProfiles()[0], "lunch")).toEqual({
      maxCaloriesKcal: 584, minProteinG: 42, mealRatio: 0.35, dailyCaloriesKcal: 1668, dailyProteinG: 120,
    });
    expect(getTakeoutTargets(cloneDefaultProfiles()[1], "dinner")).toMatchObject({ maxCaloriesKcal: 641, minProteinG: 45, mealRatio: 0.3 });
    const profile = cloneDefaultProfiles()[0];
    profile.weightKg = 70;
    expect(getTakeoutTargets(profile, "lunch").minProteinG).toBe(49);
  });

  it("has at least one genuine match for each demo member at lunch and dinner", () => {
    for (const profile of cloneDefaultProfiles()) {
      for (const mealType of ["lunch", "dinner"] as const) {
        const result = getTakeoutRecommendations(options({ profile, mealType }));
        expect(result.matches.length, `${profile.id}/${mealType}`).toBeGreaterThan(0);
        for (const match of result.matches) {
          expect(match.nutrition.max.caloriesKcal).toBeLessThanOrEqual(result.targets.maxCaloriesKcal);
          expect(match.nutrition.min.proteinG).toBeGreaterThanOrEqual(result.targets.minProteinG);
          expect(match.mismatchReasons).toEqual([]);
        }
      }
    }
  });

  it("requires BOTH the full calorie upper bound and protein lower bound to pass", () => {
    const template = TAKEOUT_TEMPLATES[0];
    const nutrition = estimateTakeoutNutrition(template);
    const exact = getTakeoutRecommendations(options({ maxCaloriesKcal: nutrition.max.caloriesKcal, minProteinG: nutrition.min.proteinG }));
    expect(exact.matches.map((item) => item.template.id)).toContain(template.id);
    const tooTight = getTakeoutRecommendations(options({ maxCaloriesKcal: nutrition.max.caloriesKcal - 0.1, minProteinG: nutrition.min.proteinG + 0.1 }));
    expect(tooTight.matches.map((item) => item.template.id)).not.toContain(template.id);
    const alternative = tooTight.alternatives.find((item) => item.template.id === template.id)!;
    expect(alternative.meetsTargets).toBe(false);
    expect(alternative.mismatchReasons).toHaveLength(2);
  });

  it("returns honest alternatives when nothing fits instead of silently relaxing targets", () => {
    const result = getTakeoutRecommendations(options({ maxCaloriesKcal: 50, minProteinG: 150 }));
    expect(result.matches).toEqual([]);
    expect(result.alternatives).toHaveLength(TAKEOUT_TEMPLATES.length);
    expect(result.alternatives.every((item) => !item.meetsTargets && item.mismatchReasons.length === 2)).toBe(true);
    expect(result.targets).toMatchObject({ maxCaloriesKcal: 50, minProteinG: 150 });
  });

  it("filters categories without mutating profiles or changing order on reopening", () => {
    const input = options({ category: "rice" });
    const before = JSON.stringify(input);
    const result = getTakeoutRecommendations(input);
    expect([...result.matches, ...result.alternatives].every((item) => item.template.category === "rice")).toBe(true);
    expect(getTakeoutRecommendations(input)).toEqual(result);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    { maxCaloriesKcal: NaN }, { maxCaloriesKcal: Infinity }, { maxCaloriesKcal: 0 },
    { minProteinG: NaN }, { minProteinG: Infinity }, { minProteinG: -1 },
  ])("rejects invalid custom limits %j", (limits) => {
    expect(() => getTakeoutRecommendations(options(limits))).toThrow();
  });

  it("rejects invalid meal and profile values but permits a zero protein filter", () => {
    expect(() => getTakeoutTargets(cloneDefaultProfiles()[0], "snack" as TakeoutMealType)).toThrow("午餐或晚餐");
    const profile = cloneDefaultProfiles()[0];
    profile.weightKg = NaN;
    expect(() => getTakeoutTargets(profile, "lunch")).toThrow("档案");
    expect(getTakeoutTargets(cloneDefaultProfiles()[0], "dinner", { minProteinG: 0 }).minProteinG).toBe(0);
  });
});

describe("takeout hard preference exclusions", () => {
  it("excludes tomato in food AND possible sauces from matches and alternatives", () => {
    const preferences = parsePreferences("不要番茄", createEmptyPreferences()).preferences;
    const result = getTakeoutRecommendations(options({ preferences, maxCaloriesKcal: 50 }));
    const visible = [...result.matches, ...result.alternatives];
    expect(visible.length).toBeGreaterThan(0);
    expect(result.excludedCount).toBeGreaterThan(1);
    for (const item of visible) {
      expect([...item.template.foodIds, ...item.template.possibleFoodIds]).not.toContain("tomato");
    }
    expect(visible.map((item) => item.template.id)).not.toContain("shaxian_chicken_rice_small");
    expect(visible.map((item) => item.template.id)).not.toContain("chicken_sweet_potato_salad");
  });

  it("excludes fish ingredients as well as uncertain fish broths and sauces", () => {
    const preferences = parsePreferences("不吃鱼", createEmptyPreferences()).preferences;
    const result = getTakeoutRecommendations(options({ preferences, maxCaloriesKcal: 999 }));
    const visible = [...result.matches, ...result.alternatives];
    expect(visible.map((item) => item.template.id)).toEqual(["egg_vegetable_rice_soy_milk"]);
    expect(result.excludedCount).toBe(TAKEOUT_TEMPLATES.length - 1);
  });

  it("a specific shrimp exclusion also excludes unspecified shellfish broths and sauces", () => {
    const preferences = parsePreferences("不要虾", createEmptyPreferences()).preferences;
    expect(preferences.excludedFoodIds).toContain("shrimp");
    const result = getTakeoutRecommendations(options({ preferences, maxCaloriesKcal: 999 }));
    const visible = [...result.matches, ...result.alternatives];
    expect(visible.length).toBeGreaterThan(0);
    expect(result.excludedCount).toBeGreaterThan(0);
    for (const item of visible) {
      expect(item.template.possibleFoodGroups).not.toContain("shellfish");
    }
  });

  it("a specific fish exclusion excludes species-unspecified broth without banning known other fish", () => {
    const preferences = parsePreferences("不要鳕鱼", createEmptyPreferences()).preferences;
    expect(preferences.excludedFoodIds).toContain("cod");
    expect(preferences.excludedFoodGroups).not.toContain("fish");
    const result = getTakeoutRecommendations(options({ preferences, maxCaloriesKcal: 999 }));
    const visible = [...result.matches, ...result.alternatives];
    expect(visible.map((item) => item.template.id)).toContain("steamed_fish_rice");
    expect(visible.map((item) => item.template.id)).not.toContain("clear_malatang_chicken");
    expect(visible.map((item) => item.template.id)).not.toContain("chicken_buckwheat_noodles");
  });

  it("uses shared profile food exclusions for possible hidden ingredients", () => {
    const preferences = createEmptyPreferences();
    preferences.excludedFoodIds = ["onion"];
    const result = getTakeoutRecommendations(options({ preferences }));
    for (const item of [...result.matches, ...result.alternatives]) {
      expect(item.template.possibleFoodIds).not.toContain("onion");
    }
  });

  it.each(["egg", "milk", "soy", "fish", "shellfish", "gluten"] as const)("blocks personalized results for saved %s allergy even if a dish seems unrelated", (allergen) => {
    const preferences = createEmptyPreferences();
    preferences.allergens = [allergen];
    const result = getTakeoutRecommendations(options({ preferences }));
    expect(result.matches).toEqual([]);
    expect(result.alternatives).toEqual([]);
    expect(result.blockedReason).toContain("交叉接触");
    expect(result.excludedCount).toBe(TAKEOUT_TEMPLATES.length);
  });

  it("does not repopulate alternatives when every category is excluded", () => {
    const preferences = createEmptyPreferences();
    preferences.excludedFoodGroups = ["vegetable"];
    const result = getTakeoutRecommendations(options({ preferences }));
    expect(result.matches).toEqual([]);
    expect(result.alternatives).toEqual([]);
    expect(result.excludedCount).toBe(TAKEOUT_TEMPLATES.length);
  });
});

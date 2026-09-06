import { describe, expect, it } from "vitest";

import {
  FOOD_BY_ID,
  DEFAULT_PROFILES,
  RECIPES,
} from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import {
  createEmptyPreferences,
  parsePreferences,
} from "../miniprogram/domain/preference-parser";

describe("偏好硬排除与菜单生成", () => {
  it("不要牛肉时任何随机种子都不会出现牛里脊或牛腱", () => {
    const parsed = parsePreferences("不要牛肉", createEmptyPreferences());
    expect(parsed.preferences.excludedFoodGroups).toContain("beef");

    for (let seed = 0; seed < 128; seed += 1) {
      const plan = generateDailyPlan({
        date: "2026-09-07",
        profiles: DEFAULT_PROFILES,
        preferences: parsed.preferences,
        seed,
        createdAt: "2026-09-07T00:00:00.000Z",
      });
      const allFoodIds = plan.meals.flatMap((meal) =>
        meal.items.map((item) => item.foodId),
      );
      expect(allFoodIds, `seed=${seed} 出现牛里脊`).not.toContain(
        "beef_tenderloin",
      );
      expect(allFoodIds, `seed=${seed} 出现牛腱`).not.toContain("beef_shank");
    }
  });

  it("跨多个随机种子都不会让被排除的番茄进入菜谱或餐项", () => {
    const parsed = parsePreferences("不要番茄", createEmptyPreferences());

    for (let seed = 0; seed < 256; seed += 1) {
      const plan = generateDailyPlan({
        date: "2026-09-07",
        profiles: DEFAULT_PROFILES,
        preferences: parsed.preferences,
        seed,
        createdAt: "2026-09-07T00:00:00.000Z",
      });

      const allFoodIds = plan.meals.flatMap((meal) =>
        meal.items.map((item) => item.foodId),
      );
      expect(allFoodIds, `seed=${seed} 的餐项包含番茄`).not.toContain("tomato");

      const selectedRecipes = plan.meals
        .map((meal) => RECIPES.find((recipe) => recipe.id === meal.recipeId))
        .filter((recipe): recipe is (typeof RECIPES)[number] => Boolean(recipe));
      for (const recipe of selectedRecipes) {
        expect(
          [recipe.mainProteinFoodId, ...recipe.vegetableFoodIds],
          `seed=${seed} 选中了含番茄菜谱 ${recipe.id}`,
        ).not.toContain("tomato");
      }
    }
  });

  it("排除番茄不会污染同句中对猪里脊的肯定偏好", () => {
    const parsed = parsePreferences(
      "不要番茄，想吃猪里脊",
      createEmptyPreferences(),
    );

    expect(parsed.preferences.excludedFoodIds).toContain("tomato");
    expect(parsed.preferences.excludedFoodIds).not.toContain("pork_tenderloin");
    expect(parsed.preferences.preferredFoodIds).toContain("pork_tenderloin");

    for (let seed = 0; seed < 64; seed += 1) {
      const plan = generateDailyPlan({
        date: "2026-09-07",
        profiles: DEFAULT_PROFILES,
        preferences: parsed.preferences,
        seed,
        createdAt: "2026-09-07T00:00:00.000Z",
      });
      const allFoodIds = plan.meals.flatMap((meal) =>
        meal.items.map((item) => item.foodId),
      );
      expect(allFoodIds, `seed=${seed} 的餐项包含番茄`).not.toContain("tomato");
      expect(
        plan.meals
          .filter((meal) => meal.type === "lunch" || meal.type === "dinner")
          .flatMap((meal) => meal.items)
          .some((item) => item.foodId === "pork_tenderloin"),
      ).toBe(true);
    }
  });

  it.each(["牛奶过敏", "乳制品不耐受"])(
    "明确牛奶安全声明后跨种子排除牛奶、酸奶和乳清：%s",
    (input) => {
      const parsed = parsePreferences(input, createEmptyPreferences());
      expect(parsed.preferences.allergens).toContain("milk");

      for (let seed = 0; seed < 128; seed += 1) {
        const generated = generateDailyPlan({
          date: "2026-09-07",
          profiles: DEFAULT_PROFILES,
          preferences: parsed.preferences,
          seed,
          createdAt: "2026-09-07T00:00:00.000Z",
        });
        const milkItems = generated.meals
          .flatMap((meal) => meal.items)
          .filter((item) => FOOD_BY_ID[item.foodId].allergens?.includes("milk"));
        expect(milkItems, `seed=${seed} 出现牛奶过敏原`).toEqual([]);
      }
    },
  );
});

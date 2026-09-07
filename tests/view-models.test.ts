import { describe, expect, it } from "vitest";

import {
  BREAKFAST_TEMPLATES,
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  RECIPES,
} from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import type { Allergen, FoodGroup } from "../miniprogram/domain/models";
import { createEmptyPreferences } from "../miniprogram/domain/preference-parser";
import {
  preferenceSummary,
  toMealViewModels,
} from "../miniprogram/presentation/view-models";

const HIDDEN_SAUCE_MESSAGE =
  "已按过敏原过滤记录隐藏调味建议，请自行核对配料表和交叉污染";

function planWithAllergens(allergens: Allergen[] = []) {
  return generateDailyPlan({
    date: "2026-09-07",
    profiles: DEFAULT_PROFILES,
    preferences: {
      ...DEFAULT_PREFERENCES,
      excludedFoodIds: [],
      preferredFoodIds: [],
      excludedFoodGroups: [],
      preferredCookingMethods: [],
      preferredFlavors: [],
      allergens,
    },
    seed: 42,
    createdAt: "2026-09-07T00:00:00.000Z",
  });
}

describe("preferenceSummary", () => {
  it("为全部食物分组和过敏原提供中文标签", () => {
    const groups: FoodGroup[] = [
      "poultry",
      "pork",
      "beef",
      "fish",
      "shellfish",
      "egg",
      "dairy",
      "soy",
      "supplement",
      "grain",
      "tuber",
      "vegetable"
    ];
    const allergens: Allergen[] = ["egg", "milk", "soy", "fish", "shellfish", "gluten"];
    const tags = preferenceSummary({
      ...createEmptyPreferences(),
      excludedFoodGroups: groups,
      allergens
    });

    expect(tags.filter((tag) => tag.kind === "exclude_group").map((tag) => tag.label)).toEqual([
      "不吃 禽肉",
      "不吃 猪肉",
      "不吃 牛肉",
      "不吃 鱼类",
      "不吃 虾贝类",
      "不吃 蛋类",
      "不吃 奶制品",
      "不吃 豆制品",
      "不吃 营养补剂",
      "不吃 谷物主食",
      "不吃 薯类主食",
      "不吃 蔬菜"
    ]);
    expect(tags.filter((tag) => tag.kind === "allergen").map((tag) => tag.label)).toEqual([
      "过敏原 蛋类",
      "过敏原 牛奶",
      "过敏原 大豆",
      "过敏原 鱼类",
      "过敏原 虾贝类",
      "过敏原 麸质"
    ]);
  });
});

describe("toMealViewModels allergen messaging", () => {
  it("shows the original sauce suggestion when no allergen is recorded", () => {
    const plan = planWithAllergens();
    const viewModels = toMealViewModels(plan);
    const saucedMeals = plan.meals.filter((meal) => meal.sauce);

    expect(saucedMeals.length).toBeGreaterThan(0);
    for (const meal of saucedMeals) {
      expect(viewModels.find((item) => item.id === meal.id)?.sauce).toBe(
        `调味建议：${meal.sauce}`,
      );
    }
  });

  it("uses the plan snapshot allergen record by default to hide every sauce", () => {
    const viewModels = toMealViewModels(planWithAllergens(["milk"]));
    const sauceMessages = viewModels
      .map((meal) => meal.sauce)
      .filter(Boolean);

    expect(sauceMessages.length).toBeGreaterThan(0);
    expect(new Set(sauceMessages)).toEqual(new Set([HIDDEN_SAUCE_MESSAGE]));
  });

  it("uses the current allergen record for an older snapshot", () => {
    const oldPlan = planWithAllergens();
    const viewModels = toMealViewModels(oldPlan, ["soy"]);
    const visibleText = viewModels
      .flatMap((meal) => [meal.tip, meal.sauce])
      .join(" ");

    expect(viewModels.some((meal) => meal.sauce === HIDDEN_SAUCE_MESSAGE)).toBe(
      true,
    );
    expect(visibleText).not.toMatch(/生抽|蚝油/);
  });

  it("keeps authored tips free of explicit soy sauce and oyster sauce advice", () => {
    const tips = [
      ...RECIPES.map((recipe) => recipe.tip),
      ...BREAKFAST_TEMPLATES.map((template) => template.tip),
    ];

    expect(tips.join(" ")).not.toMatch(/生抽|蚝油/);
  });
});

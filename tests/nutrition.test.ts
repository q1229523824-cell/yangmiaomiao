import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILES } from "../miniprogram/data/defaults";
import {
  addNutrition,
  calculateGoals,
  nutritionForGrams
} from "../miniprogram/domain/nutrition";
import type { Food } from "../miniprogram/domain/models";

describe("calculateGoals", () => {
  it("calculates the fictional female demo profile goals", () => {
    const goals = calculateGoals(DEFAULT_PROFILES[0]);
    expect(goals).toEqual({
      bmrKcal: 1345,
      tdeeKcal: 2085,
      caloriesKcal: 1668,
      proteinG: 120,
      carbsG: 189,
      fatG: 48
    });
  });

  it("calculates the fictional male demo profile goals", () => {
    const goals = calculateGoals(DEFAULT_PROFILES[1]);
    expect(goals).toEqual({
      bmrKcal: 1724,
      tdeeKcal: 2672,
      caloriesKcal: 2137,
      proteinG: 150,
      carbsG: 249,
      fatG: 60
    });
  });
});

describe("nutrition arithmetic", () => {
  const food: Food = {
    id: "test-food",
    name: "测试食物",
    category: "protein",
    nutritionPer100g: {
      caloriesKcal: 100,
      proteinG: 20,
      carbsG: 10,
      fatG: 5
    },
    weightState: "raw",
    groups: ["poultry"]
  };

  it("scales per-100g nutrition and adds values", () => {
    const first = nutritionForGrams(food, 150);
    const second = nutritionForGrams(food, 50);
    expect(addNutrition(first, second)).toEqual({
      caloriesKcal: 200,
      proteinG: 40,
      carbsG: 20,
      fatG: 10
    });
  });
});

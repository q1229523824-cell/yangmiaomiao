import { describe, expect, it } from "vitest";

import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  FOOD_BY_ID,
} from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import type { Allergen, Preferences } from "../miniprogram/domain/models";
import {
  createEmptyPreferences,
  parsePreferences,
} from "../miniprogram/domain/preference-parser";

const ALLERGENS: readonly Allergen[] = [
  "egg",
  "milk",
  "soy",
  "fish",
  "shellfish",
  "gluten",
];

const ALLERGEN_COMBINATIONS = Array.from(
  { length: 1 << ALLERGENS.length },
  (_, mask) => {
    const allergens = ALLERGENS.filter(
      (_, index) => (mask & (1 << index)) !== 0,
    );
    return {
      allergens,
      label: allergens.join("+") || "none",
    };
  },
);

function preferences(allergens: readonly Allergen[]): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    excludedFoodIds: [],
    preferredFoodIds: [],
    excludedFoodGroups: [],
    preferredCookingMethods: [],
    preferredFlavors: [],
    allergens: [...allergens],
  };
}

describe("allergen catalog coverage", () => {
  it.each(ALLERGEN_COMBINATIONS)(
    "generates without modeled allergen conflicts for $label across 32 seeds",
    ({ allergens }) => {
      for (let seed = 0; seed < 32; seed += 1) {
        const plan = generateDailyPlan({
          date: "2026-09-07",
          profiles: DEFAULT_PROFILES,
          preferences: preferences(allergens),
          seed,
          createdAt: "2026-09-07T00:00:00.000Z",
        });

        expect(plan.meals.some((meal) => meal.type === "breakfast")).toBe(true);
        for (const meal of plan.meals) {
          for (const item of meal.items) {
            const conflicts = (FOOD_BY_ID[item.foodId].allergens ?? []).filter(
              (allergen) => allergens.includes(allergen),
            );
            expect(
              conflicts,
              `seed=${seed}, allergens=${allergens.join(",") || "none"}, food=${item.foodId}`,
            ).toEqual([]);
          }
        }
      }
    },
  );

  it("describes an allergy as a filtering restriction rather than a safety guarantee", () => {
    const result = parsePreferences(
      "鸡蛋过敏",
      createEmptyPreferences(),
    );

    expect(result.preferences.allergens).toEqual(["egg"]);
    expect(result.reply).toContain("过敏原过滤限制");
    expect(result.reply).not.toContain("安全过敏原");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  FISH_FOOD_IDS,
  FOOD_BY_ID,
  RECIPES
} from "../miniprogram/data/catalog";
import {
  generateDailyPlan,
  MenuGenerationError,
  seedFromText
} from "../miniprogram/domain/menu-generator";
import type { Preferences, Profile } from "../miniprogram/domain/models";
import { validateDailyPlan } from "../miniprogram/domain/plan-validator";
import { buildShoppingList } from "../miniprogram/domain/shopping-list";

function preferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    ...DEFAULT_PREFERENCES,
    excludedFoodIds: [],
    preferredFoodIds: [],
    excludedFoodGroups: [],
    preferredCookingMethods: [],
    preferredFlavors: [],
    allergens: [],
    ...overrides
  };
}

function generate(overrides: Partial<Parameters<typeof generateDailyPlan>[0]> = {}) {
  return generateDailyPlan({
    date: "2026-09-07",
    profiles: DEFAULT_PROFILES,
    preferences: preferences(),
    seed: 42,
    createdAt: "2026-09-07T00:00:00.000Z",
    ...overrides
  });
}

function cloneProfile(profile: Profile): Profile {
  return {
    ...profile,
    goalSettings: { ...profile.goalSettings }
  };
}

function portionsFor(plan: ReturnType<typeof generateDailyPlan>, memberId: string): number[] {
  return plan.meals.flatMap((meal) =>
    meal.items.map((item) => item.portionsByMemberId[memberId] ?? 0)
  );
}

describe("generateDailyPlan", () => {
  it("generates one shared meal structure with a portion for every member", () => {
    const plan = generate();
    expect(validateDailyPlan(plan)).toEqual({ valid: true, errors: [] });
    expect(plan.meals.slice(0, 3).map((meal) => meal.type)).toEqual([
      "breakfast",
      "lunch",
      "dinner"
    ]);
    expect(plan.meals.length).toBeGreaterThanOrEqual(3);
    expect(plan.meals.length).toBeLessThanOrEqual(4);
    if (plan.meals[3]) expect(plan.meals[3].type).toBe("snack");

    for (const meal of plan.meals) {
      for (const item of meal.items) {
        expect(Object.keys(item.portionsByMemberId).sort()).toEqual(
          [...plan.memberIds].sort()
        );
      }
    }
  });

  it("does not promise unmodeled egg or potato in a visible recipe name", () => {
    for (const recipe of RECIPES) {
      const modeledFoodIds = [recipe.mainProteinFoodId, ...recipe.vegetableFoodIds];
      if (recipe.name.includes("蛋")) expect(modeledFoodIds).toContain("egg");
      if (recipe.name.includes("土豆")) expect(modeledFoodIds).toContain("potato_raw");
    }
  });

  it("is reproducible for the same seed", () => {
    const first = generate();
    const second = generate();
    expect(second).toEqual(first);
    expect(seedFromText("2026-09-07:0")).toBe(seedFromText("2026-09-07:0"));
  });

  it.each([
    ["身高", (profile: Profile) => ({ ...profile, heightCm: 200 })],
    ["体重", (profile: Profile) => ({ ...profile, weightKg: 88 })],
    ["年龄", (profile: Profile) => ({ ...profile, ageYears: 45 })],
    [
      "活动系数",
      (profile: Profile) => ({
        ...profile,
        goalSettings: { ...profile.goalSettings, activityFactor: 1.9 }
      })
    ],
    [
      "目标强度",
      (profile: Profile) => ({
        ...profile,
        goalSettings: { ...profile.goalSettings, calorieTargetRatio: 0.95 }
      })
    ]
  ])("重新生成时让%s变化真实影响目标和份量", (_label, updateProfile) => {
    const baselineProfile = cloneProfile(DEFAULT_PROFILES[0]);
    const changedProfile = updateProfile(cloneProfile(DEFAULT_PROFILES[0]));
    const baseline = generate({ profiles: [baselineProfile] });
    const changed = generate({ profiles: [changedProfile] });

    expect(changed.goalsByMemberId[changedProfile.id]).not.toEqual(
      baseline.goalsByMemberId[baselineProfile.id]
    );
    expect(portionsFor(changed, changedProfile.id)).not.toEqual(
      portionsFor(baseline, baselineProfile.id)
    );
    expect(validateDailyPlan(changed)).toEqual({ valid: true, errors: [] });
  });

  it("derives portions from the live profile instead of the legacy fixed multiplier", () => {
    const baselineProfile = cloneProfile(DEFAULT_PROFILES[0]);
    const changedLegacyMultiplier = {
      ...cloneProfile(DEFAULT_PROFILES[0]),
      portionMultiplier: 9
    };

    const baseline = generate({ profiles: [baselineProfile] });
    const changed = generate({ profiles: [changedLegacyMultiplier] });

    expect(portionsFor(changed, changedLegacyMultiplier.id)).toEqual(
      portionsFor(baseline, baselineProfile.id)
    );
  });

  it.each([
    [
      "过低且无法由日常模板接近的热量目标",
      {
        ...cloneProfile(DEFAULT_PROFILES[0]),
        id: "minimum-profile",
        name: "最小边界",
        heightCm: 100,
        weightKg: 30,
        ageYears: 100
      }
    ],
    [
      "会产生极端单份食材的目标",
      {
        ...cloneProfile(DEFAULT_PROFILES[1]),
        id: "maximum-profile",
        name: "最大边界",
        heightCm: 230,
        weightKg: 300,
        ageYears: 16
      }
    ]
  ] satisfies ReadonlyArray<readonly [string, Profile]>) (
    "拒绝%s，而不是显示看似精确但不可用的份量",
    (_label, profile) => {
      const unexpectedlyAccepted: Array<{ seed: number; caloriesKcal: number }> = [];
      for (let seed = 0; seed < 128; seed += 1) {
        try {
          const plan = generate({ profiles: [profile], seed });
          unexpectedlyAccepted.push({
            seed,
            caloriesKcal: plan.nutritionByMemberId[profile.id].caloriesKcal
          });
        } catch (error) {
          expect(error).toBeInstanceOf(MenuGenerationError);
          expect(error).toMatchObject({ code: "UNSUPPORTED_GOAL" });
          expect((error as Error).message).toContain("请核对档案和目标设置");
        }
      }
      expect(unexpectedlyAccepted).toEqual([]);
    }
  );

  it("keeps varied ordinary adult profiles within practical single-item portions", () => {
    const profiles: Profile[] = [
      {
        ...cloneProfile(DEFAULT_PROFILES[0]),
        id: "smaller-adult",
        name: "小体型成人",
        heightCm: 145,
        weightKg: 42,
        ageYears: 70
      },
      {
        ...cloneProfile(DEFAULT_PROFILES[1]),
        id: "larger-adult",
        name: "大体型成人",
        heightCm: 195,
        weightKg: 120,
        ageYears: 30
      }
    ];

    for (let seed = 0; seed < 64; seed += 1) {
      const plan = generate({ profiles, seed });
      expect(validateDailyPlan(plan)).toEqual({ valid: true, errors: [] });
      for (const profile of profiles) {
        expect(
          portionsFor(plan, profile.id).every((grams) =>
            Number.isFinite(grams) && grams >= 0 && grams <= 700
          )
        ).toBe(true);
        for (const meal of plan.meals) {
          for (const item of meal.items) {
            if (item.role === "protein") {
              expect(item.portionsByMemberId[profile.id]).toBeLessThanOrEqual(500);
            }
            if (
              item.role === "carbohydrate" &&
              FOOD_BY_ID[item.foodId].weightState === "dry"
            ) {
              expect(item.portionsByMemberId[profile.id]).toBeLessThanOrEqual(300);
            }
          }
        }
      }
    }
  });

  it("rejects an in-scale target when meeting it would still require an oversized protein serving", () => {
    const profile: Profile = {
      ...cloneProfile(DEFAULT_PROFILES[0]),
      id: "oversized-protein",
      name: "高蛋白边界",
      heightCm: 160,
      weightKg: 180,
      ageYears: 60,
      goalSettings: {
        ...DEFAULT_PROFILES[0].goalSettings,
        activityFactor: 1.2,
        calorieTargetRatio: 0.75
      }
    };

    expect(() => generate({ profiles: [profile] })).toThrowError(
      /蛋白|鸡|猪|牛|鱼|虾|达到/
    );
    try {
      generate({ profiles: [profile] });
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_GOAL" });
      expect((error as Error).message).toContain("达到");
    }
  });

  it.each([
    ["身高", { heightCm: 99 }],
    ["体重", { weightKg: 301 }],
    ["年龄", { ageYears: 101 }]
  ])("rejects an invalid %s before generating a plan", (_label, values) => {
    const invalidProfile = { ...cloneProfile(DEFAULT_PROFILES[0]), ...values };

    expect(() => generate({ profiles: [invalidProfile] })).toThrowError(MenuGenerationError);
    try {
      generate({ profiles: [invalidProfile] });
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_PROFILE" });
    }
  });

  it("keeps fish out when the fish group is excluded", () => {
    const plan = generate({
      preferences: preferences({ excludedFoodGroups: ["fish"] })
    });
    const ids = plan.meals.flatMap((meal) => meal.items.map((item) => item.foodId));
    expect(ids.some((id) => FISH_FOOD_IDS.includes(id))).toBe(false);
  });

  it("applies preferred foods to breakfast, main carbohydrates and recipe vegetables", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const oatsPlan = generate({
        seed,
        preferences: preferences({ preferredFoodIds: ["oats_dry"] })
      });
      expect(
        oatsPlan.meals
          .find((meal) => meal.type === "breakfast")
          ?.items.some((item) => item.foodId === "oats_dry")
      ).toBe(true);

      const potatoPlan = generate({
        seed,
        preferences: preferences({ preferredFoodIds: ["potato_raw"] })
      });
      expect(
        potatoPlan.meals
          .filter((meal) => meal.type === "lunch" || meal.type === "dinner")
          .every((meal) =>
            meal.items.some(
              (item) => item.role === "carbohydrate" && item.foodId === "potato_raw"
            )
          )
      ).toBe(true);

      const tomatoPlan = generate({
        seed,
        preferences: preferences({ preferredFoodIds: ["tomato"] })
      });
      expect(
        tomatoPlan.meals
          .filter((meal) => meal.type === "lunch" || meal.type === "dinner")
          .every((meal) => meal.items.some((item) => item.foodId === "tomato"))
      ).toBe(true);
    }
  });

  it("keeps a hard exclusion above a conflicting soft preference", () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const plan = generate({
        seed,
        preferences: preferences({
          excludedFoodIds: ["tomato"],
          preferredFoodIds: ["tomato"]
        })
      });
      expect(
        plan.meals.flatMap((meal) => meal.items).some((item) => item.foodId === "tomato")
      ).toBe(false);
    }
  });

  it("never adds whey when it is disabled", () => {
    const plan = generate({ preferences: preferences({ avoidWhey: true }) });
    expect(
      plan.meals.flatMap((meal) => meal.items).some((item) => item.foodId === "whey_protein")
    ).toBe(false);
  });

  it("omits the optional snack instead of creating an empty meal when milk is forbidden", () => {
    const plan = generate({
      preferences: preferences({ avoidWhey: true, allergens: ["milk"] })
    });

    expect(plan.meals.find((meal) => meal.type === "snack")).toBeUndefined();
    expect(
      plan.meals.flatMap((meal) => meal.items).some((item) =>
        FOOD_BY_ID[item.foodId].allergens?.includes("milk")
      )
    ).toBe(false);
    expect(validateDailyPlan(plan)).toEqual({ valid: true, errors: [] });
  });

  it("does not add a protein snack when the meals already meet the member target", () => {
    const profile = cloneProfile(DEFAULT_PROFILES[0]);
    profile.goalSettings.proteinGPerKg = 0.5;
    const plan = generate({ profiles: [profile] });

    expect(plan.meals.find((meal) => meal.type === "snack")).toBeUndefined();
    expect(validateDailyPlan(plan)).toEqual({ valid: true, errors: [] });
  });

  it("fails explicitly instead of silently violating impossible exclusions", () => {
    expect(() =>
      generate({
        preferences: preferences({
          excludedFoodIds: [
            "chicken_thigh_skinless",
            "chicken_breast",
            "pork_tenderloin",
            "beef_tenderloin",
            "shrimp",
            "sea_bass",
            "cod",
            "salmon",
            "basa_fish",
            "beef_shank"
          ]
        })
      })
    ).toThrowError(MenuGenerationError);
  });

  it("derives the shopping list from the immutable plan snapshot", () => {
    const plan = generate();
    const shopping = buildShoppingList(plan);
    for (const shoppingItem of shopping) {
      const expected = plan.meals
        .flatMap((meal) => meal.items)
        .filter((item) => item.foodId === shoppingItem.foodId)
        .reduce(
          (sum, item) =>
            sum +
            plan.memberIds.reduce(
              (memberSum, memberId) =>
                memberSum + (item.portionsByMemberId[memberId] ?? 0),
              0
            ),
          0
        );
      expect(shoppingItem.totalGrams).toBe(expected);
      expect(FOOD_BY_ID[shoppingItem.foodId]).toBeDefined();
    }
  });
});

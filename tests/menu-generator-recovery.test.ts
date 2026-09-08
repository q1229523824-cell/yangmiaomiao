import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  FOOD_BY_ID
} from "../miniprogram/data/catalog";
import {
  generateDailyPlan,
  MAX_PLAN_GENERATION_ATTEMPTS,
  seedFromText
} from "../miniprogram/domain/menu-generator";
import type { DailyPlan, Profile } from "../miniprogram/domain/models";
import * as planValidator from "../miniprogram/domain/plan-validator";
import {
  ACTIVITY_OPTIONS,
  TARGET_OPTIONS
} from "../miniprogram/pages/profile/profile-form";

const DATE = "2026-09-08";
const CREATED_AT = "2026-09-08T00:00:00.000Z";

function profile(values: Partial<Profile>): Profile {
  return {
    ...DEFAULT_PROFILES[1],
    ...values,
    goalSettings: {
      ...DEFAULT_PROFILES[1].goalSettings,
      activityFactor: 1.725,
      calorieTargetRatio: 1,
      ...values.goalSettings
    }
  };
}

function verifyPortionLimits(plan: DailyPlan): void {
  expect(planValidator.validateDailyPlan(plan)).toEqual({ valid: true, errors: [] });
  for (const meal of plan.meals) {
    for (const item of meal.items) {
      const limit = item.role === "protein" ? 500 :
        item.role === "carbohydrate" && FOOD_BY_ID[item.foodId].weightState === "dry"
          ? 300 : 700;
      for (const grams of Object.values(item.portionsByMemberId)) {
        expect(grams).toBeGreaterThanOrEqual(0);
        expect(grams).toBeLessThanOrEqual(limit);
      }
    }
  }
}

afterEach(() => vi.restoreAllMocks());

describe("bounded deterministic combination recovery", () => {
  it("recovers the exact potato-705g regression while preserving the request seed", () => {
    const input = {
      date: DATE,
      createdAt: CREATED_AT,
      profiles: [profile({ heightCm: 180, weightKg: 60, ageYears: 25 })],
      preferences: DEFAULT_PREFERENCES,
      seed: seedFromText(`${DATE}:14`)
    };
    expect(input.seed).toBe(465688859);
    const plan = generateDailyPlan(input);
    expect(plan.seed).toBe(input.seed);
    expect(plan.id).toBe(`plan-${DATE}-${input.seed}`);
    expect(generateDailyPlan(input)).toEqual(plan);
    verifyPortionLimits(plan);
  });

  it("covers six adult profiles, all 20 UI activity/target pairs and 32 counters", () => {
    const adults = [
      profile({ gender: "female", heightCm: 155, weightKg: 50, ageYears: 35 }),
      profile({ gender: "female", heightCm: 165, weightKg: 60, ageYears: 25 }),
      profile({ gender: "female", heightCm: 170, weightKg: 85, ageYears: 45 }),
      profile({ heightCm: 180, weightKg: 60, ageYears: 25 }),
      profile({ heightCm: 175, weightKg: 75, ageYears: 40 }),
      profile({ heightCm: 195, weightKg: 120, ageYears: 30 })
    ];
    let verified = 0;
    for (const adult of adults) {
      for (const activity of ACTIVITY_OPTIONS) {
        for (const target of TARGET_OPTIONS) {
          const configured = profile({
            ...adult,
            goalSettings: {
              ...adult.goalSettings,
              activityFactor: activity.value,
              calorieTargetRatio: target.value
            }
          });
          for (let counter = 1; counter <= 32; counter += 1) {
            const plan = generateDailyPlan({
              date: DATE,
              createdAt: CREATED_AT,
              profiles: [configured],
              preferences: DEFAULT_PREFERENCES,
              seed: seedFromText(`${DATE}:${counter}`)
            });
            verifyPortionLimits(plan);
            verified += 1;
          }
        }
      }
    }
    expect(verified).toBe(3840);
  });

  it("keeps exclusions and allergens hard throughout alternate draws", () => {
    for (let counter = 1; counter <= 64; counter += 1) {
      const plan = generateDailyPlan({
        date: DATE,
        createdAt: CREATED_AT,
        profiles: [profile({ heightCm: 180, weightKg: 60, ageYears: 25 })],
        preferences: {
          ...DEFAULT_PREFERENCES,
          excludedFoodIds: ["tomato"],
          preferredFoodIds: ["tomato"],
          excludedFoodGroups: ["fish"],
          allergens: ["milk"],
          avoidWhey: true
        },
        seed: seedFromText(`${DATE}:${counter}`)
      });
      verifyPortionLimits(plan);
      expect(plan.meals.flatMap((meal) => meal.items).some((item) =>
        item.foodId === "tomato" || FOOD_BY_ID[item.foodId].groups.includes("fish") ||
        FOOD_BY_ID[item.foodId].allergens?.includes("milk")
      )).toBe(false);
    }
  });

  it("does not retry structural validation failures or unexpected errors", () => {
    const validation = vi.spyOn(planValidator, "validateDailyPlan");
    const input = {
      date: DATE,
      profiles: DEFAULT_PROFILES,
      preferences: DEFAULT_PREFERENCES,
      seed: 42
    };
    validation.mockReturnValue({ valid: false, errors: ["菜单结构损坏"] });
    expect(() => generateDailyPlan(input)).toThrowError("菜单结构损坏");
    expect(validation).toHaveBeenCalledTimes(1);
    validation.mockClear();
    const unexpected = new Error("unexpected catalog failure");
    validation.mockImplementation(() => { throw unexpected; });
    expect(() => generateDailyPlan(input)).toThrow(unexpected);
    expect(validation).toHaveBeenCalledTimes(1);
  });

  it("stops after the declared candidate budget when no practical portion can meet the goal", () => {
    const validation = vi.spyOn(planValidator, "validateDailyPlan");
    const impossible = profile({
      ...DEFAULT_PROFILES[0],
      heightCm: 160,
      weightKg: 180,
      ageYears: 60,
      goalSettings: {
        ...DEFAULT_PROFILES[0].goalSettings,
        activityFactor: 1.2,
        calorieTargetRatio: 0.75
      }
    });
    expect(() => generateDailyPlan({
      date: DATE,
      profiles: [impossible],
      preferences: DEFAULT_PREFERENCES,
      seed: 42
    })).toThrowError(`已尝试 ${MAX_PLAN_GENERATION_ATTEMPTS} 个`);
    expect(validation).toHaveBeenCalledTimes(MAX_PLAN_GENERATION_ATTEMPTS);
  });
});

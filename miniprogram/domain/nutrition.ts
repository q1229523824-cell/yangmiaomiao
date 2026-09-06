import type { Food, Goals, Nutrition, Profile } from "./models";

export const ZERO_NUTRITION: Nutrition = {
  caloriesKcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0
};

export function calculateGoals(profile: Profile): Goals {
  const sexConstant = profile.gender === "female" ? -161 : 5;
  const bmrKcal =
    10 * profile.weightKg +
    6.25 * profile.heightCm -
    5 * profile.ageYears +
    sexConstant;
  const tdeeKcal = bmrKcal * profile.goalSettings.activityFactor;
  const caloriesKcal = Math.round(
    tdeeKcal * profile.goalSettings.calorieTargetRatio
  );
  const proteinG = Math.round(
    profile.weightKg * profile.goalSettings.proteinGPerKg
  );
  const fatG = Math.round(profile.weightKg * profile.goalSettings.fatGPerKg);
  const carbsG = Math.max(
    0,
    Math.round((caloriesKcal - proteinG * 4 - fatG * 9) / 4)
  );

  return {
    bmrKcal: Math.round(bmrKcal),
    tdeeKcal: Math.round(tdeeKcal),
    caloriesKcal,
    proteinG,
    carbsG,
    fatG
  };
}

export function nutritionForGrams(food: Food, grams: number): Nutrition {
  const factor = grams / 100;
  return {
    caloriesKcal: food.nutritionPer100g.caloriesKcal * factor,
    proteinG: food.nutritionPer100g.proteinG * factor,
    carbsG: food.nutritionPer100g.carbsG * factor,
    fatG: food.nutritionPer100g.fatG * factor
  };
}

export function addNutrition(...values: Nutrition[]): Nutrition {
  return values.reduce<Nutrition>(
    (total, value) => ({
      caloriesKcal: total.caloriesKcal + value.caloriesKcal,
      proteinG: total.proteinG + value.proteinG,
      carbsG: total.carbsG + value.carbsG,
      fatG: total.fatG + value.fatG
    }),
    { ...ZERO_NUTRITION }
  );
}

export function roundNutrition(value: Nutrition): Nutrition {
  return {
    caloriesKcal: Math.round(value.caloriesKcal),
    proteinG: Math.round(value.proteinG),
    carbsG: Math.round(value.carbsG),
    fatG: Math.round(value.fatG)
  };
}

export function roundToFive(value: number, minimum = 0): number {
  return Math.max(minimum, Math.round(value / 5) * 5);
}

import { DEFAULT_PROFILES } from "../miniprogram/data/catalog";
import { TAKEOUT_TEMPLATES } from "../miniprogram/data/takeout-catalog";
import { estimateTakeoutNutrition, getTakeoutRecommendations } from "../miniprogram/domain/takeout";
import { createEmptyPreferences } from "../miniprogram/domain/preference-parser";

console.table(TAKEOUT_TEMPLATES.map(template => {
  const {min, max} = estimateTakeoutNutrition(template);
  return {name: template.name, kcal: `${min.caloriesKcal}-${max.caloriesKcal}`,
    protein: `${min.proteinG}-${max.proteinG}`, carbs: `${min.carbsG}-${max.carbsG}`, fat: `${min.fatG}-${max.fatG}`};
}));
for (const profile of DEFAULT_PROFILES) for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
  const result = getTakeoutRecommendations({profile, mealType, preferences: createEmptyPreferences()});
  console.log(profile.name, mealType, result.targets, result.matches.map(item => item.template.name));
}

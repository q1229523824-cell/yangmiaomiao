import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES,
  FOOD_BY_ID
} from "../miniprogram/data/catalog";
import { generateDailyPlan, seedFromText } from "../miniprogram/domain/menu-generator";
import { buildShoppingList } from "../miniprogram/domain/shopping-list";

const date = "2026-09-07";
const plan = generateDailyPlan({
  date,
  profiles: DEFAULT_PROFILES,
  preferences: DEFAULT_PREFERENCES,
  seed: seedFromText(`${date}:demo`),
  createdAt: "2026-09-07T00:00:00.000Z"
});

const output = {
  planId: plan.id,
  meals: plan.meals.map((meal) => ({
    type: meal.type,
    name: meal.name,
    ingredients: meal.items.map((item) => ({
      food: FOOD_BY_ID[item.foodId].name,
      portions: item.portionsByMemberId
    }))
  })),
  nutritionByMemberId: plan.nutritionByMemberId,
  shopping: buildShoppingList(plan).map((item) => ({
    food: FOOD_BY_ID[item.foodId].name,
    totalGrams: item.totalGrams
  }))
};

console.log(JSON.stringify(output, null, 2));

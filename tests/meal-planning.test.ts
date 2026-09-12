import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAppState, appendPlanToHistory, isAppState, migrateAppState, type AppState } from "../miniprogram/repositories/app-state";
import { ensureInitialPlan, regeneratePlan, preparePreferencePlanChange } from "../miniprogram/services/plan-service";
import { selectPlanDate, setMealDining } from "../miniprogram/services/meal-planning-service";
import { diningChoice, plannedNutrition, usableTakeout } from "../miniprogram/domain/meal-planning";
import { getTakeoutRecommendations } from "../miniprogram/domain/takeout";
import { buildShoppingList } from "../miniprogram/domain/shopping-list";
import { addNutrition, nutritionForGrams, roundNutrition } from "../miniprogram/domain/nutrition";
import { FOOD_BY_ID } from "../miniprogram/data/catalog";
import { parsePreferences } from "../miniprogram/domain/preference-parser";
import { parseLocalBackup, serializeLocalBackup } from "../miniprogram/services/local-backup";
import { restorePlanFromHistory } from "../miniprogram/services/history-service";
import { toPlannedMeals } from "../miniprogram/presentation/meal-planning-view-models";

beforeEach(() => { vi.useFakeTimers({toFake: ["Date"]}); vi.setSystemTime(new Date("2026-09-12T04:00:00Z")); });
afterEach(() => vi.useRealTimers());
function initial(): AppState { return ensureInitialPlan(createDefaultAppState(), {date: "2026-09-12"}).state; }
function choose(state: AppState, mealType: "breakfast" | "lunch" | "dinner", index = 0): AppState {
  const profile = state.profiles[index];
  const result = getTakeoutRecommendations({profile, mealType, preferences: state.preferences});
  expect(result.matches.length).toBeGreaterThan(0);
  return setMealDining(state, state.currentPlan!.id, mealType, profile.id, "takeout", result.matches[0].template.id);
}

describe("三餐统一计划", () => {
  it("offers breakfast-specific matches for both demo members without mixing lunch choices", () => {
    for (const profile of initial().profiles) {
      const result = getTakeoutRecommendations({profile, preferences: initial().preferences, mealType: "breakfast"});
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.targets.mealRatio).toBe(.25);
      expect([...result.matches, ...result.alternatives].every(item => item.template.category === "breakfast")).toBe(true);
      expect(result.matches.every(item => item.nutrition.max.caloriesKcal <= result.targets.maxCaloriesKcal && item.nutrition.min.proteinG >= result.targets.minProteinG)).toBe(true);
    }
  });
  it("stores each person's breakfast, lunch and dinner choices on a single daily plan", () => {
    let state = initial();
    const original = structuredClone(state.currentPlan!);
    for (const meal of ["breakfast", "lunch", "dinner"] as const) state = choose(state, meal);
    const plan = state.currentPlan!;
    for (const type of ["breakfast", "lunch", "dinner"]) {
      const meal = plan.meals.find(item => item.type === type)!;
      expect(diningChoice(meal, plan.memberIds[0]).takeout?.name).toBeTruthy();
      expect(diningChoice(meal, plan.memberIds[1]).source).toBe("home");
      expect(meal.items).toEqual(original.meals.find(item => item.type === type)!.items);
    }
    expect(isAppState(state)).toBe(true);
    expect(state.takeout.selections).toEqual([]);
  });
  it("removes only the takeout member's meal portions from shopping and adds their estimate once", () => {
    const original = initial();
    const state = choose(original, "lunch");
    const plan = state.currentPlan!, id = plan.memberIds[0];
    const expectedPlan = structuredClone(original.currentPlan!);
    const lunch = expectedPlan.meals.find(item => item.type === "lunch")!;
    lunch.items.forEach(item => { item.portionsByMemberId[id] = 0; });
    expect(buildShoppingList(plan)).toEqual(buildShoppingList(expectedPlan));
    const homeNutrition = addNutrition(...expectedPlan.meals.flatMap(meal => meal.items.map(item => nutritionForGrams(FOOD_BY_ID[item.foodId], item.portionsByMemberId[id]))));
    const selected = plan.meals.find(item => item.type === "lunch")!.diningByMemberId![id].takeout!;
    const total = plannedNutrition(plan, id);
    expect(total.min).toEqual(roundNutrition(addNutrition(homeNutrition, selected.nutrition.min)));
    expect(total.max).toEqual(roundNutrition(addNutrition(homeNutrition, selected.nutrition.max)));
    expect(total.pendingMeals).toBe(0);
  });
  it("switching back to cooking recovers the exact recipe/portions and retains the chosen takeout option", () => {
    const original = initial(); let state = choose(original, "breakfast");
    const id = state.profiles[0].id;
    const saved = state.currentPlan!.meals[0].diningByMemberId![id].takeout;
    state = setMealDining(state, state.currentPlan!.id, "breakfast", id, "home");
    expect(buildShoppingList(state.currentPlan!)).toEqual(buildShoppingList(original.currentPlan!));
    state = setMealDining(state, state.currentPlan!.id, "breakfast", id, "takeout");
    expect(state.currentPlan!.meals[0].diningByMemberId![id].takeout).toEqual(saved);
  });
  it("allows an unfinished takeout meal but labels partial nutrition and never shows old cooking as selected", () => {
    let state = initial(); const id = state.profiles[0].id;
    state = setMealDining(state, state.currentPlan!.id, "breakfast", id, "takeout");
    expect(plannedNutrition(state.currentPlan!, id).pendingMeals).toBe(1);
    const card = toPlannedMeals(state, id)[0];
    expect(card.pending).toBe(true); expect(card.selectedTakeout).toBeNull();
    expect(card.householdSummary).toContain("外卖待选");
  });
  it("date switches restore existing arrangements without new seeds, replacements, or restoring old exclusions", () => {
    let state = choose(initial(), "lunch"); const today = structuredClone(state.currentPlan!);
    state = selectPlanDate(state, "2026-09-13"); state = choose(state, "breakfast");
    const tomorrow = structuredClone(state.currentPlan!), counter = state.generationCounter;
    state = selectPlanDate(state, "2026-09-12"); expect(state.currentPlan).toEqual(today);
    state = selectPlanDate(state, "2026-09-13"); expect(state.currentPlan).toEqual(tomorrow);
    expect(state.generationCounter).toBe(counter);
    expect(selectPlanDate(state, "2026-09-13")).toBe(state);
    expect(() => selectPlanDate(state, "2026-02-30")).toThrow("有效");
  });
  it("keeps an explicitly restored older arrangement when leaving and returning to its date", () => {
    let state = choose(selectPlanDate(initial(), "2026-09-14"), "lunch");
    const restoredChoice = state.currentPlan!;
    state = setMealDining(state, restoredChoice.id, "lunch", state.profiles[0].id, "home");
    const newer = state.currentPlan!;
    state = restorePlanFromHistory(state, restoredChoice.id);
    const counter = state.generationCounter;
    state = selectPlanDate(state, "2026-09-12");
    state = selectPlanDate(state, "2026-09-14");
    expect(state.currentPlan).toEqual(restoredChoice);
    expect(state.history.some(item => item.id === newer.id)).toBe(true);
    expect(state.generationCounter).toBe(counter);
  });
  it("changing only cooking recipes keeps the selected date and all takeout choices", () => {
    let state = selectPlanDate(initial(), "2026-09-14"); state = choose(state, "dinner", 1);
    const selected = state.currentPlan!.meals.find(item => item.type === "dinner")!.diningByMemberId;
    const result = regeneratePlan(state, {date: "2026-09-14"});
    expect(result.currentPlan!.meals.find(item => item.type === "dinner")!.diningByMemberId).toEqual(selected);
    expect(result.currentPlan!.date).toBe("2026-09-14");
  });
  it("protects the latest upcoming-day arrangements from 70 edits on another day", () => {
    let state = selectPlanDate(initial(), "2026-09-14"); state = choose(state, "lunch");
    const future = structuredClone(state.currentPlan!);
    state = selectPlanDate(state, "2026-09-12");
    for (let i = 0; i < 70; i++) state = regeneratePlan(state, {date: "2026-09-12"});
    expect(state.history.length).toBe(60);
    state = selectPlanDate(state, "2026-09-14");
    expect(state.currentPlan).toEqual(future);
  });
  it("rechecks changed exclusions for future plans without silently choosing a different meal", () => {
    let state = choose(initial(), "lunch");
    const original = state.currentPlan!.meals.find(item => item.type === "lunch")!.diningByMemberId;
    const preferences = parsePreferences("不要番茄", state.preferences).preferences;
    state = preparePreferencePlanChange(state, preferences, {date: "2026-09-12"}).state;
    const view = toPlannedMeals(state, state.profiles[0].id).find(item => item.type === "lunch")!;
    expect(view.selectedTakeout).toBeNull(); expect(view.pending).toBe(true);
    expect(state.currentPlan!.meals.find(item => item.type === "lunch")!.diningByMemberId).toEqual(original);
    expect(view.choices.some(item => item.id.startsWith("shaxian"))).toBe(false);
    expect(plannedNutrition(state.currentPlan!, state.profiles[0].id, preferences).pendingMeals).toBe(1);
  });
  it("rejects stale clicks, invalid members, mismatched breakfast templates and excluded items", () => {
    const state = initial(), plan = state.currentPlan!, id = state.profiles[0].id;
    expect(() => setMealDining(state, "previous-plan", "lunch", id, "takeout")).toThrow("已变化");
    expect(() => setMealDining(state, plan.id, "lunch", "unknown", "takeout")).toThrow("有效");
    expect(() => setMealDining(state, plan.id, "breakfast", id, "takeout", "shaxian_chicken_rice_small")).toThrow("不满足");
    state.preferences.allergens = ["milk"];
    expect(() => setMealDining(state, plan.id, "lunch", id, "takeout", "shaxian_chicken_rice_small")).toThrow("不满足");
  });
  it("round-trips mixed future plans and favorites through the backup", () => {
    let state = choose(initial(), "breakfast"); state = selectPlanDate(state, "2026-09-13"); state = choose(state, "dinner", 1);
    state.takeout.favoriteTemplateIds = ["breakfast_yogurt_oats_egg"];
    expect(parseLocalBackup(serializeLocalBackup(state))).toEqual(state);
  });
  it("migrates v3 without turning old reference-only selections into meals", () => {
    const state = initial();
    state.takeout.favoriteTemplateIds = ["shaxian_chicken_rice_small"];
    state.takeout.selections = [{date: "2026-09-12", memberId: state.profiles[0].id, mealType: "lunch", templateId: "shaxian_chicken_rice_small"}];
    const migrated = migrateAppState(state, 3)!;
    expect(migrated).toEqual(state);
    expect(diningChoice(migrated.currentPlan!.meals[1], state.profiles[0].id).source).toBe("home");
  });
  it("does not restore a takeout snapshot across a newly declared allergy", () => {
    let state = choose(initial(), "breakfast"); const id = state.currentPlan!.id;
    state.preferences.allergens = ["milk"];
    expect(() => restorePlanFromHistory(state, id)).toThrow("不能恢复");
  });
  it("validates new meal data including unknown members and non-finite ranges", () => {
    const state = choose(initial(), "breakfast");
    const id = state.profiles[0].id;
    for (const change of [
      (value: AppState) => { value.currentPlan!.meals[0].diningByMemberId![id].source = "bad" as "home"; },
      (value: AppState) => { value.currentPlan!.meals[0].diningByMemberId!.unknown = {source: "takeout"}; },
      (value: AppState) => { value.currentPlan!.meals[0].diningByMemberId![id].takeout!.nutrition.min.caloriesKcal = -1; },
      (value: AppState) => { value.currentPlan!.meals[0].diningByMemberId![id].takeout!.nutrition.max.caloriesKcal = NaN; },
    ]) {
      const bad = structuredClone(state); change(bad); expect(isAppState(bad)).toBe(false);
    }
  });
  it("keeps 60 full mixed-meal snapshots below the single-key storage budget", () => {
    let state = initial();
    for (const meal of ["breakfast", "lunch", "dinner"] as const) for (const member of [0, 1]) state = choose(state, meal, member);
    const plan = state.currentPlan!;
    for (let i = 0; i < 60; i++) state = appendPlanToHistory(state, {...plan, id: `full-${i}`});
    expect(state.history).toHaveLength(60);
    expect(Buffer.byteLength(JSON.stringify(state), "utf8")).toBeLessThan(950_000);
    expect(isAppState(state)).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMiniProgramRuntime, type MiniProgramRuntime, type RuntimePage } from "./helpers/miniprogram-runtime";
import type { AppState } from "../miniprogram/repositories/app-state";
import { namespacedKey, CURRENT_SCHEMA_VERSION } from "../miniprogram/repositories/storage";
import { toPlannedMeals } from "../miniprogram/presentation/meal-planning-view-models";
import { buildShoppingList } from "../miniprogram/domain/shopping-list";

interface PlanningPage extends RuntimePage {
  data: RuntimePage["data"] & {selectedDate: string; planningMemberId: string; meals: ReturnType<typeof toPlannedMeals>; errorMessage: string; busy: boolean};
  onShow(): Promise<void>; onPlanDateChange(event: unknown): Promise<void>;
  onDiningSourceTap(event: unknown): Promise<void>; onPlannedTakeoutTap(event: unknown): Promise<void>;
  onPlanningMemberTap(event: unknown): void; onGenerateTap(): Promise<void>;
  onCopyPlannedOrder(event: unknown): Promise<void>; applyPreference(text: string): Promise<void>;
}
const key = namespacedKey("app-state");
const tap = (data: Record<string, string>) => ({currentTarget: {dataset: data}});
let runtime: MiniProgramRuntime;
const state = (): AppState => (runtime.storage.get(key) as {data: AppState}).data;
async function open(): Promise<PlanningPage> {
  await import("../miniprogram/pages/index/index");
  const page = runtime.createPage<PlanningPage>(); await page.onShow(); return page;
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers({toFake: ["Date"]}); vi.setSystemTime(new Date("2026-09-12T04:00:00Z"));
  runtime = installMiniProgramRuntime();
});
afterEach(() => { runtime.cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("首页提前排餐", () => {
  it("plans tomorrow inline, persists through reload and midnight, and recovers today's exact arrangement", async () => {
    let page = await open(); const today = structuredClone(state().currentPlan);
    await page.onPlanDateChange({detail: {value: "2026-09-13"}});
    await page.onDiningSourceTap(tap({meal: "breakfast", source: "takeout"}));
    const first = page.data.meals.find(item => item.type === "breakfast")!.choices[0];
    await page.onPlannedTakeoutTap(tap({meal: "breakfast", id: first.id}));
    const tomorrow = structuredClone(state().currentPlan);
    const envelope = structuredClone(runtime.storage.get(key));
    vi.setSystemTime(new Date("2026-09-13T04:00:00Z")); vi.resetModules(); page = await open();
    expect(page.data.selectedDate).toBe("2026-09-13");
    expect(page.data.meals[0].selectedTakeout?.name).toBe(first.name);
    expect(runtime.storage.get(key)).toEqual(envelope);
    await page.onPlanDateChange({detail: {value: "2026-09-12"}}); expect(state().currentPlan).toEqual(today);
    await page.onPlanDateChange({detail: {value: "2026-09-13"}}); expect(state().currentPlan).toEqual(tomorrow);
    expect(runtime.wx.navigateTo).not.toHaveBeenCalled();
  });
  it("updates shopping and nutrition when members choose different meal sources", async () => {
    const page = await open(); const original = structuredClone(state().currentPlan!);
    await page.onDiningSourceTap(tap({meal: "lunch", source: "takeout"}));
    expect(page.data.meals[1].pending).toBe(true);
    await page.onPlannedTakeoutTap(tap({meal: "lunch", id: page.data.meals[1].choices[0].id}));
    const items = buildShoppingList(state().currentPlan!);
    await import("../miniprogram/pages/shopping/shopping");
    const shopping = runtime.createPage<RuntimePage & {onShow(): Promise<void>}>(); await shopping.onShow();
    expect((shopping.data.items as Array<{foodId: string; gramsText: string}>).map(item => item.gramsText)).toEqual(items.map(item => `${item.totalGrams}g`));
    expect(items).not.toEqual(buildShoppingList(original));
    page.onPlanningMemberTap(tap({id: state().profiles[1].id})); expect(page.data.meals[1].source).toBe("home");
    page.onPlanningMemberTap(tap({id: state().profiles[0].id}));
    await page.onDiningSourceTap(tap({meal: "lunch", source: "home"}));
    await shopping.onShow();
    expect(buildShoppingList(state().currentPlan!)).toEqual(buildShoppingList(original));
  });
  it("does not redirect a future plan to today when changing preferences or cooking recipes", async () => {
    const page = await open(); await page.onPlanDateChange({detail: {value: "2026-09-18"}});
    await page.onDiningSourceTap(tap({meal: "breakfast", source: "takeout"}));
    const first = page.data.meals[0].choices[0];
    await page.onPlannedTakeoutTap(tap({meal: "breakfast", id: first.id}));
    await page.applyPreference("不要番茄");
    await page.onGenerateTap();
    expect(page.data.selectedDate).toBe("2026-09-18");
    expect(page.data.meals[0].selectedTakeout?.name).toBe(first.name);
  });
  it("recovers from failed selection and date writes, showing only persisted choices", async () => {
    const page = await open(); const before = structuredClone(state());
    runtime.wx.setStorage.mockRejectedValueOnce(new Error("disk full"));
    await page.onPlanDateChange({detail: {value: "2026-09-13"}});
    expect(page.data.selectedDate).toBe("2026-09-12"); expect(page.data.errorMessage).toContain("disk full");
    expect(state()).toEqual(before);
    runtime.wx.setStorage.mockRejectedValueOnce(new Error("save failed"));
    await page.onPlannedTakeoutTap(tap({meal: "breakfast", id: page.data.meals[0].choices[0].id}));
    expect(page.data.meals[0].source).toBe("home"); expect(state()).toEqual(before);
    await page.onPlannedTakeoutTap(tap({meal: "breakfast", id: page.data.meals[0].choices[0].id}));
    expect(page.data.meals[0].source).toBe("takeout"); expect(page.data.errorMessage).toBe("");
  });
  it("rechecks the latest preferences before saving or copying a visible takeout card", async () => {
    const page = await open(); const id = page.data.meals[1].choices[0].id;
    await page.onPlannedTakeoutTap(tap({meal: "lunch", id}));
    await page.applyPreference("不要番茄");
    expect(page.data.meals[1].selectedTakeout).toBeNull();
    const before = structuredClone(state());
    await page.onCopyPlannedOrder(tap({meal: "lunch", kind: "order"}));
    expect(runtime.wx.setClipboardData).not.toHaveBeenCalled();
    await page.onPlannedTakeoutTap(tap({meal: "lunch", id}));
    expect(state()).toEqual(before);
    const safeId = page.data.meals[1].choices[0].id;
    await page.onPlannedTakeoutTap(tap({meal: "lunch", id: safeId}));
    await page.onCopyPlannedOrder(tap({meal: "lunch", kind: "order"}));
    expect(runtime.wx.setClipboardData.mock.calls[0][0].data).toContain("不吃 番茄");
  });
  it("rejects a queued click after another page has switched the saved date", async () => {
    const page = await open(); const id = page.data.meals[0].choices[0].id;
    const {getAppStateRepository} = await import("../miniprogram/repositories/app-state");
    const {selectPlanDate} = await import("../miniprogram/services/meal-planning-service");
    await getAppStateRepository().update(latest => selectPlanDate(latest, "2026-09-14"));
    await page.onPlannedTakeoutTap(tap({meal: "breakfast", id}));
    expect(page.data.errorMessage).toContain("计划已变化");
    expect(state().currentPlan!.date).toBe("2026-09-14");
    expect(page.data.meals[0].source).toBe("home");
  });
  it("migrates real v3 storage once and retains corrupt new meal data for recovery", async () => {
    let page = await open(); const old = structuredClone(state());
    runtime.storage.set(key, {schemaVersion: 3, savedAt: new Date().toISOString(), data: old});
    vi.resetModules(); page = await open(); expect(state()).toEqual(old);
    expect((runtime.storage.get(key) as {schemaVersion: number}).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const bad = structuredClone(state()); bad.currentPlan!.meals[0].diningByMemberId = {unknown: {source: "home"}};
    const corrupt = {schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: new Date().toISOString(), data: bad};
    runtime.storage.set(key, corrupt); const writes = runtime.wx.setStorage.mock.calls.length;
    await page.onShow();
    expect(page.data.meals).toEqual([]); expect(page.data.errorMessage).not.toBe("");
    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(writes); expect(runtime.storage.get(key)).toEqual(corrupt);
  });
});

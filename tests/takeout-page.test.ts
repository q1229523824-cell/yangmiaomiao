import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAppState, type AppState } from "../miniprogram/repositories/app-state";
import { CURRENT_SCHEMA_VERSION, namespacedKey } from "../miniprogram/repositories/storage";
import { ensureInitialPlan } from "../miniprogram/services/plan-service";
import { installMiniProgramRuntime, type MiniProgramRuntime, type RuntimePage } from "./helpers/miniprogram-runtime";
import type { TakeoutCard } from "../miniprogram/pages/takeout/takeout";

interface TakeoutPage extends RuntimePage {
  data: RuntimePage["data"] & {matches: TakeoutCard[]; alternatives: TakeoutCard[]; errorMessage: string;
    blockedReason: string; filterError: string; hasSelection: boolean; selectedName: string; memberId: string;
    selectedNotice: string; maxCaloriesInput: string; mealType: string; busy: boolean;};
  onLoad(query: Record<string, string>): void; onShow(): Promise<void>;
  onSelectTap(event: unknown): Promise<void>; onFavoriteTap(event: unknown): Promise<void>;
  onClearSelection(): Promise<void>; onCopyOrder(event: unknown): Promise<void>;
  onCopyKeyword(event: unknown): Promise<void>; onMemberTap(event: unknown): void;
  onMealTap(event: unknown): void; onCaloriesInput(event: unknown): void;
  onProteinInput(event: unknown): void; onApplyTargets(): void; onResetTargets(): void;
  onCategoryTap(event: unknown): void; onToggleFavorites(): void;
}
let runtime: MiniProgramRuntime;
const key = namespacedKey("app-state");
const tap = (id: string) => ({currentTarget: {dataset: {id}}});
function seed(state = createDefaultAppState()) {
  runtime.storage.set(key, {schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: "2026-09-12T00:00:00.000Z", data: state});
}
function stored(): AppState { return (runtime.storage.get(key) as {data: AppState}).data; }
async function page(): Promise<TakeoutPage> {
  await import("../miniprogram/pages/takeout/takeout");
  const result = runtime.createPage<TakeoutPage>(); await result.onShow(); return result;
}
beforeEach(() => {vi.resetModules(); runtime = installMiniProgramRuntime();});
afterEach(() => {runtime.cleanup(); vi.restoreAllMocks(); vi.useRealTimers();});

describe("外卖页面离线交互", () => {
  it("opens with recommendations without generating or writing a self-cooked plan", async () => {
    const view = await page();
    expect(view.data.errorMessage).toBe(""); expect(view.data.matches.length).toBeGreaterThan(0);
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();
    const ids = view.data.matches.map(item => item.id); await view.onShow();
    expect(view.data.matches.map(item => item.id)).toEqual(ids);
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();
  });
  it("saves each member's meal and favorites, reopening retains them without mutating the plan", async () => {
    const initial = ensureInitialPlan(createDefaultAppState(), {date: "2026-09-12"}).state; seed(initial);
    const view = await page(); const first = view.data.matches[0];
    await view.onSelectTap(tap(first.id)); await view.onFavoriteTap(tap(first.id));
    expect(view.data.selectedName).toBe(first.name);
    expect(stored().currentPlan).toEqual(initial.currentPlan);
    expect(stored().history).toEqual(initial.history);
    expect(stored().checkedFoodIdsByPlanId).toEqual(initial.checkedFoodIdsByPlanId);
    view.onMemberTap(tap(initial.profiles[1].id));
    await view.onSelectTap(tap(view.data.matches[0].id));
    expect(stored().takeout.selections).toHaveLength(2);
    vi.resetModules(); const reopened = await page();
    expect(reopened.data.selectedName).toBe(first.name);
    expect(reopened.data.matches.find(item => item.id === first.id)?.isFavorite).toBe(true);
    const before = structuredClone(stored()); await reopened.onSelectTap(tap(first.id));
    expect(stored()).toEqual(before);
    await reopened.onClearSelection(); expect(stored().takeout.selections).toHaveLength(1);
  });
  it("changes targets for member/meal, resets explicit overrides, and hides unapplied input results", async () => {
    const view = await page(); const initial = view.data.maxCaloriesInput;
    view.onCaloriesInput({detail: {value: "800"}}); view.onProteinInput({detail: {value: "25"}});
    expect(view.data.matches).toEqual([]); view.onApplyTargets();
    expect(view.data.filterError).toBe(""); expect(view.data.maxCaloriesInput).toBe("800");
    view.onMealTap({currentTarget: {dataset: {meal: "dinner"}}});
    expect(view.data.mealType).toBe("dinner"); expect(view.data.maxCaloriesInput).not.toBe("800");
    view.onMealTap({currentTarget: {dataset: {meal: "lunch"}}});
    expect(view.data.maxCaloriesInput).toBe(initial);
  });
  it("rejects invalid constraints and doesn't save a stale card", async () => {
    const view = await page(); const id = view.data.matches[0].id;
    view.onCaloriesInput({detail: {value: ""}}); view.onApplyTargets();
    expect(view.data.filterError).toMatch(/填写/); expect(view.data.matches).toEqual([]);
    await view.onSelectTap(tap(id)); expect(runtime.wx.setStorage).not.toHaveBeenCalled();
    view.onCaloriesInput({detail: {value: "0"}}); view.onApplyTargets();
    expect(view.data.filterError).not.toBe("");
    view.onResetTargets(); expect(view.data.matches.length).toBeGreaterThan(0);
  });
  it("cannot save an alternative or arbitrary template through a stale event", async () => {
    const view = await page(); expect(view.data.alternatives.length).toBeGreaterThan(0);
    await view.onSelectTap(tap(view.data.alternatives[0].id));
    await view.onSelectTap(tap("nonexistent"));
    expect(runtime.wx.setStorage).not.toHaveBeenCalled(); expect(view.data.errorMessage).toContain("未保存");
  });
  it("rechecks allergies in the transaction and hides an old reference after changed preferences", async () => {
    seed(); const view = await page(); const first = view.data.matches[0];
    await view.onSelectTap(tap(first.id));
    const changed = structuredClone(stored()); changed.preferences.allergens = ["milk"]; seed(changed);
    const writes = runtime.wx.setStorage.mock.calls.length;
    await view.onSelectTap(tap(first.id));
    expect(runtime.wx.setStorage).toHaveBeenCalledTimes(writes);
    expect(view.data.matches).toEqual([]); expect(view.data.alternatives).toEqual([]);
    expect(view.data.blockedReason).not.toBe(""); expect(view.data.selectedName).not.toBe(first.name);
    expect(view.data.selectedNotice).toContain("不再适用");
    await view.onCopyOrder(tap(first.id)); expect(runtime.wx.setClipboardData).not.toHaveBeenCalled();
  });
  it("copies only order instructions including exclusions, never body data", async () => {
    const initial = createDefaultAppState(); initial.profiles[0].name = "私密称呼不应复制";
    initial.preferences.excludedFoodIds = ["tomato"]; seed(initial);
    const view = await page(); const first = view.data.matches[0];
    expect(runtime.wx.setClipboardData).not.toHaveBeenCalled();
    await view.onCopyOrder(tap(first.id));
    const text = runtime.wx.setClipboardData.mock.calls[0][0].data;
    expect(text).toContain(first.orderText); expect(text).toMatch(/番茄/);
    expect(text).not.toContain("私密称呼不应复制"); expect(text).not.toContain("heightCm");
    await view.onCopyKeyword(tap(first.id));
    expect(runtime.wx.setClipboardData.mock.calls[1][0].data).toBe(first.searchKeyword);
  });
  it("filters favorites and categories without writing preferences or replacing a selected reference", async () => {
    seed(); const view = await page(); const first = view.data.matches[0];
    await view.onFavoriteTap(tap(first.id)); await view.onSelectTap(tap(first.id));
    const before = structuredClone(stored());
    view.onToggleFavorites(); expect(view.data.matches.map(item => item.id)).toEqual([first.id]);
    view.onCategoryTap(tap("salad")); expect(view.data.selectedName).toBe(first.name);
    expect(stored()).toEqual(before);
  });
  it("surfaces write failure and can retry without claiming a saved selection", async () => {
    seed(); const before = structuredClone(stored()); const view = await page(); const id = view.data.matches[0].id;
    runtime.wx.setStorage.mockRejectedValueOnce(new Error("disk full"));
    await view.onSelectTap(tap(id)); expect(stored()).toEqual(before);
    expect(view.data.errorMessage).toContain("disk full"); expect(view.data.hasSelection).toBe(false);
    await view.onSelectTap(tap(id)); expect(view.data.hasSelection).toBe(true);
  });
  it("preserves corrupt storage and clears actionable cards", async () => {
    const corrupt = {schemaVersion: CURRENT_SCHEMA_VERSION, savedAt: "2026-09-12T00:00:00.000Z", data: "broken"};
    runtime.storage.set(key, corrupt); const view = await page();
    expect(view.data.errorMessage).not.toBe(""); expect(view.data.matches).toEqual([]);
    expect(runtime.storage.get(key)).toEqual(corrupt); expect(runtime.wx.setStorage).not.toHaveBeenCalled();
  });
  it("keeps a failed save message when onShow requests a concurrent refresh", async () => {
    seed(); const view = await page();
    let rejectWrite!: (error: Error) => void;
    runtime.wx.setStorage.mockImplementationOnce(() => new Promise((_, reject) => {rejectWrite = reject;}));
    const saving = view.onSelectTap(tap(view.data.matches[0].id));
    await vi.waitFor(() => expect(rejectWrite).toBeTypeOf("function"));
    await view.onShow(); rejectWrite(new Error("write failed during refresh"));
    await saving;
    expect(view.data.errorMessage).toContain("write failed during refresh");
    expect(view.data.hasSelection).toBe(false);
  });
  it("clears the displayed reference when the page stays open across midnight", async () => {
    vi.useFakeTimers({toFake: ["Date"]}); vi.setSystemTime(new Date("2026-09-12T15:59:00Z"));
    seed(); const view = await page();
    await view.onSelectTap(tap(view.data.matches[0].id)); expect(stored().takeout.selections).toHaveLength(1);
    vi.setSystemTime(new Date("2026-09-13T16:01:00Z"));
    await view.onClearSelection(); expect(stored().takeout.selections).toHaveLength(0);
  });
  it("refreshes a stale date before recording a newly selected meal", async () => {
    vi.useFakeTimers({toFake: ["Date"]}); vi.setSystemTime(new Date("2026-09-12T15:59:00Z"));
    seed(); const view = await page(); const id = view.data.matches[0].id;
    vi.setSystemTime(new Date("2026-09-13T16:01:00Z"));
    await view.onSelectTap(tap(id)); expect(stored().takeout.selections).toHaveLength(0);
    expect(view.data.errorMessage).toContain("日期已变化");
    await view.onSelectTap(tap(id)); expect(stored().takeout.selections).toHaveLength(1);
  });
  it("homepage opens a native takeout page without replacing the saved menu", async () => {
    await import("../miniprogram/pages/index/index");
    const view = runtime.createPage<RuntimePage & {onGoTakeout(event: unknown): Promise<void>}>();
    await view.onGoTakeout({currentTarget: {dataset: {meal: "dinner"}}});
    expect(runtime.wx.navigateTo).toHaveBeenCalledWith({url: "/pages/takeout/takeout?meal=dinner"});
    expect(runtime.wx.setStorage).not.toHaveBeenCalled();
  });
});

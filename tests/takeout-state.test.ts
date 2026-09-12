import { describe, expect, it, vi } from "vitest";
import {
  createDefaultAppState,
  isAppState,
  migrateAppState,
  type AppState
} from "../miniprogram/repositories/app-state";
import {
  CURRENT_SCHEMA_VERSION,
  VersionedRepository,
  namespacedKey,
  type StorageAdapter
} from "../miniprogram/repositories/storage";
import {
  MAX_TAKEOUT_FAVORITES,
  MAX_TAKEOUT_SELECTIONS,
  createEmptyTakeoutState,
  isTakeoutState,
  removeTakeoutSelection,
  setTakeoutSelection,
  toggleTakeoutFavorite,
  type TakeoutSelection
} from "../miniprogram/services/takeout-state";
import {
  LOCAL_BACKUP_FORMAT,
  parseLocalBackup,
  serializeLocalBackup
} from "../miniprogram/services/local-backup";
import { ensureInitialPlan } from "../miniprogram/services/plan-service";

const SAVED_AT = "2026-09-12T00:00:00.000Z";

class MemoryStorage implements StorageAdapter {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.values.keys()];
  }
}

function repositoryFor(adapter: MemoryStorage): VersionedRepository<AppState> {
  return new VersionedRepository(
    adapter,
    "app-state",
    createDefaultAppState,
    CURRENT_SCHEMA_VERSION,
    isAppState,
    migrateAppState
  );
}

function stateWithPlan(): AppState {
  const { state } = ensureInitialPlan(createDefaultAppState(), {
    date: "2026-09-12",
    createdAt: SAVED_AT
  });
  const plan = state.currentPlan!;
  return {
    ...state,
    checkedFoodIdsByPlanId: { [plan.id]: [plan.meals[0].items[0].foodId] }
  };
}

function selectionFor(
  state: AppState,
  overrides: Partial<TakeoutSelection> = {}
): TakeoutSelection {
  return {
    date: "2026-09-12",
    memberId: state.profiles[0].id,
    mealType: "lunch",
    templateId: "chicken-rice",
    ...overrides
  };
}

describe("外卖点单参考本地状态", () => {
  it("creates independent empty arrays for separate installations", () => {
    const first = createEmptyTakeoutState();
    const second = createEmptyTakeoutState();
    first.favoriteTemplateIds.push("chicken-rice");
    first.selections.push(selectionFor(createDefaultAppState()));
    expect(second).toEqual({ favoriteTemplateIds: [], selections: [] });
    expect(createDefaultAppState().takeout).toEqual(second);
  });

  it("saves a reference without changing menus, nutrition, shopping, or the input", () => {
    const state = stateWithPlan();
    const before = JSON.stringify(state);
    const selection = selectionFor(state);
    const saved = setTakeoutSelection(state, selection);

    expect(JSON.stringify(state)).toBe(before);
    expect(saved.currentPlan).toBe(state.currentPlan);
    expect(saved.history).toBe(state.history);
    expect(saved.checkedFoodIdsByPlanId).toBe(state.checkedFoodIdsByPlanId);
    expect(saved.profiles).toBe(state.profiles);
    expect(saved.preferences).toBe(state.preferences);
    expect(saved.generationCounter).toBe(state.generationCounter);
    expect(saved.takeout.selections).toEqual([selection]);
    expect(isAppState(saved)).toBe(true);
    selection.templateId = "edited-input";
    expect(saved.takeout.selections[0].templateId).toBe("chicken-rice");
  });

  it("makes repeated saves idempotent and replaces only the same date/member/meal", () => {
    const base = createDefaultAppState();
    let state = setTakeoutSelection(base, selectionFor(base));
    state = setTakeoutSelection(state, selectionFor(state, { mealType: "dinner" }));
    state = setTakeoutSelection(state, selectionFor(state, { memberId: state.profiles[1].id }));
    state = setTakeoutSelection(state, selectionFor(state, { date: "2026-09-13" }));
    const replaced = setTakeoutSelection(state, selectionFor(state, { templateId: "clear-soup" }));

    expect(replaced.takeout.selections).toHaveLength(4);
    expect(replaced.takeout.selections[0]).toEqual(selectionFor(base, { templateId: "clear-soup" }));
    expect(replaced.takeout.selections.slice(1)).toEqual(state.takeout.selections.slice(0, 3));
    expect(setTakeoutSelection(replaced, selectionFor(base, { templateId: "clear-soup" }))).toBe(replaced);
    expect(state.takeout.selections[3].templateId).toBe("chicken-rice");
  });

  it("retains the latest 60 references and removes only an exact selection", () => {
    let state = createDefaultAppState();
    for (let index = 0; index < MAX_TAKEOUT_SELECTIONS + 3; index += 1) {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      state = setTakeoutSelection(state, selectionFor(state, { date }));
    }
    expect(state.takeout.selections).toHaveLength(MAX_TAKEOUT_SELECTIONS);
    expect(state.takeout.selections[state.takeout.selections.length - 1]?.date).toBe("2026-01-04");
    const first = state.takeout.selections[0];
    const removed = removeTakeoutSelection(state, first);
    expect(removed.takeout.selections).toEqual(state.takeout.selections.slice(1));
    expect(removeTakeoutSelection(removed, first)).toBe(removed);
  });

  it("toggles favorites immutably and reports the limit without dropping favorites", () => {
    const original = createDefaultAppState();
    let state = toggleTakeoutFavorite(original, "chicken-rice");
    expect(original.takeout.favoriteTemplateIds).toEqual([]);
    expect(state.takeout.favoriteTemplateIds).toEqual(["chicken-rice"]);
    state = toggleTakeoutFavorite(state, "chicken-rice");
    expect(state.takeout.favoriteTemplateIds).toEqual([]);
    for (let index = 0; index < MAX_TAKEOUT_FAVORITES; index += 1) {
      state = toggleTakeoutFavorite(state, `option-${index}`);
    }
    expect(() => toggleTakeoutFavorite(state, "one-too-many")).toThrow("最多收藏 50");
    expect(state.takeout.favoriteTemplateIds).toHaveLength(MAX_TAKEOUT_FAVORITES);
    expect(toggleTakeoutFavorite(state, "option-0").takeout.favoriteTemplateIds).toHaveLength(49);
  });

  it.each([
    "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00",
    "2026-9-12", "2026-09-12T00:00:00Z", "0000-01-01", "1900-02-29", "invalid"
  ])("rejects impossible or non-date input %s", (date) => {
    const state = createDefaultAppState();
    expect(() => setTakeoutSelection(state, selectionFor(state, { date }))).toThrow("有效的日期");
    expect(() => removeTakeoutSelection(state, selectionFor(state, { date }))).toThrow("有效的日期");
  });

  it("accepts leap dates and rejects unknown members, meal types, and empty IDs", () => {
    const state = createDefaultAppState();
    expect(isAppState(setTakeoutSelection(state, selectionFor(state, { date: "2000-02-29" })))).toBe(true);
    expect(() => setTakeoutSelection(state, selectionFor(state, { memberId: "missing" }))).toThrow("成员已不存在");
    expect(() => removeTakeoutSelection(state, selectionFor(state, { memberId: "missing" }))).toThrow("成员已不存在");
    expect(() => setTakeoutSelection(state, selectionFor(state, { mealType: "breakfast" as "lunch" }))).toThrow("午餐或晚餐");
    for (const templateId of ["", " ", " padded", "x".repeat(101), "bad\nvalue"]) {
      expect(() => setTakeoutSelection(state, selectionFor(state, { templateId }))).toThrow("有效的外卖搭配");
      expect(() => toggleTakeoutFavorite(state, templateId)).toThrow("有效的外卖搭配");
    }
  });

  it("rejects duplicate, excessive, malformed and unknown-member stored records", () => {
    const state = createDefaultAppState();
    const selection = selectionFor(state);
    const invalidValues = [
      null,
      {},
      { favoriteTemplateIds: [], selections: "broken" },
      { favoriteTemplateIds: [1], selections: [] },
      { favoriteTemplateIds: ["same", "same"], selections: [] },
      { favoriteTemplateIds: Array.from({ length: 51 }, (_, index) => `f-${index}`), selections: [] },
      { favoriteTemplateIds: [], selections: [selection, selection] },
      {
        favoriteTemplateIds: [],
        selections: Array.from({ length: 61 }, (_, index) => ({
          ...selection,
          date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
        }))
      },
      { favoriteTemplateIds: [], selections: [{ ...selection, date: "2026-02-30" }] },
      { favoriteTemplateIds: [], selections: [{ ...selection, mealType: "snack" }] },
      { favoriteTemplateIds: [], selections: [{ ...selection, templateId: null }] }
    ];
    for (const takeout of invalidValues) {
      expect(isTakeoutState(takeout)).toBe(false);
      expect(isAppState({ ...state, takeout })).toBe(false);
    }
    const unknownMember = { ...state, takeout: { favoriteTemplateIds: [], selections: [{ ...selection, memberId: "missing" }] } };
    expect(isAppState(unknownMember)).toBe(false);
    expect(() => toggleTakeoutFavorite(unknownMember, "clear-soup")).toThrow("校验失败");
    const { takeout: _takeout, ...missingTakeout } = state;
    expect(isAppState(missingTakeout)).toBe(false);
  });
});

describe("外卖状态的迁移、备份和共享事务", () => {
  it("migrates v2 storage to v3 while preserving every existing state field", async () => {
    const original = stateWithPlan();
    const { takeout: _takeout, ...v2 } = original;
    const adapter = new MemoryStorage();
    adapter.values.set(namespacedKey("app-state"), { schemaVersion: 2, savedAt: SAVED_AT, data: v2 });
    const repository = repositoryFor(adapter);
    const loaded = await repository.load();

    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(loaded).toEqual(original);
    expect(adapter.values.get(namespacedKey("app-state"))).toMatchObject({ schemaVersion: 3, data: original });
    expect(await repository.load()).toEqual(loaded);
  });

  it.each([1, 2])("restores schema %i backups with the existing menu and shopping checks", (schemaVersion) => {
    const original = stateWithPlan();
    const { takeout: _takeout, ...v2 } = original;
    const { planNeedsRefresh: _needs, planRefreshReason: _reason, ...v1 } = v2;
    const restored = parseLocalBackup(JSON.stringify({
      format: LOCAL_BACKUP_FORMAT,
      schemaVersion,
      exportedAt: SAVED_AT,
      data: schemaVersion === 1 ? v1 : v2
    }));
    expect(restored).toEqual(original);
    expect(restored.takeout).toEqual(createEmptyTakeoutState());
  });

  it("round-trips references and favorites through storage and clipboard backups", async () => {
    const base = stateWithPlan();
    const selected = setTakeoutSelection(base, selectionFor(base));
    const state = toggleTakeoutFavorite(selected, "chicken-rice");
    const repository = repositoryFor(new MemoryStorage());
    await repository.save(state);
    expect(await repository.load()).toEqual(state);
    const restored = parseLocalBackup(serializeLocalBackup(await repository.load(), SAVED_AT));
    expect(restored).toEqual(state);
    restored.takeout.favoriteTemplateIds.push("clear-soup");
    expect((await repository.load()).takeout.favoriteTemplateIds).toEqual(["chicken-rice"]);
  });

  it.each([2, 3])("does not overwrite damaged schema %i storage", async (schemaVersion) => {
    const adapter = new MemoryStorage();
    const original = stateWithPlan();
    const data = schemaVersion === 3
      ? { ...original, takeout: { favoriteTemplateIds: [], selections: [{ ...selectionFor(original), date: "broken" }] } }
      : { ...original, history: "broken" };
    const stored = { schemaVersion, savedAt: SAVED_AT, data };
    adapter.values.set(namespacedKey("app-state"), stored);
    const write = vi.spyOn(adapter, "set");
    const repository = repositoryFor(adapter);
    await expect(repository.load()).rejects.toMatchObject({ code: schemaVersion === 3 ? "INVALID_CURRENT_DATA" : "MIGRATION_FAILED" });
    await expect(repository.update((state) => toggleTakeoutFavorite(state, "chicken-rice"))).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(adapter.values.get(namespacedKey("app-state"))).toBe(stored);
  });

  it("rejects corrupt current backups before replacing valid local data", async () => {
    const adapter = new MemoryStorage();
    const repository = repositoryFor(adapter);
    const original = stateWithPlan();
    await repository.save(original);
    const backup = JSON.parse(serializeLocalBackup(original, SAVED_AT));
    delete backup.data.takeout;
    await expect(repository.update(() => parseLocalBackup(JSON.stringify(backup)))).rejects.toMatchObject({ code: "INVALID_DATA" });
    expect(await repository.load()).toEqual(original);
  });

  it("serializes concurrent reference, favorite and profile changes without lost updates", async () => {
    const adapter = new MemoryStorage();
    const repository = repositoryFor(adapter);
    const original = stateWithPlan();
    await repository.save(original);
    await Promise.all([
      repository.update((latest) => ({ ...latest, profiles: latest.profiles.map((profile, index) => index === 0 ? { ...profile, name: "新称呼" } : profile) })),
      repository.update((latest) => setTakeoutSelection(latest, selectionFor(latest))),
      repository.update((latest) => toggleTakeoutFavorite(latest, "chicken-rice")),
      repository.update((latest) => setTakeoutSelection(latest, selectionFor(latest, { mealType: "dinner", templateId: "clear-soup" })))
    ]);
    const saved = await repository.load();
    expect(saved.profiles[0].name).toBe("新称呼");
    expect(saved.takeout.selections).toHaveLength(2);
    expect(saved.takeout.favoriteTemplateIds).toEqual(["chicken-rice"]);
    expect(saved.currentPlan).toEqual(original.currentPlan);
    expect(saved.checkedFoodIdsByPlanId).toEqual(original.checkedFoodIdsByPlanId);
  });

  it("clears references with owned data and prevents queued stale writes from resurrecting them", async () => {
    const adapter = new MemoryStorage();
    const repository = repositoryFor(adapter);
    const original = createDefaultAppState();
    await repository.save(setTakeoutSelection(original, selectionFor(original)));
    adapter.values.set("other-app:data", { keep: true });
    const clearing = repository.clearOwnedData();
    const staleEdit = repository.update((state) => toggleTakeoutFavorite(state, "chicken-rice"));
    await clearing;
    await expect(staleEdit).rejects.toThrow("本地数据刚刚已清除");
    expect((await repository.load()).takeout).toEqual(createEmptyTakeoutState());
    expect(adapter.values.has(namespacedKey("app-state"))).toBe(false);
    expect(adapter.values.get("other-app:data")).toEqual({ keep: true });
  });
});

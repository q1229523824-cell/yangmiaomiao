import type { AppState } from "../repositories/app-state";

export const MAX_TAKEOUT_SELECTIONS = 60;
export const MAX_TAKEOUT_FAVORITES = 50;

export type TakeoutMealType = "lunch" | "dinner";

/** A saved ordering reference, never a record of food actually consumed. */
export interface TakeoutSelection {
  date: string;
  memberId: string;
  mealType: TakeoutMealType;
  templateId: string;
}

export type TakeoutSelectionKey = Pick<
  TakeoutSelection,
  "date" | "memberId" | "mealType"
>;

export interface TakeoutState {
  favoriteTemplateIds: string[];
  selections: TakeoutSelection[];
}

export function createEmptyTakeoutState(): TakeoutState {
  return { favoriteTemplateIds: [], selections: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/** Check calendar dates without Date.parse's rollover and timezone behaviour. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function isSelectionKey(value: unknown): value is TakeoutSelectionKey {
  return (
    isRecord(value) &&
    isCalendarDate(value.date) &&
    isIdentifier(value.memberId) &&
    (value.mealType === "lunch" || value.mealType === "dinner")
  );
}

function isSelection(value: unknown): value is TakeoutSelection {
  return isSelectionKey(value) && isIdentifier((value as TakeoutSelection).templateId);
}

function selectionKey(value: TakeoutSelectionKey): string {
  return JSON.stringify([value.date, value.memberId, value.mealType]);
}

/** Template availability is checked against the latest catalog by the page. */
export function isTakeoutState(value: unknown): value is TakeoutState {
  if (!isRecord(value)) return false;
  if (
    !Array.isArray(value.favoriteTemplateIds) ||
    value.favoriteTemplateIds.length > MAX_TAKEOUT_FAVORITES ||
    !value.favoriteTemplateIds.every(isIdentifier) ||
    !Array.isArray(value.selections) ||
    value.selections.length > MAX_TAKEOUT_SELECTIONS ||
    !value.selections.every(isSelection)
  ) {
    return false;
  }
  return (
    new Set(value.favoriteTemplateIds).size === value.favoriteTemplateIds.length &&
    new Set(value.selections.map(selectionKey)).size === value.selections.length
  );
}

function assertWritableTakeoutState(state: AppState): void {
  if (
    !isTakeoutState(state.takeout) ||
    state.takeout.selections.some(
      (item) => !state.profiles.some((profile) => profile.id === item.memberId)
    )
  ) {
    throw new Error("本地点单参考数据校验失败，请重新打开页面后再试。");
  }
}

function assertSelectionKey(state: AppState, value: TakeoutSelectionKey): void {
  if (!isSelectionKey(value)) {
    throw new Error("请选择有效的日期、成员和午餐或晚餐。");
  }
  if (!state.profiles.some((profile) => profile.id === value.memberId)) {
    throw new Error("所选成员已不存在，请重新选择成员。");
  }
}

/** Use inside the shared repository's update/transaction callback. */
export function setTakeoutSelection(
  state: AppState,
  selection: TakeoutSelection
): AppState {
  assertWritableTakeoutState(state);
  assertSelectionKey(state, selection);
  if (!isIdentifier(selection.templateId)) {
    throw new Error("请选择有效的外卖搭配。");
  }
  const key = selectionKey(selection);
  const previous = state.takeout.selections.find((item) => selectionKey(item) === key);
  if (previous?.templateId === selection.templateId) return state;
  return {
    ...state,
    takeout: {
      ...state.takeout,
      selections: [
        {
          date: selection.date,
          memberId: selection.memberId,
          mealType: selection.mealType,
          templateId: selection.templateId
        },
        ...state.takeout.selections.filter((item) => selectionKey(item) !== key)
      ].slice(0, MAX_TAKEOUT_SELECTIONS)
    }
  };
}

export function removeTakeoutSelection(
  state: AppState,
  key: TakeoutSelectionKey
): AppState {
  assertWritableTakeoutState(state);
  assertSelectionKey(state, key);
  const serializedKey = selectionKey(key);
  const selections = state.takeout.selections.filter(
    (item) => selectionKey(item) !== serializedKey
  );
  if (selections.length === state.takeout.selections.length) return state;
  return { ...state, takeout: { ...state.takeout, selections } };
}

export function toggleTakeoutFavorite(state: AppState, templateId: string): AppState {
  assertWritableTakeoutState(state);
  if (!isIdentifier(templateId)) throw new Error("请选择有效的外卖搭配。");
  const favorites = state.takeout.favoriteTemplateIds;
  const alreadyFavorite = favorites.includes(templateId);
  if (!alreadyFavorite && favorites.length >= MAX_TAKEOUT_FAVORITES) {
    throw new Error("最多收藏 50 种搭配，请先取消一项收藏。");
  }
  return {
    ...state,
    takeout: {
      ...state.takeout,
      favoriteTemplateIds: alreadyFavorite
        ? favorites.filter((id) => id !== templateId)
        : [templateId, ...favorites]
    }
  };
}

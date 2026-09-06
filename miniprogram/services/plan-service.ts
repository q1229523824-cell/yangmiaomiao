import {
  generateDailyPlan,
  MenuGenerationError,
  seedFromText
} from "../domain/menu-generator";
import type { Preferences } from "../domain/models";
import type { AppState } from "../repositories/app-state";
import { appendPlanToHistory } from "../repositories/app-state";

export interface PlanStateResult {
  state: AppState;
  generated: boolean;
}

export interface GenerateForStateOptions {
  date: string;
  createdAt?: string;
}

export interface PreferencePlanStateResult extends PlanStateResult {
  generationError: MenuGenerationError | null;
}

export type SaveAppState = (state: AppState) => Promise<void>;

/**
 * Generate only when this device has never saved a plan. Reopening, changing
 * tabs, crossing midnight, or saving a profile must never replace a snapshot.
 */
export function ensureInitialPlan(
  state: AppState,
  options: GenerateForStateOptions
): PlanStateResult {
  if (state.currentPlan) return { state, generated: false };
  return {
    state: regeneratePlan(state, options),
    generated: true
  };
}

/** Generate a new snapshot only in response to an explicit user action. */
export function regeneratePlan(
  state: AppState,
  options: GenerateForStateOptions
): AppState {
  const generationCounter = state.generationCounter + 1;
  const plan = generateDailyPlan({
    date: options.date,
    profiles: state.profiles,
    preferences: state.preferences,
    seed: seedFromText(`${options.date}:${generationCounter}`),
    createdAt: options.createdAt
  });
  return appendPlanToHistory({ ...state, generationCounter }, plan);
}

/**
 * Apply a preference edit even when the remaining hard constraints make a new
 * menu impossible. In that case the old snapshot is retained but marked as
 * unsafe so pages can hide it while the user removes conflicting constraints.
 */
export function preparePreferencePlanChange(
  state: AppState,
  preferences: Preferences,
  options: GenerateForStateOptions
): PreferencePlanStateResult {
  const pendingState: AppState = {
    ...state,
    preferences,
    planNeedsRefresh: true,
    planRefreshReason: "preferences_changed"
  };
  try {
    return {
      state: regeneratePlan(pendingState, options),
      generated: true,
      generationError: null
    };
  } catch (error) {
    if (!(error instanceof MenuGenerationError)) throw error;
    return {
      state: pendingState,
      generated: false,
      generationError: error
    };
  }
}

/**
 * Persist exactly one prepared result. Assignment to page-level state should
 * happen only after this promise resolves, keeping memory and storage in sync.
 */
export async function savePreferencePlanChange(
  state: AppState,
  preferences: Preferences,
  options: GenerateForStateOptions,
  save: SaveAppState
): Promise<PreferencePlanStateResult> {
  const result = preparePreferencePlanChange(state, preferences, options);
  await save(result.state);
  return result;
}

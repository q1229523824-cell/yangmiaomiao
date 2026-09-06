import {
  DEFAULT_PREFERENCES,
  DEFAULT_PROFILES
} from "./catalog";
import type { Preferences, Profile } from "../domain/models";

export { DEFAULT_PREFERENCES, DEFAULT_PROFILES };
export const EMPTY_PREFERENCES = DEFAULT_PREFERENCES;

export function cloneDefaultProfiles(): Profile[] {
  return DEFAULT_PROFILES.map((profile) => ({
    ...profile,
    goalSettings: { ...profile.goalSettings }
  }));
}

export function createEmptyPreferences(): Preferences {
  return {
    ...EMPTY_PREFERENCES,
    excludedFoodIds: [],
    preferredFoodIds: [],
    excludedFoodGroups: [],
    preferredCookingMethods: [],
    preferredFlavors: [],
    allergens: []
  };
}

import { createEmptyPreferences } from "./preference-parser";
import type {
  CookingMethod,
  Flavor,
  FoodGroup,
  FoodId,
  Preferences
} from "./models";

export type RemovablePreferenceKind =
  | "exclude_food"
  | "prefer_food"
  | "exclude_group"
  | "avoid_whey"
  | "prefer_method"
  | "prefer_flavor"
  | "light_dinner";

function clone(preferences: Preferences): Preferences {
  return {
    ...preferences,
    excludedFoodIds: [...preferences.excludedFoodIds],
    preferredFoodIds: [...preferences.preferredFoodIds],
    excludedFoodGroups: [...preferences.excludedFoodGroups],
    preferredCookingMethods: [...preferences.preferredCookingMethods],
    preferredFlavors: [...preferences.preferredFlavors],
    allergens: [...preferences.allergens]
  };
}

export function removePreference(
  current: Preferences,
  kind: RemovablePreferenceKind,
  value = ""
): Preferences {
  const next = clone(current);
  if (kind === "exclude_food") {
    next.excludedFoodIds = next.excludedFoodIds.filter(
      (foodId) => foodId !== (value as FoodId)
    );
  } else if (kind === "prefer_food") {
    next.preferredFoodIds = next.preferredFoodIds.filter(
      (foodId) => foodId !== (value as FoodId)
    );
  } else if (kind === "exclude_group") {
    next.excludedFoodGroups = next.excludedFoodGroups.filter(
      (group) => group !== (value as FoodGroup)
    );
  } else if (kind === "avoid_whey") {
    next.avoidWhey = false;
  } else if (kind === "prefer_method") {
    next.preferredCookingMethods = next.preferredCookingMethods.filter(
      (method) => method !== (value as CookingMethod)
    );
  } else if (kind === "prefer_flavor") {
    next.preferredFlavors = next.preferredFlavors.filter(
      (flavor) => flavor !== (value as Flavor)
    );
  } else if (kind === "light_dinner") {
    next.lightDinner = false;
  }
  return next;
}

/** Clear ordinary preferences while retaining allergy safety data. */
export function resetPreferences(current: Preferences): Preferences {
  return {
    ...createEmptyPreferences(),
    allergens: [...current.allergens]
  };
}

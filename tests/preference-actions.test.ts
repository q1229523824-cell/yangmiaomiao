import { describe, expect, it } from "vitest";
import {
  removePreference,
  resetPreferences
} from "../miniprogram/domain/preference-actions";
import { createEmptyPreferences } from "../miniprogram/domain/preference-parser";

describe("preference actions", () => {
  it("removes exactly one selected preference without mutating the source", () => {
    const source = {
      ...createEmptyPreferences(),
      excludedFoodIds: ["tomato", "onion"]
    };
    const next = removePreference(source, "exclude_food", "tomato");

    expect(next.excludedFoodIds).toEqual(["onion"]);
    expect(source.excludedFoodIds).toEqual(["tomato", "onion"]);
  });

  it("resets ordinary preferences but preserves allergens", () => {
    const source = {
      ...createEmptyPreferences(),
      excludedFoodIds: ["tomato"],
      preferredFlavors: ["garlic" as const],
      allergens: ["milk" as const]
    };
    const next = resetPreferences(source);

    expect(next.excludedFoodIds).toEqual([]);
    expect(next.preferredFlavors).toEqual([]);
    expect(next.allergens).toEqual(["milk"]);
  });
});

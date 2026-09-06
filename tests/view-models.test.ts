import { describe, expect, it } from "vitest";

import type { Allergen, FoodGroup } from "../miniprogram/domain/models";
import { createEmptyPreferences } from "../miniprogram/domain/preference-parser";
import { preferenceSummary } from "../miniprogram/presentation/view-models";

describe("preferenceSummary", () => {
  it("为全部食物分组和过敏原提供中文标签", () => {
    const groups: FoodGroup[] = [
      "poultry",
      "pork",
      "beef",
      "fish",
      "shellfish",
      "egg",
      "dairy",
      "soy",
      "supplement",
      "grain",
      "tuber",
      "vegetable"
    ];
    const allergens: Allergen[] = ["egg", "milk", "soy", "fish", "shellfish", "gluten"];
    const tags = preferenceSummary({
      ...createEmptyPreferences(),
      excludedFoodGroups: groups,
      allergens
    });

    expect(tags.filter((tag) => tag.kind === "exclude_group").map((tag) => tag.label)).toEqual([
      "不吃 禽肉",
      "不吃 猪肉",
      "不吃 牛肉",
      "不吃 鱼类",
      "不吃 虾贝类",
      "不吃 蛋类",
      "不吃 奶制品",
      "不吃 豆制品",
      "不吃 营养补剂",
      "不吃 谷物主食",
      "不吃 薯类主食",
      "不吃 蔬菜"
    ]);
    expect(tags.filter((tag) => tag.kind === "allergen").map((tag) => tag.label)).toEqual([
      "过敏原 蛋类",
      "过敏原 牛奶",
      "过敏原 大豆",
      "过敏原 鱼类",
      "过敏原 虾贝类",
      "过敏原 麸质"
    ]);
  });
});

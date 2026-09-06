import { describe, expect, it } from "vitest";

import {
  createEmptyPreferences,
  parsePreferences,
} from "../miniprogram/domain/preference-parser";

describe("parsePreferences", () => {
  it("把牛肉和鸡肉泛称映射为完整食材组", () => {
    const result = parsePreferences("不要牛肉，也不要鸡肉");

    expect(result.preferences.excludedFoodGroups).toEqual(
      expect.arrayContaining(["beef", "poultry"]),
    );
    expect(result.preferences.excludedFoodIds).not.toContain("beef_tenderloin");
  });

  it("肯定牛肉泛称时同时覆盖牛里脊和牛腱", () => {
    const result = parsePreferences("想吃牛肉");

    expect(result.preferences.preferredFoodIds).toEqual(
      expect.arrayContaining(["beef_tenderloin", "beef_shank"]),
    );
  });

  it("肯定具体食材会解除覆盖它的旧分组排除", () => {
    const current = createEmptyPreferences();
    current.excludedFoodGroups = ["beef", "vegetable"];

    const result = parsePreferences("想吃牛里脊，也想吃番茄", current);

    expect(result.preferences.excludedFoodGroups).not.toContain("beef");
    expect(result.preferences.excludedFoodGroups).not.toContain("vegetable");
    expect(result.preferences.preferredFoodIds).toEqual(
      expect.arrayContaining(["beef_tenderloin", "tomato"])
    );
  });

  it.each(["不要番茄", "不要西红柿", "番茄过敏", "别给我放西红柿"])(
    "把常见番茄否定表达转成硬排除：%s",
    (input) => {
      const result = parsePreferences(input, createEmptyPreferences());

      expect(result.changed).toBe(true);
      expect(result.preferences.excludedFoodIds).toContain("tomato");
      expect(result.preferences.preferredFoodIds).not.toContain("tomato");
      expect(result.changes).toContainEqual({
        kind: "exclude_food",
        value: "tomato",
      });
      expect(result.warnings).toEqual([]);
      expect(result.unrecognized).toEqual([]);
    },
  );

  it("支持番茄及其他常见食材的肯定表达", () => {
    const result = parsePreferences(
      "想吃西红柿和西兰花",
      createEmptyPreferences(),
    );

    expect(result.preferences.preferredFoodIds).toEqual(
      expect.arrayContaining(["tomato", "broccoli"]),
    );
    expect(result.preferences.excludedFoodIds).toEqual([]);
    expect(result.unrecognized).toEqual([]);
  });

  it("按分句分别处理排除和偏好，避免一个否定词污染整句话", () => {
    const result = parsePreferences(
      "今天不想吃鱼，想吃猪里脊；晚餐清淡，空气炸锅优先",
      createEmptyPreferences(),
    );

    expect(result.changed).toBe(true);
    expect(result.preferences.excludedFoodGroups).toEqual(["fish"]);
    expect(result.preferences.preferredFoodIds).toContain("pork_tenderloin");
    expect(result.preferences.excludedFoodIds).not.toContain("pork_tenderloin");
    expect(result.preferences.lightDinner).toBe(true);
    expect(result.preferences.preferredCookingMethods).toContain("air_fryer");
    expect(result.unrecognized).toEqual([]);
  });

  it("没有标点时也按转折词隔离否定范围", () => {
    const result = parsePreferences(
      "不要番茄但想吃猪里脊",
      createEmptyPreferences(),
    );

    expect(result.preferences.excludedFoodIds).toContain("tomato");
    expect(result.preferences.preferredFoodIds).toContain("pork_tenderloin");
    expect(result.preferences.excludedFoodIds).not.toContain("pork_tenderloin");
    expect(result.unrecognized).toEqual([]);
  });

  it("新偏好解除同项排除，新排除也解除同项偏好", () => {
    const current = createEmptyPreferences();
    current.excludedFoodIds = ["chicken_breast"];
    current.preferredFoodIds = ["pork_tenderloin"];
    current.excludedFoodGroups = ["fish"];

    const result = parsePreferences(
      "想吃鸡胸，不要猪里脊；今天想吃三文鱼",
      current,
    );

    expect(result.preferences.preferredFoodIds).toEqual(
      expect.arrayContaining(["chicken_breast", "salmon"]),
    );
    expect(result.preferences.excludedFoodIds).toContain("pork_tenderloin");
    expect(result.preferences.excludedFoodIds).not.toContain("chicken_breast");
    expect(result.preferences.preferredFoodIds).not.toContain("pork_tenderloin");
    expect(result.preferences.excludedFoodGroups).not.toContain("fish");
    expect(current.excludedFoodIds).toEqual(["chicken_breast"]);
  });

  it("重置额外偏好但保留安全相关的过敏原资料", () => {
    const current = createEmptyPreferences();
    current.excludedFoodIds = ["chicken_breast"];
    current.preferredFoodIds = ["beef_tenderloin"];
    current.excludedFoodGroups = ["fish"];
    current.avoidWhey = true;
    current.preferredCookingMethods = ["air_fryer"];
    current.preferredFlavors = ["spicy"];
    current.lightDinner = true;
    current.allergens = ["milk"];

    const result = parsePreferences("重置偏好", current);

    expect(result.reset).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.changes).toEqual([{ kind: "reset" }]);
    expect(result.preferences).toEqual({
      ...createEmptyPreferences(),
      allergens: ["milk"],
    });
    expect(result.unrecognized).toEqual([]);
  });

  it("支持蛋白粉、口味以及未识别片段的结构化反馈", () => {
    const first = parsePreferences(
      "今天不喝蛋白粉，想吃蒜香；月球口味",
      createEmptyPreferences(),
    );

    expect(first.preferences.avoidWhey).toBe(true);
    expect(first.preferences.preferredFlavors).toContain("garlic");
    expect(first.unrecognized).toEqual(["月球口味"]);
    expect(first.reply).toContain("暂未识别：月球口味");

    const reversed = parsePreferences("可以喝蛋白粉", first.preferences);
    expect(reversed.preferences.avoidWhey).toBe(false);
    expect(reversed.changes).toContainEqual({ kind: "allow_whey" });
  });

  it.each([
    "不要鸡胸",
    "不要番茄",
    "空气炸锅优先",
    "想吃蒜香",
    "晚餐清淡",
  ])("重复设置同一偏好不会报告变化：%s", (input) => {
    const first = parsePreferences(input, createEmptyPreferences());
    expect(first.changed).toBe(true);

    const repeated = parsePreferences(input, first.preferences);
    expect(repeated.changed).toBe(false);
    expect(repeated.changes).toEqual([]);
    expect(repeated.reply).toBe("这些偏好已经生效，设置没有变化。");
    expect(repeated.unrecognized).toEqual([]);
  });

  it("重复允许蛋白粉不会报告变化", () => {
    const current = createEmptyPreferences();
    current.avoidWhey = true;
    const allowed = parsePreferences("可以喝蛋白粉", current);
    expect(allowed.changed).toBe(true);

    const repeated = parsePreferences("可以喝蛋白粉", allowed.preferences);
    expect(repeated.changed).toBe(false);
    expect(repeated.changes).toEqual([]);
    expect(repeated.reply).toBe("这些偏好已经生效，设置没有变化。");
  });

  it("允许蛋白粉会解除普通乳制品排除但绝不清除牛奶过敏原", () => {
    const current = createEmptyPreferences();
    current.excludedFoodGroups = ["dairy"];
    current.avoidWhey = true;
    current.allergens = ["milk"];

    const result = parsePreferences("可以喝蛋白粉", current);

    expect(result.preferences.avoidWhey).toBe(false);
    expect(result.preferences.excludedFoodGroups).not.toContain("dairy");
    expect(result.preferences.allergens).toEqual(["milk"]);
    expect(current.excludedFoodGroups).toEqual(["dairy"]);
  });

  it.each(["牛奶过敏", "乳制品不耐受", "乳糖不耐受"])(
    "把明确的牛奶安全声明记录为 milk 过敏原：%s",
    (input) => {
      const result = parsePreferences(input, createEmptyPreferences());

      expect(result.preferences.allergens).toContain("milk");
      expect(result.changes).toContainEqual({
        kind: "add_allergen",
        value: "milk",
      });
      expect(result.preferences.excludedFoodIds).not.toContain("skim_milk");
      expect(result.preferences.excludedFoodGroups).not.toContain("dairy");
    },
  );

  it("只有明确纠正过敏资料才解除安全约束", () => {
    const current = createEmptyPreferences();
    current.allergens = ["milk"];

    const ordinaryPositive = parsePreferences("可以喝牛奶", current);
    expect(ordinaryPositive.changed).toBe(false);
    expect(ordinaryPositive.preferences.allergens).toEqual(["milk"]);
    expect(ordinaryPositive.preferences.preferredFoodIds).not.toContain("skim_milk");
    expect(ordinaryPositive.reply).toContain("取消牛奶过敏");

    const corrected = parsePreferences("取消牛奶过敏", current);
    expect(corrected.preferences.allergens).toEqual([]);
    expect(corrected.changes).toContainEqual({
      kind: "remove_allergen",
      value: "milk",
    });
    expect(corrected.preferences.excludedFoodIds).not.toContain("skim_milk");

    const naturalCorrection = parsePreferences("我对牛奶可以耐受", current);
    expect(naturalCorrection.preferences.allergens).toEqual([]);
  });

  it("支持有限且明确的其他过敏原词汇", () => {
    const result = parsePreferences(
      "鸡蛋过敏，豆制品不耐受，海鲜过敏，麸质过敏",
      createEmptyPreferences(),
    );

    expect(result.preferences.allergens).toEqual(
      expect.arrayContaining(["egg", "soy", "fish", "shellfish", "gluten"]),
    );
    expect(result.unrecognized).toEqual([]);
  });

  it("默认状态下重置是已识别的无操作", () => {
    const result = parsePreferences("重置偏好", createEmptyPreferences());

    expect(result.reset).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.reply).toBe("这些偏好已经生效，设置没有变化。");
    expect(result.unrecognized).toEqual([]);
  });

  it("同一次输入的操作相互抵消时不报告持久状态变化", () => {
    const result = parsePreferences(
      "不要番茄，然后重置偏好",
      createEmptyPreferences(),
    );

    expect(result.changed).toBe(false);
    expect(result.changes).toEqual([]);
    expect(result.preferences).toEqual(createEmptyPreferences());
    expect(result.reply).toBe("这些偏好已经生效，设置没有变化。");
  });
});

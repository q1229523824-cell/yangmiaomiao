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

  it.each(["牛奶不过敏", "我对牛奶不过敏"])(
    "不过敏不会被转折词拆开，并且只解除对应过敏原：%s",
    (input) => {
      const current = createEmptyPreferences();
      current.allergens = ["milk", "egg"];

      const result = parsePreferences(input, current);

      expect(result.changed).toBe(true);
      expect(result.preferences.allergens).toEqual(["egg"]);
      expect(result.changes).toContainEqual({
        kind: "remove_allergen",
        value: "milk",
      });
      expect(result.preferences.excludedFoodIds).not.toContain("skim_milk");
      expect(result.unrecognized).toEqual([]);
      expect(result.reply).toContain("已移除牛奶/乳制品过敏原记录");
    },
  );

  it("鸡蛋不过敏只解除 egg，保留其他过敏原", () => {
    const current = createEmptyPreferences();
    current.allergens = ["milk", "egg"];

    const result = parsePreferences("我对鸡蛋不过敏", current);

    expect(result.preferences.allergens).toEqual(["milk"]);
    expect(result.changes).toContainEqual({
      kind: "remove_allergen",
      value: "egg",
    });
  });

  it.each([
    ["牛奶不过敏鸡蛋过敏", "egg", "milk"],
    ["牛奶过敏鸡蛋不过敏", "milk", "egg"],
  ] as const)(
    "无标点混合过敏声明按各自局部语境处理：%s",
    (input, retained, removed) => {
      const current = createEmptyPreferences();
      current.allergens = ["milk", "egg"];

      const result = parsePreferences(input, current);

      expect(result.preferences.allergens).toEqual([retained]);
      expect(result.changes).toContainEqual({
        kind: "remove_allergen",
        value: removed,
      });
      expect(result.changes).not.toContainEqual({
        kind: "remove_allergen",
        value: retained,
      });
      expect(result.unrecognized).toEqual([]);
    },
  );

  it("相邻过敏原列表共享末尾的添加声明", () => {
    const result = parsePreferences(
      "牛奶和鸡蛋过敏",
      createEmptyPreferences(),
    );

    expect(result.preferences.allergens).toEqual(
      expect.arrayContaining(["milk", "egg"]),
    );
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { kind: "add_allergen", value: "milk" },
        { kind: "add_allergen", value: "egg" },
      ]),
    );
    expect(result.unrecognized).toEqual([]);
  });

  it.each(["牛奶以及鸡蛋过敏", "牛奶跟鸡蛋过敏"])(
    "支持常见中文过敏原连接词：%s",
    (input) => {
      const result = parsePreferences(input, createEmptyPreferences());

      expect(result.preferences.allergens).toEqual(
        expect.arrayContaining(["milk", "egg"]),
      );
      expect(result.unrecognized).toEqual([]);
    },
  );

  it("明确取消相邻过敏原列表时只解除列表内项目", () => {
    const current = createEmptyPreferences();
    current.allergens = ["milk", "egg", "soy"];

    const result = parsePreferences("取消牛奶和鸡蛋过敏", current);

    expect(result.preferences.allergens).toEqual(["soy"]);
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { kind: "remove_allergen", value: "milk" },
        { kind: "remove_allergen", value: "egg" },
      ]),
    );
    expect(result.changes).not.toContainEqual({
      kind: "remove_allergen",
      value: "soy",
    });
    expect(result.unrecognized).toEqual([]);
  });

  it("少放番茄按当前能力保存为硬排除，并明确告知语义加严", () => {
    const current = createEmptyPreferences();
    current.preferredFoodIds = ["tomato"];
    current.preferredFlavors = ["tomato"];

    const result = parsePreferences("少放番茄", current);

    expect(result.changed).toBe(true);
    expect(result.preferences.excludedFoodIds).toContain("tomato");
    expect(result.preferences.preferredFoodIds).not.toContain("tomato");
    expect(result.preferences.preferredFlavors).not.toContain("tomato");
    expect(result.reply).toContain("暂不支持少量，已按不放番茄处理");
    expect(result.unrecognized).toEqual([]);
  });

  it("少放辣被识别为减量而不是辣味偏好，并准确说明能力边界", () => {
    const result = parsePreferences("少放辣", createEmptyPreferences());

    expect(result.changed).toBe(false);
    expect(result.preferences.preferredFlavors).not.toContain("spicy");
    expect(result.changes).toEqual([]);
    expect(result.unrecognized).toEqual([]);
    expect(result.reply).toContain("已识别为减少辣味");
    expect(result.reply).toContain("本次没有新增偏好");
  });

  it.each(["少放辣", "不要辣"])(
    "负向口味至少取消已有辣味优先，但不冒充严格排除约束：%s",
    (input) => {
      const current = createEmptyPreferences();
      current.preferredFlavors = ["spicy", "garlic"];

      const result = parsePreferences(input, current);

      expect(result.changed).toBe(true);
      expect(result.preferences.preferredFlavors).toEqual(["garlic"]);
      expect(result.changes).toContainEqual({
        kind: "remove_flavor",
        value: "spicy",
      });
      expect(result.reply).toContain("已取消辣味优先");
      expect(result.reply).not.toContain("将它设为辣味优先");
      expect(result.reply).toMatch(/不等同于严格少放|不能保存严格排除/);
    },
  );

  it("减量标记只作用于最近对象，不污染同片段里的普通排除", () => {
    const result = parsePreferences("少放辣不要番茄", createEmptyPreferences());

    expect(result.preferences.excludedFoodIds).toContain("tomato");
    expect(result.preferences.preferredFlavors).not.toContain("spicy");
    expect(result.reply).toContain("避开番茄");
    expect(result.reply).not.toContain("按不放番茄处理");
  });

  it("设备故障描述不会被当作烹饪方式偏好", () => {
    const result = parsePreferences("空气炸锅坏了", createEmptyPreferences());

    expect(result.changed).toBe(false);
    expect(result.preferences.preferredCookingMethods).not.toContain("air_fryer");
    expect(result.changes).toEqual([]);
    expect(result.unrecognized).toEqual(["空气炸锅坏了"]);
    expect(result.reply).toContain("暂未识别：空气炸锅坏了");
  });

  it.each(["不要鱼香肉丝", "不要鱼油"])(
    "不把不支持的含鱼复合词误判为排除所有鱼类：%s",
    (input) => {
      const result = parsePreferences(input, createEmptyPreferences());

      expect(result.changed).toBe(false);
      expect(result.preferences.excludedFoodGroups).not.toContain("fish");
      expect(result.changes).toEqual([]);
      expect(result.unrecognized).toEqual([input]);
      expect(result.reply).toContain(`暂未识别：${input}`);
    },
  );

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

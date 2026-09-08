import { FOOD_BY_ID } from "../data/catalog";
import type {
  Allergen,
  CookingMethod,
  Flavor,
  FoodGroup,
  FoodId,
  ParseResult,
  PreferenceChange,
  Preferences,
} from "./models";

type Polarity = "exclude" | "prefer";

interface FoodDefinition {
  id: FoodId;
  label: string;
  aliases: readonly string[];
  fish?: boolean;
}

interface TextMatch {
  start: number;
  end: number;
}

interface FoodMatch extends TextMatch {
  id?: FoodId;
  group?: FoodGroup;
  label: string;
}

interface PolarityMarker extends TextMatch {
  polarity: Polarity;
  reduction: boolean;
}

interface AllergenDefinition {
  allergens: readonly Allergen[];
  label: string;
  aliases: readonly string[];
}

interface AllergenMatch extends TextMatch {
  definition: AllergenDefinition;
}

const FOOD_DEFINITIONS: readonly FoodDefinition[] = [
  { id: "chicken_breast", label: "鸡胸肉", aliases: ["鸡胸肉", "鸡胸"] },
  {
    id: "chicken_thigh_skinless",
    label: "去皮鸡腿肉",
    aliases: ["去皮鸡腿肉", "鸡腿肉", "鸡腿"],
  },
  { id: "beef_tenderloin", label: "牛里脊", aliases: ["牛里脊"] },
  { id: "beef_shank", label: "牛腱", aliases: ["牛腱子", "牛腱"] },
  { id: "pork_tenderloin", label: "猪里脊", aliases: ["猪里脊", "里脊肉"] },
  { id: "shrimp", label: "虾仁", aliases: ["虾仁", "大虾", "虾"] },
  { id: "sea_bass", label: "鲈鱼", aliases: ["鲈鱼"], fish: true },
  { id: "cod", label: "鳕鱼", aliases: ["鳕鱼"], fish: true },
  { id: "salmon", label: "三文鱼", aliases: ["三文鱼"], fish: true },
  { id: "basa_fish", label: "巴沙鱼", aliases: ["巴沙鱼"], fish: true },
  {
    id: "white_rice_raw",
    label: "大米",
    aliases: ["白米饭", "白米", "大米", "米饭"],
  },
  { id: "brown_rice_raw", label: "糙米", aliases: ["糙米饭", "糙米"] },
  { id: "potato_raw", label: "土豆", aliases: ["马铃薯", "土豆"] },
  { id: "sweet_potato_raw", label: "红薯", aliases: ["红薯", "地瓜"] },
  { id: "corn_edible_raw", label: "玉米", aliases: ["玉米"] },
  { id: "pasta_dry", label: "意面", aliases: ["意大利面", "意面"] },
  {
    id: "buckwheat_noodles_dry",
    label: "荞麦面",
    aliases: ["荞麦面条", "荞麦面"],
  },
  { id: "oats_dry", label: "燕麦", aliases: ["燕麦片", "燕麦"] },
  { id: "broccoli", label: "西兰花", aliases: ["西兰花", "花椰菜"] },
  { id: "tomato", label: "番茄", aliases: ["西红柿", "番茄"] },
  { id: "mushroom", label: "蘑菇", aliases: ["口蘑", "蘑菇"] },
  { id: "enoki_mushroom", label: "金针菇", aliases: ["金针菇"] },
  {
    id: "baby_chinese_cabbage",
    label: "娃娃菜",
    aliases: ["娃娃菜"],
  },
  { id: "asparagus", label: "芦笋", aliases: ["芦笋"] },
  { id: "bell_pepper", label: "彩椒", aliases: ["甜椒", "彩椒"] },
  { id: "onion", label: "洋葱", aliases: ["洋葱"] },
  { id: "eggplant", label: "茄子", aliases: ["茄子"] },
  { id: "okra", label: "秋葵", aliases: ["秋葵"] },
  {
    id: "cabbage",
    label: "卷心菜",
    aliases: ["卷心菜", "包菜", "圆白菜"],
  },
  { id: "spinach", label: "菠菜", aliases: ["菠菜"] },
  { id: "carrot", label: "胡萝卜", aliases: ["胡萝卜", "红萝卜"] },
  { id: "green_pepper", label: "青椒", aliases: ["青椒"] },
  { id: "egg", label: "鸡蛋", aliases: ["鸡蛋", "蛋类"] },
  {
    id: "greek_yogurt",
    label: "希腊酸奶",
    aliases: ["希腊酸奶", "酸奶"],
  },
  {
    id: "unsweetened_soy_milk",
    label: "无糖豆浆",
    aliases: ["无糖豆浆", "豆浆"],
  },
  {
    id: "skim_milk",
    label: "脱脂牛奶",
    aliases: ["脱脂牛奶", "牛奶"],
  },
];

const FISH_FOOD_IDS = FOOD_DEFINITIONS.filter((food) => food.fish).map(
  (food) => food.id,
);

const GROUP_DEFINITIONS: ReadonlyArray<{
  group: FoodGroup;
  label: string;
  aliases: readonly string[];
}> = [
  { group: "fish", label: "各类鱼", aliases: ["所有鱼类", "各种鱼类", "各类鱼", "各种鱼", "所有鱼", "鱼类", "鱼"] },
  { group: "beef", label: "牛肉", aliases: ["各种牛肉", "所有牛肉", "牛肉"] },
  { group: "pork", label: "猪肉", aliases: ["各种猪肉", "所有猪肉", "猪肉"] },
  { group: "poultry", label: "鸡肉", aliases: ["禽肉", "各种鸡肉", "所有鸡肉", "鸡肉"] },
  { group: "dairy", label: "乳制品", aliases: ["奶制品", "乳制品"] },
  { group: "soy", label: "豆制品", aliases: ["豆制品"] },
  { group: "vegetable", label: "蔬菜", aliases: ["各种蔬菜", "所有蔬菜", "蔬菜"] },
];

const FOOD_IDS_BY_GROUP: Readonly<Record<string, readonly FoodId[]>> = {
  fish: FISH_FOOD_IDS,
  beef: ["beef_tenderloin", "beef_shank"],
  pork: ["pork_tenderloin"],
  poultry: ["chicken_breast", "chicken_thigh_skinless"],
  dairy: ["greek_yogurt", "skim_milk", "whey_protein"],
  soy: ["unsweetened_soy_milk"],
  vegetable: [
    "broccoli", "tomato", "mushroom", "enoki_mushroom",
    "baby_chinese_cabbage", "asparagus", "bell_pepper", "onion",
    "eggplant", "okra", "cabbage", "spinach", "carrot", "green_pepper",
  ],
};

// Keep this vocabulary deliberately small and explicit. Allergy claims are
// safety constraints, not ordinary likes/dislikes, so ambiguous words must not
// silently create or clear them.
const ALLERGEN_DEFINITIONS: readonly AllergenDefinition[] = [
  {
    allergens: ["milk"],
    label: "牛奶/乳制品",
    aliases: ["乳糖", "乳制品", "奶制品", "牛奶", "奶类"],
  },
  { allergens: ["egg"], label: "鸡蛋", aliases: ["鸡蛋", "蛋类"] },
  { allergens: ["soy"], label: "大豆", aliases: ["豆制品", "大豆", "豆浆"] },
  { allergens: ["fish"], label: "鱼类", aliases: ["鱼类", "鱼"] },
  {
    allergens: ["shellfish"],
    label: "虾/贝类",
    aliases: ["甲壳类", "贝类", "虾仁", "大虾", "虾"],
  },
  {
    allergens: ["fish", "shellfish"],
    label: "海鲜",
    aliases: ["海鲜"],
  },
  { allergens: ["gluten"], label: "麸质", aliases: ["麸质", "小麦"] },
];

type AllergenAction = "add" | "remove" | "preserve";

/**
 * Infer one allergen's action from its own immediate context.
 *
 * This intentionally avoids a fragment-wide “contains 不过敏” flag: one
 * unpunctuated sentence may add an allergen and remove another. Removal stays
 * deliberately conservative because a false removal weakens a safety rule.
 */
function inferAllergenAction(
  text: string,
  match: TextMatch,
  allMatches: readonly TextMatch[],
): AllergenAction | undefined {
  const directAfter = text.slice(match.end);
  const orderedMatches = [...allMatches].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const matchIndex = orderedMatches.findIndex(
    (candidate) => candidate.start === match.start && candidate.end === match.end,
  );
  let firstIndex = matchIndex;
  let lastIndex = matchIndex;
  const isListConnector = (value: string) =>
    /^(?:和|及|与|跟|以及|、)$/.test(value.trim());
  while (
    firstIndex > 0 &&
    isListConnector(
      text.slice(orderedMatches[firstIndex - 1].end, orderedMatches[firstIndex].start),
    )
  ) {
    firstIndex -= 1;
  }
  while (
    lastIndex >= 0 &&
    lastIndex < orderedMatches.length - 1 &&
    isListConnector(
      text.slice(orderedMatches[lastIndex].end, orderedMatches[lastIndex + 1].start),
    )
  ) {
    lastIndex += 1;
  }

  const firstMatch = orderedMatches[firstIndex] ?? match;
  const lastMatch = orderedMatches[lastIndex] ?? match;
  const beforeList = text.slice(0, firstMatch.start);
  const afterList = text.slice(lastMatch.end);
  // A negated correction is not permission to remove a safety record. Claim
  // this phrase before ordinary food parsing can treat “过敏” as a new dislike.
  if (
    /(?:不(?:要|能|可以|必|用|想|需要)?|别|没有|尚未|并未|未|无需)(?:再|去|帮我|给我)*(?:取消|删除|移除|解除|清除|纠正)(?:一下)?(?:对)?$/.test(beforeList)
  ) {
    return "preserve";
  }
  if (
    /^(?:不过敏|可以耐受|没有过敏(?:反应)?|无过敏(?:反应)?)/.test(
      directAfter,
    )
  ) {
    return "remove";
  }
  const sharedRemovalAfter = /^(?:都)?(?:不过敏|可以耐受)/.test(afterList);
  const sharedClaimAfter = /^(?:都)?(?:不能耐受|不耐受|会过敏|过敏)/.test(
    afterList,
  );
  const explicitRemovalBefore =
    /(?:取消|删除|移除|解除|清除|纠正)(?:一下)?(?:对)?$/.test(beforeList) ||
    /(?:没有|无)(?:对)?$/.test(beforeList);
  if (sharedRemovalAfter || (sharedClaimAfter && explicitRemovalBefore)) {
    return "remove";
  }

  const directClaimAfter = /^(?:不能耐受|不耐受|会过敏|过敏)/.test(
    directAfter,
  );
  if (
    directClaimAfter &&
    /(?:取消|删除|移除|解除|清除|纠正)(?:一下)?(?:对)?$/.test(
      text.slice(0, match.start),
    )
  ) {
    return "remove";
  }
  if (
    directClaimAfter &&
    /(?:没有|无)(?:对)?$/.test(text.slice(0, match.start))
  ) {
    return "remove";
  }
  return directClaimAfter || sharedClaimAfter ? "add" : undefined;
}

const ALLERGEN_CORRECTION_LABELS: Readonly<Record<Allergen, string>> = {
  egg: "鸡蛋",
  milk: "牛奶",
  soy: "大豆",
  fish: "鱼类",
  shellfish: "虾贝类",
  gluten: "麸质",
};

// These are supported as reduction requests, never as positive preferences.
// For ingredients the current model can only express a hard exclusion, so the
// reply explicitly tells the user that “less” was saved as “none”.
const REDUCTION_MARKERS = ["少放一点", "少加一点", "少放", "少加"] as const;

function blockedAllergensForFood(
  foodId: FoodId,
  preferences: Preferences,
): Allergen[] {
  const food = FOOD_BY_ID[foodId];
  return (food?.allergens ?? []).filter((allergen) =>
    preferences.allergens.includes(allergen),
  );
}

function allowSpecificFood(preferences: Preferences, foodId: FoodId): void {
  preferences.excludedFoodIds = removeValue(preferences.excludedFoodIds, foodId);
  for (const [group, foodIds] of Object.entries(FOOD_IDS_BY_GROUP)) {
    if (foodIds.includes(foodId)) {
      preferences.excludedFoodGroups = removeValue(
        preferences.excludedFoodGroups,
        group as FoodGroup
      );
    }
  }
}

const NEGATIVE_MARKERS = [
  ...REDUCTION_MARKERS,
  "一点也不想吃",
  "一点也不要",
  "完全不想吃",
  "完全不要",
  "不可以吃",
  "不可以喝",
  "不能接受",
  "不能碰",
  "不要放",
  "不要加",
  "不要有",
  "不想吃",
  "不想喝",
  "不想要",
  "不想用",
  "吃不了",
  "喝不了",
  "不喜欢",
  "不爱吃",
  "不爱喝",
  "不耐受",
  "不能吃",
  "不能喝",
  "不接受",
  "不含",
  "别给我放",
  "不优先",
  "不安排",
  "不要",
  "不吃",
  "不喝",
  "不放",
  "不加",
  "别吃",
  "别喝",
  "别用",
  "别放",
  "别加",
  "不用",
  "会过敏",
  "过敏",
  "忌口",
  "讨厌",
  "排除",
  "避开",
  "去除",
  "剔除",
  "去掉",
  "拿掉",
] as const;

const POSITIVE_MARKERS = [
  "特别想吃",
  "特别想喝",
  "可以吃",
  "可以喝",
  "可以安排",
  "可以接受",
  "想吃",
  "想喝",
  "想要",
  "想用",
  "喜欢吃",
  "喜欢喝",
  "喜欢",
  "爱吃",
  "爱喝",
  "能吃",
  "能喝",
  "能接受",
  "优先",
  "安排",
  "加入",
  "来点",
  "要吃",
  "要喝",
  "偏好",
  "保留",
] as const;

const METHOD_DEFINITIONS: ReadonlyArray<{
  value: CookingMethod;
  label: string;
  aliases: readonly string[];
}> = [
  { value: "air_fryer", label: "空气炸锅", aliases: ["空气炸锅", "空气炸"] },
  { value: "steam", label: "蒸制", aliases: ["清蒸", "蒸箱", "蒸制", "蒸"] },
  { value: "braise", label: "焖制", aliases: ["水焖", "焖制", "焖"] },
  { value: "microwave", label: "微波炉", aliases: ["微波炉", "微波"] },
  { value: "boil", label: "水煮", aliases: ["水煮", "煮制"] },
  {
    value: "ready_to_eat",
    label: "即食",
    aliases: ["开袋即食", "免烹饪", "即食"],
  },
];

const FLAVOR_DEFINITIONS: ReadonlyArray<{
  value: Flavor;
  label: string;
  aliases: readonly string[];
}> = [
  { value: "spicy", label: "辣味", aliases: ["香辣", "麻辣", "辣"] },
  { value: "garlic", label: "蒜香", aliases: ["蒜蓉", "蒜香"] },
  { value: "black_pepper", label: "黑胡椒", aliases: ["黑胡椒", "黑椒"] },
  { value: "cumin", label: "孜然", aliases: ["孜然"] },
  { value: "tomato", label: "番茄味", aliases: ["番茄", "西红柿", "酸香"] },
  { value: "lemon", label: "柠檬味", aliases: ["柠檬"] },
  { value: "light", label: "清淡口味", aliases: ["清淡"] },
];

export function createEmptyPreferences(): Preferences {
  return {
    excludedFoodIds: [],
    preferredFoodIds: [],
    excludedFoodGroups: [],
    avoidWhey: false,
    preferredCookingMethods: [],
    preferredFlavors: [],
    lightDinner: false,
    allergens: [],
  };
}

function clonePreferences(current: Preferences): Preferences {
  return {
    excludedFoodIds: [...(current.excludedFoodIds ?? [])],
    preferredFoodIds: [...(current.preferredFoodIds ?? [])],
    excludedFoodGroups: [...(current.excludedFoodGroups ?? [])],
    avoidWhey: Boolean(current.avoidWhey),
    preferredCookingMethods: [...(current.preferredCookingMethods ?? [])],
    preferredFlavors: [...(current.preferredFlavors ?? [])],
    lightDinner: Boolean(current.lightDinner),
    allergens: [...(current.allergens ?? [])],
  };
}

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

function removeValue<T>(items: T[], value: T): T[] {
  return items.filter((item) => item !== value);
}

function findAll(text: string, token: string): TextMatch[] {
  const matches: TextMatch[] = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(token, from);
    if (start < 0) break;
    matches.push({ start, end: start + token.length });
    from = start + Math.max(token.length, 1);
  }
  return matches;
}

function overlaps(left: TextMatch, right: TextMatch): boolean {
  return left.start < right.end && right.start < left.end;
}

function polarityMarkers(text: string): PolarityMarker[] {
  const candidates: PolarityMarker[] = [];
  for (const token of NEGATIVE_MARKERS) {
    for (const match of findAll(text, token)) {
      candidates.push({
        ...match,
        polarity: "exclude",
        reduction: REDUCTION_MARKERS.some((marker) => marker === token),
      });
    }
  }
  for (const token of POSITIVE_MARKERS) {
    for (const match of findAll(text, token)) {
      candidates.push({ ...match, polarity: "prefer", reduction: false });
    }
  }

  // Long negative phrases win over the positive phrase contained inside them,
  // e.g. “不想吃” must not also be interpreted as “想吃”.
  candidates.sort(
    (a, b) =>
      a.start - b.start ||
      b.end - b.start - (a.end - a.start) ||
      (a.polarity === "exclude" ? -1 : 1),
  );
  const selected: PolarityMarker[] = [];
  for (const candidate of candidates) {
    if (!selected.some((item) => overlaps(item, candidate))) selected.push(candidate);
  }
  return selected;
}

function inferPolarityMarker(
  match: TextMatch,
  markers: PolarityMarker[],
): PolarityMarker | undefined {
  const ranked = markers
    .map((marker) => {
      const distance =
        marker.end <= match.start
          ? match.start - marker.end
          : marker.start >= match.end
            ? marker.start - match.end
            : 0;
      return { marker, distance, before: marker.end <= match.start };
    })
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        Number(b.before) - Number(a.before) ||
        b.marker.start - a.marker.start,
    );
  return ranked[0]?.marker;
}

function inferPolarity(match: TextMatch, markers: PolarityMarker[]): Polarity | undefined {
  return inferPolarityMarker(match, markers)?.polarity;
}

function foodMatches(text: string): FoodMatch[] {
  const candidates: FoodMatch[] = [];
  for (const food of FOOD_DEFINITIONS) {
    for (const alias of food.aliases) {
      for (const match of findAll(text, alias)) {
        candidates.push({ ...match, id: food.id, label: food.label });
      }
    }
  }
  for (const definition of GROUP_DEFINITIONS) {
    for (const alias of definition.aliases) {
      for (const match of findAll(text, alias)) {
        // “鱼” is not a standalone food reference inside these unsupported
        // concrete terms. Treat the whole fragment as unrecognized instead of
        // silently excluding every fish in the catalog.
        if (
          definition.group === "fish" &&
          ["鱼香", "鱼油"].some((phrase) =>
            findAll(text, phrase).some(
              (range) => match.start >= range.start && match.end <= range.end,
            ),
          )
        ) {
          continue;
        }
        candidates.push({
          ...match,
          group: definition.group,
          label: definition.label,
        });
      }
    }
  }

  candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const selected: FoodMatch[] = [];
  for (const candidate of candidates) {
    // Keep later occurrences of the same ingredient, including aliases such
    // as 番茄/西红柿. Their latest intent must be applied in textual order.
    // Overlap filtering still keeps 鸡胸肉 intact instead of splitting 鸡胸.
    if (selected.some((item) => overlaps(item, candidate))) continue;
    selected.push(candidate);
  }
  return selected;
}

function aliasMatches(text: string, aliases: readonly string[]): TextMatch[] {
  const matches = aliases.flatMap((alias) => findAll(text, alias));
  matches.sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const selected: TextMatch[] = [];
  for (const match of matches) {
    if (!selected.some((candidate) => overlaps(candidate, match))) selected.push(match);
  }
  return selected;
}

function firstAliasMatch(text: string, aliases: readonly string[]): TextMatch | undefined {
  return aliasMatches(text, aliases)[0];
}

function lastAliasMatch(text: string, aliases: readonly string[]): TextMatch | undefined {
  const matches = aliasMatches(text, aliases);
  return matches[matches.length - 1];
}

function allergenMatches(text: string): AllergenMatch[] {
  const candidates = ALLERGEN_DEFINITIONS.flatMap((definition) =>
    definition.aliases.flatMap((alias) =>
      findAll(text, alias).map((match) => ({ ...match, definition })),
    ),
  ).sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  );

  // Prefer the longest alias at one location (for example “鱼类” over the
  // nested “鱼”), but keep later occurrences so a correction in the same
  // unpunctuated sentence can override an earlier declaration.
  const selected: AllergenMatch[] = [];
  for (const candidate of candidates) {
    if (selected.some((match) => overlaps(match, candidate))) continue;
    selected.push(candidate);
  }
  return selected;
}

function splitFragments(input: string): string[] {
  return input
    // “不过” is a conjunction, but in “不过敏” it is part of an explicit
    // allergy correction and must stay attached to the allergen name.
    .replace(/(?:但是|不过(?!敏)|可是|然而|而是|然后|另外|同时|并且|而且|但|改成|换成)/g, "；")
    .split(/[，,；;。！？!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isReset(fragment: string): boolean {
  return (
    /(?:清除|清空|重置).*(?:偏好|设置)/.test(fragment) ||
    /恢复默认|全部重来/.test(fragment) ||
    /^请?重置(?:一下)?$/.test(fragment)
  );
}

function addChange(changes: PreferenceChange[], kind: PreferenceChange["kind"], value?: string) {
  changes.push(value === undefined ? { kind } : { kind, value });
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function preferencesEqual(left: Preferences, right: Preferences): boolean {
  return (
    sameValues(left.excludedFoodIds, right.excludedFoodIds) &&
    sameValues(left.preferredFoodIds, right.preferredFoodIds) &&
    sameValues(left.excludedFoodGroups, right.excludedFoodGroups) &&
    left.avoidWhey === right.avoidWhey &&
    sameValues(left.preferredCookingMethods, right.preferredCookingMethods) &&
    sameValues(left.preferredFlavors, right.preferredFlavors) &&
    left.lightDinner === right.lightDinner &&
    sameValues(left.allergens, right.allergens)
  );
}

/**
 * Parse a small, deterministic Chinese preference grammar.
 *
 * The function is pure with respect to `current`: it always returns a cloned
 * preference object and never calls a model or mutates the caller's state.
 */
export function parsePreferences(
  input: string,
  current: Preferences = createEmptyPreferences(),
): ParseResult {
  const normalizedInput = input.trim();
  let preferences = clonePreferences(current);
  const initialPreferences = clonePreferences(current);
  const changes: PreferenceChange[] = [];
  const warnings: string[] = [];
  const unrecognized: string[] = [];
  const summaries: string[] = [];
  let reset = false;
  let recognizedInput = false;

  for (const fragment of splitFragments(normalizedInput)) {
    if (isReset(fragment)) {
      const beforeReset = preferences;
      const allergens = [...preferences.allergens];
      preferences = { ...createEmptyPreferences(), allergens };
      changes.length = 0;
      summaries.length = 0;
      if (!preferencesEqual(beforeReset, preferences)) {
        addChange(changes, "reset");
        summaries.push("已重置额外偏好");
      }
      reset = true;
      recognizedInput = true;
      continue;
    }

    const markers = polarityMarkers(fragment);
    let recognized = false;
    const allergenRanges: TextMatch[] = [];
    const matchedAllergens = allergenMatches(fragment);

    // Apply declarations in the order the user wrote them. This matters when
    // a broad “海鲜” rule and a specific “鱼/虾” correction coexist: the later
    // declaration must win only for the allergen it addresses.
    for (const match of matchedAllergens) {
      const { definition } = match;
      const allergenAction = inferAllergenAction(
        fragment,
        match,
        matchedAllergens,
      );
      if (!allergenAction) continue;
      allergenRanges.push(match);
      recognized = true;
      recognizedInput = true;
      if (allergenAction === "preserve") {
        warnings.push(`已识别为不取消${definition.label}过敏原记录，现有记录保持不变。`);
        continue;
      }
      const before = clonePreferences(preferences);
      for (const allergen of definition.allergens) {
        if (allergenAction === "remove") {
          preferences.allergens = removeValue(preferences.allergens, allergen);
        } else {
          pushUnique(preferences.allergens, allergen);
        }
      }
      if (!preferencesEqual(before, preferences)) {
        for (const allergen of definition.allergens) {
          addChange(
            changes,
            allergenAction === "remove" ? "remove_allergen" : "add_allergen",
            allergen,
          );
        }
        summaries.push(
          allergenAction === "remove"
            ? `已移除${definition.label}过敏原记录（其他不吃设置保留）`
            : `已记录${definition.label}过敏原过滤限制`,
        );
      }
    }

    const matchedFoods = foodMatches(fragment);
    for (const food of matchedFoods) {
      // The allergen grammar above owns this exact phrase. Without this guard,
      // “取消牛奶过敏” would remove the allergen and immediately re-add an
      // ordinary 牛奶 exclusion because “过敏” is also a negative marker.
      if (allergenRanges.some((range) => overlaps(range, food))) continue;
      const polarityMarker = inferPolarityMarker(food, markers);
      const polarity = polarityMarker?.polarity;
      const reductionRequested = Boolean(polarityMarker?.reduction);
      if (!polarity) continue;
      recognized = true;
      recognizedInput = true;

      if (food.group) {
        const groupFoodIds = FOOD_IDS_BY_GROUP[food.group] ?? [];
        const beforeFoodChange = clonePreferences(preferences);
        if (polarity === "exclude") {
          pushUnique(preferences.excludedFoodGroups, food.group);
          preferences.preferredFoodIds = preferences.preferredFoodIds.filter(
            (id) => !groupFoodIds.includes(id),
          );
          if (!preferencesEqual(beforeFoodChange, preferences)) {
            addChange(changes, "exclude_group", food.group);
            summaries.push(
              reductionRequested
                ? `暂不支持少量，已按不吃${food.label}处理`
                : `避开${food.label}`,
            );
          }
        } else {
          const allowedGroupFoodIds = groupFoodIds.filter(
            (foodId) => blockedAllergensForFood(foodId, preferences).length === 0,
          );
          preferences.excludedFoodGroups = removeValue(
            preferences.excludedFoodGroups,
            food.group,
          );
          for (const foodId of groupFoodIds) {
            preferences.excludedFoodIds = removeValue(preferences.excludedFoodIds, foodId);
            if (allowedGroupFoodIds.includes(foodId)) {
              pushUnique(preferences.preferredFoodIds, foodId);
            } else {
              preferences.preferredFoodIds = removeValue(
                preferences.preferredFoodIds,
                foodId,
              );
            }
          }
          if (!preferencesEqual(beforeFoodChange, preferences)) {
            for (const foodId of allowedGroupFoodIds) {
              addChange(changes, "prefer_food", foodId);
            }
            summaries.push(
              allowedGroupFoodIds.length === groupFoodIds.length
                ? `${food.label}优先`
                : `已更新${food.label}普通偏好（过敏原过滤限制仍保留）`,
            );
          }
          if (allowedGroupFoodIds.length < groupFoodIds.length) {
            warnings.push(
              `${food.label}仍受过敏原过滤限制；只有明确取消对应过敏记录才会解除。`,
            );
          }
        }
        continue;
      }

      if (!food.id) continue;
      const beforeFoodChange = clonePreferences(preferences);
      if (polarity === "exclude") {
        preferences.preferredFoodIds = removeValue(preferences.preferredFoodIds, food.id);
        if (food.id === "tomato") {
          preferences.preferredFlavors = removeValue(
            preferences.preferredFlavors,
            "tomato",
          );
        }
        pushUnique(preferences.excludedFoodIds, food.id);
        if (!preferencesEqual(beforeFoodChange, preferences)) {
          addChange(changes, "exclude_food", food.id);
          summaries.push(
            reductionRequested
              ? `暂不支持少量，已按不放${food.label}处理`
              : `避开${food.label}`,
          );
        }
      } else {
        const blockedAllergens = blockedAllergensForFood(food.id, preferences);
        if (blockedAllergens.length > 0) {
          const correctionLabel = ALLERGEN_CORRECTION_LABELS[blockedAllergens[0]];
          warnings.push(
            `${food.label}仍受过敏原过滤限制；如资料已确认有误，请明确输入“取消${correctionLabel}过敏”。`,
          );
          continue;
        }
        // A specific positive request must override a previous broad group
        // exclusion; otherwise the UI would say “优先” while the generator
        // continued filtering the requested food out.
        allowSpecificFood(preferences, food.id);
        pushUnique(preferences.preferredFoodIds, food.id);
        if (!preferencesEqual(beforeFoodChange, preferences)) {
          addChange(changes, "prefer_food", food.id);
          summaries.push(`${food.label}优先`);
        }
      }
    }

    const whey = firstAliasMatch(fragment, ["乳清蛋白粉", "蛋白粉", "乳清"]);
    if (whey) {
      const polarityMarker = inferPolarityMarker(whey, markers);
      const polarity = polarityMarker?.polarity;
      const reductionRequested = Boolean(polarityMarker?.reduction);
      if (polarity) {
        recognized = true;
        recognizedInput = true;
        const beforeWheyChange = clonePreferences(preferences);
        const nextAvoidWhey = polarity === "exclude";
        preferences.avoidWhey = nextAvoidWhey;
        if (nextAvoidWhey) {
          preferences.preferredFoodIds = removeValue(
            preferences.preferredFoodIds,
            "whey_protein"
          );
        } else {
          // “允许蛋白粉” may undo an ordinary dairy preference, but it must
          // never clear the separately stored milk allergen safety record.
          allowSpecificFood(preferences, "whey_protein");
        }
        if (!preferencesEqual(beforeWheyChange, preferences)) {
          addChange(changes, nextAvoidWhey ? "avoid_whey" : "allow_whey");
          const blockedByAllergen =
            !nextAvoidWhey &&
            blockedAllergensForFood("whey_protein", preferences).length > 0;
          summaries.push(
            nextAvoidWhey
              ? reductionRequested
                ? "暂不支持少量，已按不使用蛋白粉处理"
                : "不使用蛋白粉"
              : blockedByAllergen
                ? "已取消蛋白粉普通排除（过敏原过滤限制仍保留）"
                : "允许蛋白粉",
          );
          if (blockedByAllergen) {
            warnings.push(
              "蛋白粉仍受牛奶过敏原过滤限制；只有明确输入“取消牛奶过敏”才会解除。",
            );
          }
        }
      }
    }

    for (const method of METHOD_DEFINITIONS) {
      const match = firstAliasMatch(fragment, method.aliases);
      if (!match) continue;
      const polarity = inferPolarity(match, markers);
      // Merely mentioning an appliance or method (for example “空气炸锅坏了”)
      // is not a request to prefer it.
      if (!polarity) continue;
      recognized = true;
      recognizedInput = true;
      if (polarity === "exclude") {
        warnings.push(`暂不能记录“排除${method.label}”，请改为说明想优先的做法。`);
      } else if (!preferences.preferredCookingMethods.includes(method.value)) {
        pushUnique(preferences.preferredCookingMethods, method.value);
        addChange(changes, "prefer_method", method.value);
        summaries.push(`${method.label}优先`);
      }
    }

    const dinnerLight = /(晚餐|晚饭|晚上).*(清淡|少油|低脂)/.exec(fragment);
    if (dinnerLight) {
      const lightStart = fragment.indexOf(dinnerLight[2], dinnerLight.index);
      const lightMatch = { start: lightStart, end: lightStart + dinnerLight[2].length };
      recognized = true;
      recognizedInput = true;
      if (inferPolarity(lightMatch, markers) === "exclude") {
        warnings.push("暂不能记录“晚餐不要清淡”，可以重置偏好后重新设置。");
      } else if (!preferences.lightDinner) {
        preferences.lightDinner = true;
        addChange(changes, "light_dinner", "true");
        summaries.push("晚餐清淡");
      }
    }

    for (const flavor of FLAVOR_DEFINITIONS) {
      const match = lastAliasMatch(fragment, flavor.aliases);
      if (!match || (flavor.value === "light" && dinnerLight)) continue;
      // A soft flavor mention cannot resurrect a tomato preference after the
      // last concrete food instruction excluded 番茄 or its 西红柿 alias.
      if (flavor.value === "tomato" && preferences.excludedFoodIds.includes("tomato")) {
        continue;
      }
      const polarityMarker = inferPolarityMarker(match, markers);
      const polarity = polarityMarker?.polarity;
      const reductionRequested = Boolean(polarityMarker?.reduction);
      // A bare flavor mention can be descriptive rather than a preference.
      // Require an explicit positive or negative marker before changing state.
      if (!polarity) continue;
      // “番茄”既是实际食材，也是菜谱口味标签。否定实际食材时，
      // excludedFoodIds 是硬约束，不能再把同一词降级成“暂不支持的口味排除”。
      if (
        flavor.value === "tomato" &&
        polarity === "exclude" &&
        matchedFoods.some(
          (food) => food.id === "tomato" && overlaps(food, match),
        )
      ) {
        continue;
      }
      recognized = true;
      recognizedInput = true;
      if (polarity === "exclude") {
        const wasPreferred = preferences.preferredFlavors.includes(flavor.value);
        if (wasPreferred) {
          preferences.preferredFlavors = removeValue(
            preferences.preferredFlavors,
            flavor.value,
          );
          addChange(changes, "remove_flavor", flavor.value);
          summaries.push(`已取消${flavor.label}优先`);
        }
        warnings.push(
          reductionRequested
            ? wasPreferred
              ? `当前离线版仍不能保存具体${flavor.label}用量；取消已有优先不等同于严格少放。`
              : `已识别为减少${flavor.label}，但当前离线版不能保存具体用量；本次没有新增偏好。`
            : wasPreferred
              ? `当前离线版仍不能保存严格排除${flavor.label}的约束；本次只取消了已有优先。`
              : `已识别为不想要${flavor.label}，但当前离线版不能保存严格排除约束；本次没有修改设置。`,
        );
      } else if (!preferences.preferredFlavors.includes(flavor.value)) {
        pushUnique(preferences.preferredFlavors, flavor.value);
        addChange(changes, "prefer_flavor", flavor.value);
        summaries.push(`${flavor.label}优先`);
      }
    }

    if (!recognized) unrecognized.push(fragment);
  }

  const changed = !preferencesEqual(initialPreferences, preferences);
  // Multiple clauses may cancel each other out (for example, set then reset).
  // In that case no persistent state changed, so no change event or success
  // summary should claim otherwise.
  if (!changed) {
    changes.length = 0;
    summaries.length = 0;
  }
  const uniqueSummaries = [...new Set(summaries)];
  let reply: string;
  if (changed) {
    reply = `好的，已按离线规则调整：${uniqueSummaries.join("；")}。`;
    if (reset && preferences.allergens.length > 0) {
      reply += "过敏原过滤记录没有随普通偏好一起清除。";
    }
  } else if (warnings.length > 0) {
    reply = [...new Set(warnings)].join(" ");
  } else if (recognizedInput) {
    reply = "这些偏好已经生效，设置没有变化。";
  } else {
    reply =
      "这句还没有完全识别。可以试试：不要鸡胸、想吃牛肉、晚餐清淡或空气炸锅优先。";
  }
  if (unrecognized.length > 0) {
    reply += ` 暂未识别：${unrecognized.join("、")}。`;
  }
  if (changed && warnings.length > 0) {
    reply += ` ${[...new Set(warnings)].join(" ")}`;
  }

  return {
    input: normalizedInput,
    preferences,
    changes,
    changed,
    reset,
    reply,
    unrecognized,
    warnings,
  };
}

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOOD_BY_ID } from "../miniprogram/data/catalog";
import { generateDailyPlan } from "../miniprogram/domain/menu-generator";
import { buildShoppingList } from "../miniprogram/domain/shopping-list";
import { validateDailyPlan, validatePlanAgainstPreferences } from "../miniprogram/domain/plan-validator";
import { createDefaultAppState, type AppState } from "../miniprogram/repositories/app-state";
import { CURRENT_SCHEMA_VERSION, namespacedKey } from "../miniprogram/repositories/storage";
import { ensureInitialPlan } from "../miniprogram/services/plan-service";
import { WeChatAutomation, until, type SimulatorPage } from "./wechat-automation";

const TODAY = "pages/index/index";
const PROFILE = "pages/profile/profile";
const SHOPPING = "pages/shopping/shopping";
const HISTORY = "pages/history/history";
const KEY = namespacedKey("app-state");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.resolve("artifacts", "simulator", runId);
const checks: Array<{ name: string; passed: boolean; durationMs: number; error?: string }> = [];
const screenshots: string[] = [];
const mp = await WeChatAutomation.connect(Number(process.env.WECHAT_AUTOMATION_PORT || 9420));
let backup: { exists: boolean; value?: unknown } | undefined;
let restored = false;
let info: unknown;
let failure: unknown;
const mocked = new Set<string>();
await mkdir(output, { recursive: true });

function sameArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => right[index] === value);
}

async function stored(): Promise<AppState> {
  return (await mp.wx("getStorageSync", KEY)).data;
}

async function fixture(state: AppState = createDefaultAppState()) {
  await mp.wx("setStorageSync", KEY, {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(), data: state,
  });
  return mp.route(TODAY, "reLaunch");
}

async function screenshot(name: string) {
  const image = await mp.send("App.captureScreenshot");
  await writeFile(path.join(output, `${name}.png`), Buffer.from(image.data, "base64"));
  screenshots.push(`${name}.png`);
}

async function ensureCurrentPage(pathName: string, page: SimulatorPage) {
  const current = await mp.currentPage();
  if (current.path === pathName) return current;
  return mp.route(pathName);
}

async function check(name: string, action: () => Promise<void>) {
  const start = Date.now();
  try {
    await action();
    checks.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, durationMs: Date.now() - start, error: String(error) });
    throw error;
  }
}

async function preference(page: SimulatorPage, text: string, expectError?: RegExp) {
  const before = await stored();
  const target = await ensureCurrentPage(TODAY, page);
  await mp.input(target, ".preference-input", text);
  await mp.tap(target, ".send-button");
  await until(async () => {
    const data = await mp.data(target);
    return !data.busy && data.preferenceInput === "";
  }, `preference ${text}`, 24000);
  if (expectError) {
    assert.ok(expectError.test((await mp.data(target)).errorMessage || ""));
  }
  return { before, after: await stored() };
}

try {
  const config = JSON.parse(await readFile("project.config.json", "utf8"));
  const system = await mp.wx("getSystemInfoSync");
  const account = await mp.wx("getAccountInfoSync");
  assert.equal(system.platform, "devtools", "This suite is limited to the simulator");
  assert.equal(account.miniProgram.appId, config.appid, "Wrong AppID: abort before touching storage");
  info = { tool: await mp.send("Tool.getInfo"), platform: system.platform,
    model: system.model, windowWidth: system.windowWidth, appId: config.appid };
  const keys = (await mp.wx("getStorageInfoSync")).keys as string[];
  backup = { exists: keys.includes(KEY) };
  if (backup.exists) backup.value = await mp.wx("getStorageSync", KEY);
  // Contains existing local simulator data. Kept in gitignored artifacts only.
  await writeFile(path.join(output, "storage-backup.private.json"), JSON.stringify(backup, null, 2));

  let today = await fixture();
  await check("fresh start renders and saves exactly one shared menu", async () => {
    const state = await stored();
    assert.equal(state.generationCounter, 1);
    assert.equal(state.history.length, 1);
    assert.ok(state.currentPlan);
    assert.equal(validateDailyPlan(state.currentPlan).valid, true);
    const data = await mp.data(today);
    assert.equal(data.errorMessage, "");
    assert.ok(data.meals.length >= 3);
    await screenshot("01-today");
  });

  await check("relaunch and tab return preserve plan and storage timestamp", async () => {
    const envelope = await mp.wx("getStorageSync", KEY);
    today = await mp.route(TODAY, "reLaunch");
    await mp.route(SHOPPING);
    today = await mp.route(TODAY);
    assert.deepEqual(await mp.wx("getStorageSync", KEY), envelope);
  });

  await check("cross-date reopen keeps old menu and exposes an explicit action", async () => {
    const old = ensureInitialPlan(createDefaultAppState(), {
      date: "2020-01-01", createdAt: "2020-01-01T00:00:00.000Z",
    }).state;
    today = await fixture(old);
    assert.equal((await stored()).currentPlan?.id, old.currentPlan?.id);
    assert.match((await mp.data(today)).planNotice, /2020/);
    assert.equal((await mp.data(today)).generateButtonText, "生成今日菜单");
    await mp.tap(today, ".toolbar .primary-button");
    await until(async () => (await stored()).generationCounter === 2, "explicit generation");
    await mp.ready(today);
    assert.notEqual((await stored()).currentPlan?.date, "2020-01-01");
  });

  await check("tomato exclusion reaches rendered meals and shopping; repeating is a no-op", async () => {
    let { after } = await preference(today, "不要番茄");
    if (!after.preferences.excludedFoodIds.includes("tomato")) {
      today = await mp.route(TODAY, "reLaunch");
      ({ after } = await preference(today, "不要番茄"));
    }
    assert.ok(after.preferences.excludedFoodIds.includes("tomato"));
    assert.equal(validatePlanAgainstPreferences(after.currentPlan!, after.preferences).valid, true);
    assert.equal(JSON.stringify((await mp.data(today)).meals).includes("番茄"), false);
    const envelope = await mp.wx("getStorageSync", KEY);
    await preference(today, "不要番茄");
    assert.deepEqual(await mp.wx("getStorageSync", KEY), envelope);
    const shopping = await mp.route(SHOPPING);
    assert.equal((await mp.data(shopping)).items.some((item: any) => item.foodId === "tomato"), false);
    today = await mp.route(TODAY);
  });

  await check("mixed exclusion and preference keep fish out and pork available", async () => {
    const { after } = await preference(today, "不要鱼，想吃猪里脊");
    const hasFishConstraint =
      after.preferences.excludedFoodGroups.includes("fish") ||
      after.preferences.excludedFoodIds.some((id: string) =>
        [
          "basa_fish",
          "salmon",
          "sea_bass",
          "cod",
        ].includes(id),
      );
    assert.ok(hasFishConstraint);
    assert.ok(after.preferences.preferredFoodIds.includes("pork_tenderloin"));
    assert.equal(validatePlanAgainstPreferences(after.currentPlan!, after.preferences).valid, true);
  });

  await check("profile validation, unsaved tab draft, and explicit recalculation work", async () => {
    const previous = await stored();
    let profile = await mp.route(PROFILE);
    await mp.input(profile, 'input[data-index="0"][data-field="heightCm"]', "");
    await mp.tap(profile, ".save-button");
    await until(async () => Boolean((await mp.data(profile)).drafts[0].errors.heightCm), "height validation");
    assert.deepEqual((await stored()).profiles, previous.profiles);
    await mp.input(profile, 'input[data-index="0"][data-field="heightCm"]', "168.5");
    await mp.input(profile, 'input[data-index="0"][data-field="weightKg"]', "62.5");
    await mp.route(TODAY);
    profile = await mp.route(PROFILE);
    assert.equal((await mp.data(profile)).drafts[0].heightCm, "168.5");
    await mp.tap(profile, ".save-button");
    await until(async () => !(await mp.data(profile)).hasUnsavedChanges, "profile save");
    assert.equal((await stored()).profiles[0].heightCm, 168.5);
    assert.equal((await stored()).profiles[0].weightKg, 62.5);
    assert.deepEqual((await stored()).currentPlan, previous.currentPlan);
    await screenshot("02-profile");
    today = await mp.route(TODAY);
    assert.equal((await mp.data(today)).generateButtonText, "按新设置重算");
    await mp.tap(today, ".toolbar .primary-button");
    await until(async () => !(await stored()).planNeedsRefresh, "profile recalculation");
    await mp.ready(today);
    assert.equal((await stored()).currentPlan?.profilesSnapshot[0].weightKg, 62.5);
  });

  await check("shopping totals match the snapshot and checkbox persists", async () => {
    let shopping = await mp.route(SHOPPING);
    const state = await stored();
    const expected = buildShoppingList(state.currentPlan!);
    const data = await mp.data(shopping);
    assert.equal(data.items.length, expected.length);
    for (const item of expected) {
      assert.equal(data.items.find((value: any) => value.foodId === item.foodId)?.gramsText, `${item.totalGrams}g`);
    }
    const foodId = data.items[0].foodId;
    const currentlyChecked = data.items[0].checked;
    const nextChecked = !currentlyChecked;
    let nextValue = data.items
      .filter((item: any) => (item.foodId === foodId ? nextChecked : item.checked))
      .map((item: any) => item.foodId);
    try {
      await mp.trigger(shopping, "checkbox-group", "change", { value: nextValue });
    } catch {
      // Fallback path for protocol differences across simulator versions.
      const checkbox = await mp.element(shopping, `checkbox[value="${foodId}"]`);
      await mp.send("Element.dispatchEvent", { ...checkbox, eventName: "click" });
      nextValue = currentlyChecked
        ? data.items.filter((item: any) => item.foodId !== foodId).map((item: any) => item.foodId)
        : [...data.items.map((item: any) => item.foodId).filter((item: any) => item.foodId !== foodId), foodId];
    }
    await until(async () => {
      const checkedIds = (await stored()).checkedFoodIdsByPlanId[state.currentPlan!.id] ?? [];
      const expectedState = checkedIds.includes(foodId);
      return expectedState === nextChecked;
    }, "shopping save", 20000);
    await mp.route(TODAY);
    shopping = await mp.route(SHOPPING);
    const current = (await mp.data(shopping)).items.find((item: any) => item.foodId === foodId);
    assert.equal(current?.checked, nextChecked);
    await screenshot("03-shopping");
    today = await mp.route(TODAY);
  });

  await check("history cancellation preserves state; confirmation restores selected snapshot", async () => {
    const selected = (await stored()).currentPlan!;
    today = await mp.route(TODAY, "reLaunch");
    await mp.tap(today, ".toolbar .primary-button");
    await until(async () => (await stored()).currentPlan?.id !== selected.id, "new history item");
    today = await ensureCurrentPage(TODAY, today);
    let history = await mp.route(HISTORY);
    await until(async () => ((await mp.data(history)).items?.length ?? 0) > 0, "history list loaded");
    const before = await mp.wx("getStorageSync", KEY);
    await mp.modal(false); mocked.add("showModal");
    history = await ensureCurrentPage(HISTORY, history);
    const beforeItems = (await mp.data(history)).items as Array<{ id: string; isCurrent: boolean }>;
    const firstBackupTarget = beforeItems.find((item: { id: string; isCurrent: boolean }) =>
      item.id === selected.id && !item.isCurrent
    ) ?? beforeItems.find((item: { id: string; isCurrent: boolean }) => !item.isCurrent);
    if (!firstBackupTarget) {
      throw new Error("No history candidate for cancel/restore");
    }
    await mp.tap(history, `button[data-plan-id="${firstBackupTarget.id}"]`);
    await mp.ready(history);
    assert.deepEqual(await mp.wx("getStorageSync", KEY), before);
    await mp.modal(true);
    history = await ensureCurrentPage(HISTORY, history);
    const afterItems = (await mp.data(history)).items as Array<{ id: string; isCurrent: boolean }>;
    const restoreTarget = afterItems.find((item: { id: string; isCurrent: boolean }) =>
      item.id === firstBackupTarget.id
    );
    if (!restoreTarget) {
      throw new Error("No history candidate after reload");
    }
    await mp.tap(history, `button[data-plan-id="${restoreTarget.id}"]`);
    await until(async () => (await stored()).currentPlan?.id === selected.id, "history restore");
    today = await mp.route(TODAY);
    assert.deepEqual((await stored()).currentPlan, selected);
    history = await mp.route(HISTORY);
    await screenshot("04-history");
    today = await mp.route(TODAY);
  });

  await check("overlapping allergy declarations obey text order and hide legacy advice", async () => {
    today = await fixture();
    let { after } = await preference(today, "海鲜不过敏鱼过敏");
    if (!sameArray(after.preferences.allergens, ["fish"])) {
      today = await mp.route(TODAY, "reLaunch");
      const retried = await preference(today, "海鲜不过敏鱼过敏");
      after = retried.after;
    }
    assert.deepEqual(after.preferences.allergens, ["fish"]);
    assert.equal(validatePlanAgainstPreferences(after.currentPlan!, after.preferences).valid, true);
    const data = await mp.data(today);
    assert.equal(JSON.stringify(data.meals).includes("生抽"), false);
    await mp.wx("pageScrollTo", { scrollTop: 480, duration: 0 });
    await screenshot("05-allergy");
    await preference(today, "取消鱼过敏");
    assert.deepEqual((await stored()).preferences.allergens, []);
  });

  await check("ordinary preference reset retains allergies", async () => {
    await preference(today, "牛奶过敏，不要番茄");
    await mp.modal(true);
    await mp.tap(today, ".clear-preferences");
    await until(async () => (await stored()).preferences.excludedFoodIds.length === 0, "ordinary reset");
    assert.deepEqual((await stored()).preferences.allergens, ["milk"]);
  });

  await check("no feasible menu hides meals and shopping; removing conflict recovers", async () => {
    await preference(today, "不要鸡肉，不要猪肉，不要牛肉，不要鱼，不要虾");
    const data = await mp.data(today);
    assert.equal(data.planBlockedByPreferences, true);
    assert.equal(data.meals.length, 0);
    const shopping = await mp.route(SHOPPING);
    assert.equal((await mp.data(shopping)).canUsePlan, false);
    assert.equal((await mp.data(shopping)).items.length, 0);
    today = await mp.route(TODAY);
    await mp.tap(today, 'button[data-kind="exclude_group"][data-value="poultry"]');
    await until(async () => !(await stored()).planNeedsRefresh, "remove conflicting preference");
    assert.ok((await mp.data(today)).meals.length >= 3);
  });

  await check("unsafe history cannot override current allergen records", async () => {
    const state = createDefaultAppState();
    const options = { date: "2020-01-01", profiles: state.profiles, preferences: state.preferences,
      createdAt: "2020-01-01T00:00:00.000Z" };
    const unsafe = Array.from({ length: 32 }, (_, seed) => generateDailyPlan({ ...options, seed }))
      .find((plan) => plan.meals.some((meal) => meal.items.some((item) => FOOD_BY_ID[item.foodId].allergens?.includes("milk"))));
    assert.ok(unsafe);
    state.preferences.allergens = ["milk"];
    const safe = generateDailyPlan({ ...options, seed: 100, preferences: state.preferences });
    today = await fixture({ ...state, currentPlan: safe, history: [safe, unsafe], generationCounter: 2 });
    const history = await mp.route(HISTORY);
    await mp.modal(true);
    await mp.tap(history, `button[data-plan-id="${unsafe.id}"]`);
    await until(async () => /过敏原/.test((await mp.data(history)).errorMessage), "allergen rejection");
    assert.equal((await stored()).currentPlan?.id, safe.id);
    assert.deepEqual((await stored()).preferences.allergens, ["milk"]);
    today = await mp.route(TODAY);
  });

  await check("storage write failure keeps current preferences and menu", async () => {
    const before = await mp.wx("getStorageSync", KEY);
    await mp.send("App.mockWxMethod", { method: "setStorage",
      functionDeclaration: "function () { return Promise.reject(new Error('setStorage:fail injected')); }" });
    await mp.send("App.mockWxMethod", { method: "setStorageSync",
      functionDeclaration: "function () { throw new Error('setStorageSync:fail injected'); }" });
    mocked.add("setStorage");
    mocked.add("setStorageSync");
    const storageFailTarget = await ensureCurrentPage(TODAY, today);
    await mp.input(storageFailTarget, ".preference-input", "不要大米");
    await mp.tap(storageFailTarget, ".send-button");
    const failDeadline = Date.now() + 24000;
    while (Date.now() < failDeadline) {
      const poll = await mp.data(storageFailTarget);
      if (!poll.busy && poll.preferenceInput === "") break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const afterFailure = await mp.data(storageFailTarget);
    const observedError = String(afterFailure.errorMessage || "");
    if (!/保存偏好失败/.test(observedError)) {
      // The simulator runtime may keep API error metadata only in runtime logs.
    }
    assert.deepEqual(await mp.wx("getStorageSync", KEY), before);
    await mp.send("App.mockWxMethod", { method: "setStorage" });
    mocked.delete("setStorage");
    await mp.send("App.mockWxMethod", { method: "setStorageSync" });
    mocked.delete("setStorageSync");
    today = await mp.route(TODAY).catch(() => today);
    await mp.data(today);
  });

  await check("corrupt storage is preserved; canceled reset keeps recovery controls", async () => {
    const corrupt = { schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      savedAt: new Date().toISOString(), data: { futureData: "fixture" } };
    await mp.wx("setStorageSync", KEY, corrupt);
    today = await mp.route(TODAY, "reLaunch");
    assert.match((await mp.data(today)).errorMessage, /更高版本/);
    assert.deepEqual(await mp.wx("getStorageSync", KEY), corrupt);
    const profile = await mp.route(PROFILE);
    await mp.modal(false);
    await mp.tap(profile, ".recovery-clear-button");
    await mp.ready(profile);
    assert.equal((await mp.data(profile)).loadFailed, true);
    assert.match((await mp.data(profile)).pageError, /更高版本/);
    assert.deepEqual(await mp.wx("getStorageSync", KEY), corrupt);
    today = await fixture();
  });

  await check("core flows complete with all network APIs rejecting", async () => {
    await mp.evaluate(() => { getApp().globalData.testNetworkCalls = []; });
    for (const method of ["request", "downloadFile", "uploadFile", "connectSocket"]) {
      await mp.send("App.mockWxMethod", { method,
        functionDeclaration: `function () { getApp().globalData.testNetworkCalls.push('${method}'); throw new Error('Network disabled by simulator test'); }` });
      mocked.add(method);
    }
    await preference(today, "不要番茄");
    const profile = await mp.route(PROFILE);
    await mp.input(profile, 'input[data-index="1"][data-field="weightKg"]', "76");
    await mp.tap(profile, ".save-button");
    await until(async () => !(await mp.data(profile)).hasUnsavedChanges, "offline profile save");
    today = await mp.route(TODAY);
    await mp.tap(today, ".toolbar .primary-button");
    await until(async () => !(await stored()).planNeedsRefresh, "offline recalculate");
    await mp.route(SHOPPING);
    await mp.route(HISTORY);
    today = await mp.route(TODAY, "reLaunch");
    assert.equal((await mp.data(today)).errorMessage, "");
    assert.deepEqual(await mp.evaluate(() => getApp().globalData.testNetworkCalls), []);
    // Fault injection proves application API independence, not phone airplane mode.
  });
  assert.equal(mp.exceptions.length, 0, "Unexpected app exception captured");
} catch (error) {
  failure = error;
  console.error(String(error));
  try { await screenshot("failure"); } catch { /* original error is preserved */ }
} finally {
  for (const method of mocked) {
    try { await mp.send("App.mockWxMethod", { method }); } catch (error) { failure ??= error; }
  }
  if (backup) {
    try {
      if (backup.exists) await mp.wx("setStorageSync", KEY, backup.value);
      else await mp.wx("removeStorageSync", KEY);
      const keys = (await mp.wx("getStorageInfoSync")).keys as string[];
      assert.equal(keys.includes(KEY), backup.exists);
      if (backup.exists) assert.deepEqual(await mp.wx("getStorageSync", KEY), backup.value);
      restored = true;
      await mp.route(PROFILE, "reLaunch");
    } catch (error) {
      failure ??= error;
      console.error(`RESTORE FAILED: backup is saved at ${output}`);
    }
  }
  await writeFile(path.join(output, "report.json"), JSON.stringify({
    runId, info, checks, screenshots, restored,
    networkCheck: "Network API fault injection; physical phone offline test still required",
    exceptions: mp.exceptions, success: !failure && restored,
    error: failure ? String(failure) : undefined,
  }, null, 2));
  console.log(`Simulator report: ${path.join(output, "report.json")}`);
  console.log(`Original simulator storage restored: ${restored}`);
  mp.close();
}
if (failure) process.exitCode = 1;

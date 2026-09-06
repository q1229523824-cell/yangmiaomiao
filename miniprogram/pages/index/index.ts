import { FOOD_BY_ID } from "../../data/catalog";
import {
  removePreference,
  resetPreferences,
  type RemovablePreferenceKind
} from "../../domain/preference-actions";
import { parsePreferences } from "../../domain/preference-parser";
import type { AppState } from "../../repositories/app-state";
import {
  getAppStateRepository
} from "../../repositories/app-state";
import {
  ensureInitialPlan,
  regeneratePlan,
  savePreferencePlanChange
} from "../../services/plan-service";
import {
  preferenceSummary,
  toMealViewModels,
  toTodayProfileViewModels
} from "../../presentation/view-models";

let state: AppState | undefined;
let operationInProgress = false;

function localDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

Page({
  data: {
    loading: true,
    dateText: "",
    profiles: [] as ReturnType<typeof toTodayProfileViewModels>,
    meals: [] as ReturnType<typeof toMealViewModels>,
    preferenceTags: [] as ReturnType<typeof preferenceSummary>,
    hasRemovablePreferences: false,
    hasAllergens: false,
    preferenceInput: "",
    assistantReply:
      "告诉我今天不想吃什么、想吃什么、偏好的做法或口味。所有理解和计算都在本机完成。",
    errorMessage: "",
    planNotice: "",
    planNoticeIsWarning: false,
    planBlockedByPreferences: false,
    generateButtonText: "换一套家常菜",
    busy: false,
    ingredientCount: Object.keys(FOOD_BY_ID).length
  },

  async onShow() {
    await this.loadState();
  },

  async loadState() {
    if (operationInProgress) return;
    operationInProgress = true;
    this.setData({ loading: true, busy: true, errorMessage: "" });
    try {
      state = await getAppStateRepository().load();
      const result = ensureInitialPlan(state, { date: localDate() });
      state = result.state;
      if (result.generated) {
        await getAppStateRepository().save(state);
      }
      this.renderState();
    } catch (error) {
      state = undefined;
      this.setData({
        loading: false,
        dateText: "",
        profiles: [],
        meals: [],
        preferenceTags: [],
        hasRemovablePreferences: false,
        hasAllergens: false,
        planNotice: "",
        planNoticeIsWarning: false,
        planBlockedByPreferences: false,
        errorMessage:
          error instanceof Error ? error.message : "读取本地数据失败，请稍后重试。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
    }
  },

  renderState() {
    if (!state?.currentPlan) return;
    const isOldDate = state.currentPlan.date !== localDate();
    const planBlockedByPreferences =
      state.planNeedsRefresh && state.planRefreshReason === "preferences_changed";
    let planNotice = "";
    if (state.planRefreshReason === "profile_changed") {
      planNotice = "档案已更新；当前菜单仍按保存时的身高体重计算，请主动重新计算。";
    } else if (state.planRefreshReason === "preferences_changed") {
      planNotice = "偏好已保存，但当前菜单不满足新条件，请调整偏好或重新生成后再使用。";
    } else if (isOldDate) {
      planNotice = `这是 ${dateLabel(state.currentPlan.date)} 保存的菜单，打开应用不会自动替换。`;
    }
    const preferenceTags = preferenceSummary(state.preferences);
    this.setData({
      loading: false,
      dateText: dateLabel(state.currentPlan.date),
      profiles: toTodayProfileViewModels(state.currentPlan),
      meals: planBlockedByPreferences ? [] : toMealViewModels(state.currentPlan),
      preferenceTags,
      hasRemovablePreferences: preferenceTags.some((tag) => tag.removable),
      hasAllergens: state.preferences.allergens.length > 0,
      planNotice,
      planNoticeIsWarning: state.planNeedsRefresh,
      planBlockedByPreferences,
      generateButtonText: state.planNeedsRefresh
        ? "按新设置重算"
        : isOldDate
          ? "生成今日菜单"
          : "换一套家常菜",
      errorMessage: ""
    });
  },

  onPreferenceInput(event: WechatMiniprogram.Input) {
    this.setData({ preferenceInput: event.detail.value });
  },

  onQuickPreference(event: WechatMiniprogram.TouchEvent) {
    const text = String(event.currentTarget.dataset.text ?? "");
    void this.applyPreference(text);
  },

  onPreferenceSubmit() {
    void this.applyPreference(this.data.preferenceInput);
  },

  onRetryLoad() {
    void this.loadState();
  },

  onRemovePreference(event: WechatMiniprogram.TouchEvent) {
    if (!state || operationInProgress) return;
    const kind = String(
      event.currentTarget.dataset.kind ?? ""
    ) as RemovablePreferenceKind;
    const value = String(event.currentTarget.dataset.value ?? "");
    const preferences = removePreference(state.preferences, kind, value);
    void this.applyDirectPreferenceChange(preferences, "已移除这项偏好，并重新计算菜单。 ");
  },

  async onClearPreferences() {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      const result = await wx.showModal({
        title: "清空饮食偏好？",
        content: "不吃、优先、口味和做法会清空；过敏原安全资料会保留。",
        confirmText: "清空"
      });
      if (!result.confirm || !state) return;
      await this.persistPreferenceChange(
        resetPreferences(state.preferences),
        "普通偏好已清空；过敏原资料仍然保留。"
      );
    } catch (error) {
      this.setData({
        errorMessage:
          error instanceof Error ? error.message : "无法打开确认框，请稍后重试。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
    }
  },

  async applyDirectPreferenceChange(
    preferences: AppState["preferences"],
    reply: string
  ) {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      await this.persistPreferenceChange(preferences, reply);
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
    }
  },

  async persistPreferenceChange(
    preferences: AppState["preferences"],
    successReply: string
  ) {
    if (!state) return;
    const previousState = state;
    try {
      const result = await savePreferencePlanChange(
        previousState,
        preferences,
        { date: localDate() },
        (nextState) => getAppStateRepository().save(nextState)
      );
      state = result.state;
      this.setData({
        assistantReply: result.generated
          ? successReply
          : "偏好修改已保存，请继续移除冲突项后重新计算。"
      });
      this.renderState();
      if (result.generationError) {
        this.setData({
          errorMessage: `${result.generationError.message} 修改已保存，旧菜单已隐藏。`
        });
      }
    } catch (error) {
      state = previousState;
      this.renderState();
      this.setData({
        assistantReply: "偏好修改未保存，当前设置和菜单都没有改变。",
        errorMessage:
          error instanceof Error
            ? `保存偏好失败：${error.message}`
            : "保存偏好失败，请稍后重试。"
      });
    }
  },

  async applyPreference(text: string) {
    const input = text.trim();
    if (!input || !state || operationInProgress) return;
    const result = parsePreferences(input, state.preferences);
    this.setData({ preferenceInput: "" });
    if (!result.changed) {
      this.setData({ assistantReply: result.reply });
      return;
    }

    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      await this.persistPreferenceChange(result.preferences, result.reply);
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
    }
  },

  async onGenerateTap() {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      const nextState = regeneratePlan(state, { date: localDate() });
      await getAppStateRepository().save(nextState);
      state = nextState;
      this.setData({ assistantReply: "已换一套菜单，所有偏好继续保留。" });
      this.renderState();
    } catch (error) {
      this.setData({
        errorMessage: error instanceof Error ? error.message : "生成菜单失败。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
    }
  }
});

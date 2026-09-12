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
  preparePreferencePlanChange,
  regeneratePlan,
  type PreferencePlanStateResult
} from "../../services/plan-service";
import {
  preferenceSummary,
  toTodayProfileViewModels
} from "../../presentation/view-models";
import { toPlannedMeals, planningSummary } from "../../presentation/meal-planning-view-models";
import { selectPlanDate, setMealDining } from "../../services/meal-planning-service";
import { isPlannableMeal, usableTakeout } from "../../domain/meal-planning";
import { toggleTakeoutFavorite } from "../../services/takeout-state";
import { getTakeoutRecommendations } from "../../domain/takeout";

let state: AppState | undefined;
let operationInProgress = false;
let refreshRequested = false;

type PreferenceChange = (current: AppState["preferences"]) => {
  preferences: AppState["preferences"];
  reply: string;
  changed?: boolean;
};

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

function dateOffset(offset: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offset);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

Page({
  data: {
    loading: true,
    dateText: "",
    profiles: [] as ReturnType<typeof toTodayProfileViewModels>,
    meals: [] as ReturnType<typeof toPlannedMeals>,
    selectedDate: "", today: "", lastPlanningDate: "", planningMemberId: "",
    planningMembers: [] as Array<{id: string; name: string; emoji: string}>,
    dateOptions: [] as Array<{date: string; label: string; saved: boolean}>,
    planningStatus: "",
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
  expandedTakeoutMeals: [] as string[],

  async onShow() {
    if (operationInProgress) {
      refreshRequested = true;
      return;
    }
    await this.loadState();
  },

  onHide() {
    refreshRequested = false;
  },

  async flushPendingRefresh() {
    if (!refreshRequested || operationInProgress) return;
    refreshRequested = false;
    const previousError = this.data.errorMessage;
    await this.loadState();
    if (previousError && !this.data.errorMessage) {
      this.setData({ errorMessage: previousError });
    }
  },

  async loadState() {
    if (operationInProgress) return;
    refreshRequested = false;
    operationInProgress = true;
    this.setData({ loading: true, busy: true, errorMessage: "" });
    try {
      state = await getAppStateRepository().update((latest) =>
        ensureInitialPlan(latest, { date: localDate() }).state
      );
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
      await this.flushPendingRefresh();
    }
  },

  renderState() {
    if (!state?.currentPlan) {
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
        planBlockedByPreferences: false
      });
      return;
    }
    const isOldDate = state.currentPlan.date < localDate();
    const isFutureDate = state.currentPlan.date > localDate();
    const planBlockedByPreferences =
      state.planNeedsRefresh && state.planRefreshReason === "preferences_changed";
    let planNotice = "";
    if (state.planRefreshReason === "profile_changed") {
      planNotice = "档案已更新；当前菜单仍按保存时的身高体重计算，请主动重新计算。";
    } else if (state.planRefreshReason === "preferences_changed") {
      planNotice = "偏好已保存，但当前菜单不满足新条件，请调整偏好或重新生成后再使用。";
    } else if (isOldDate) {
      planNotice = `这是 ${dateLabel(state.currentPlan.date)} 保存的菜单，打开应用不会自动替换。`;
    } else if (isFutureDate) {
      planNotice = "正在提前安排这一天。切换日期可查看其他计划，每次选择都会自动保存。";
    }
    const preferenceTags = preferenceSummary(state.preferences);
    const planningMemberId = state.currentPlan.memberIds.includes(this.data.planningMemberId)
      ? this.data.planningMemberId : state.currentPlan.memberIds[0];
    this.setData({
      loading: false,
      dateText: dateLabel(state.currentPlan.date),
      selectedDate: state.currentPlan.date, today: localDate(), lastPlanningDate: dateOffset(14),
      planningMemberId,
      planningMembers: state.profiles.map(profile => ({id: profile.id, name: profile.name, emoji: profile.emoji ?? "👤"})),
      dateOptions: Array.from({length: 7}, (_, index) => {
        const date = dateOffset(index);
        return {date, label: index === 0 ? "今天" : index === 1 ? "明天" : `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`,
          saved: state!.history.some(plan => plan.date === date)};
      }),
      planningStatus: planningSummary(state),
      profiles: planBlockedByPreferences ? [] : toTodayProfileViewModels(state.currentPlan, state.preferences),
      meals: planBlockedByPreferences
        ? []
        : toPlannedMeals(state, planningMemberId, this.expandedTakeoutMeals),
      preferenceTags,
      hasRemovablePreferences: preferenceTags.some((tag) => tag.removable),
      hasAllergens: state.preferences.allergens.length > 0,
      planNotice,
      planNoticeIsWarning: state.planNeedsRefresh,
      planBlockedByPreferences,
      generateButtonText: state.planNeedsRefresh
        ? "按新设置重算"
        : "换当天自炊菜谱",
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

  async onGoProfile() {
    try {
      await wx.switchTab({ url: "/pages/profile/profile" });
    } catch {
      wx.showToast({ title: "请切换到档案页", icon: "none" });
    }
  },

  async mutatePlan(change: (latest: AppState) => AppState) {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({busy: true, errorMessage: ""});
    try {
      state = await getAppStateRepository().update(change);
      this.renderState();
    } catch (error) {
      await this.refreshAfterFailedMutation();
      this.setData({errorMessage: error instanceof Error ? `未保存：${error.message}` : "未保存，请重试。"});
    } finally {
      operationInProgress = false;
      this.setData({busy: false});
      await this.flushPendingRefresh();
    }
  },

  onPlanDateChange(event: WechatMiniprogram.PickerChange) {
    const date = String(event.detail.value);
    return this.mutatePlan(latest => selectPlanDate(latest, date));
  },
  onPlanDateTap(event: WechatMiniprogram.TouchEvent) {
    const date = String(event.currentTarget.dataset.date ?? "");
    return this.mutatePlan(latest => selectPlanDate(latest, date));
  },
  onPlanningMemberTap(event: WechatMiniprogram.TouchEvent) {
    if (!state || operationInProgress) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!state.profiles.some(profile => profile.id === id)) return;
    this.setData({planningMemberId: id});
    this.renderState();
  },
  onDiningSourceTap(event: WechatMiniprogram.TouchEvent) {
    if (!state?.currentPlan) return Promise.resolve();
    const {meal, source} = event.currentTarget.dataset;
    if (!isPlannableMeal(meal) || (source !== "home" && source !== "takeout")) return Promise.resolve();
    const planId = state.currentPlan.id, memberId = this.data.planningMemberId;
    return this.mutatePlan(latest => setMealDining(latest, planId, meal, memberId, source));
  },
  onPlannedTakeoutTap(event: WechatMiniprogram.TouchEvent) {
    if (!state?.currentPlan) return Promise.resolve();
    const {meal, id} = event.currentTarget.dataset;
    if (!isPlannableMeal(meal) || typeof id !== "string") return Promise.resolve();
    const planId = state.currentPlan.id, memberId = this.data.planningMemberId;
    return this.mutatePlan(latest => setMealDining(latest, planId, meal, memberId, "takeout", id));
  },
  onMoreTakeoutTap(event: WechatMiniprogram.TouchEvent) {
    if (operationInProgress) return;
    const meal = String(event.currentTarget.dataset.meal ?? "");
    this.expandedTakeoutMeals = this.expandedTakeoutMeals.includes(meal)
      ? this.expandedTakeoutMeals.filter(item => item !== meal) : [...this.expandedTakeoutMeals, meal];
    this.renderState();
  },
  onPlannedFavoriteTap(event: WechatMiniprogram.TouchEvent) {
    const {meal, id} = event.currentTarget.dataset;
    const memberId = this.data.planningMemberId;
    if (!isPlannableMeal(meal) || typeof id !== "string") return Promise.resolve();
    return this.mutatePlan(latest => {
      const profile = latest.profiles.find(item => item.id === memberId);
      if (!profile || !getTakeoutRecommendations({profile, preferences: latest.preferences, mealType: meal}).matches.some(item => item.template.id === id)) {
        throw new Error("搭配已变化，请重新选择。");
      }
      return toggleTakeoutFavorite(latest, id);
    });
  },
  async onCopyPlannedOrder(event: WechatMiniprogram.TouchEvent) {
    if (!state?.currentPlan || operationInProgress) return;
    const planId = state.currentPlan.id, memberId = this.data.planningMemberId;
    const mealType = event.currentTarget.dataset.meal;
    const keywordOnly = event.currentTarget.dataset.kind === "keyword";
    operationInProgress = true;
    this.setData({busy: true, errorMessage: ""});
    try {
      state = await getAppStateRepository().load();
      const plan = state.currentPlan;
      if (!plan || plan.id !== planId) throw new Error("计划已变化，请重新选择。");
      const meal = plan.meals.find(item => item.type === mealType);
      const selected = meal && usableTakeout(meal, plan, memberId, state.preferences);
      if (!selected) throw new Error("这餐外卖需要重新选择。");
      const exclusions = preferenceSummary(state.preferences).filter(item => item.tone === "exclude").map(item => item.label);
      await wx.setClipboardData({data: keywordOnly ? selected.searchKeyword : selected.orderText +
        (exclusions.length ? ` 饮食要求：${exclusions.join("、")}；请确认配菜和调料。` : "")});
      this.renderState();
    } catch (error) {
      this.renderState();
      this.setData({errorMessage: error instanceof Error ? `复制失败：${error.message}` : "复制失败，请重试。"});
    } finally {
      operationInProgress = false;
      this.setData({busy: false});
      await this.flushPendingRefresh();
    }
  },

  onRemovePreference(event: WechatMiniprogram.TouchEvent) {
    if (!state || operationInProgress) return;
    const kind = String(
      event.currentTarget.dataset.kind ?? ""
    ) as RemovablePreferenceKind;
    const value = String(event.currentTarget.dataset.value ?? "");
    void this.applyDirectPreferenceChange((preferences) => ({
      preferences: removePreference(preferences, kind, value),
      reply: "已移除这项偏好，并重新计算菜单。"
    }));
  },

  async onClearPreferences() {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      const result = await wx.showModal({
        title: "清空饮食偏好？",
        content: "不吃、优先、口味和做法会清空；过敏原过滤记录会保留。",
        confirmText: "清空"
      });
      if (!result.confirm || !state) return;
      await this.persistPreferenceChange((preferences) => ({
        preferences: resetPreferences(preferences),
        reply: "普通偏好已清空；过敏原资料仍然保留。"
      }));
    } catch (error) {
      this.setData({
        errorMessage:
          error instanceof Error ? error.message : "无法打开确认框，请稍后重试。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
      await this.flushPendingRefresh();
    }
  },

  async applyDirectPreferenceChange(change: PreferenceChange) {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      await this.persistPreferenceChange(change);
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
      await this.flushPendingRefresh();
    }
  },

  async persistPreferenceChange(change: PreferenceChange) {
    if (!state) return;
    try {
      const committed = await getAppStateRepository().transaction<{
        reply: string;
        planResult: PreferencePlanStateResult | null;
      }>((latest) => {
        const edited = change(latest.preferences);
        if (edited.changed === false) {
          return {
            state: latest,
            value: { reply: edited.reply, planResult: null }
          };
        }
        const result = preparePreferencePlanChange(
          latest,
          edited.preferences,
          { date: latest.currentPlan?.date ?? localDate() }
        );
        return {
          state: result.state,
          value: { reply: edited.reply, planResult: result }
        };
      });
      state = committed.state;
      const result = committed.value.planResult;
      this.setData({
        assistantReply: !result || result.generated
          ? committed.value.reply
          : "偏好修改已保存，请继续移除冲突项后重新计算。"
      });
      this.renderState();
      if (result?.generationError) {
        this.setData({
          errorMessage: `${result.generationError.message} 修改已保存，旧菜单已隐藏。`
        });
      }
    } catch (error) {
      await this.refreshAfterFailedMutation();
      this.setData({
        assistantReply: "本次偏好修改未保存，请稍后重试。",
        errorMessage:
          error instanceof Error
            ? `保存偏好失败：${error.message}`
            : "保存偏好失败，请稍后重试。"
      });
    }
  },

  async refreshAfterFailedMutation() {
    try {
      state = await getAppStateRepository().load();
    } catch {
      state = undefined;
    }
    this.renderState();
  },

  async applyPreference(text: string) {
    const input = text.trim();
    if (!input || !state || operationInProgress) return;
    this.setData({ preferenceInput: "" });
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      await this.persistPreferenceChange((preferences) =>
        parsePreferences(input, preferences)
      );
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
      await this.flushPendingRefresh();
    }
  },

  async onGenerateTap() {
    if (!state || operationInProgress) return;
    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      state = await getAppStateRepository().update((latest) =>
        regeneratePlan(latest, { date: latest.currentPlan?.date ?? localDate() })
      );
      this.setData({ assistantReply: "已更换当天的自炊菜谱，外卖安排和其他日期的计划会保留。" });
      this.renderState();
    } catch (error) {
      await this.refreshAfterFailedMutation();
      this.setData({
        errorMessage: error instanceof Error ? error.message : "生成菜单失败。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
      await this.flushPendingRefresh();
    }
  }
});

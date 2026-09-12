import { TAKEOUT_CATEGORIES } from "../../data/takeout-catalog";
import {
  getTakeoutRecommendations,
  type TakeoutCategory,
  type TakeoutMealType,
  type TakeoutRecommendation,
} from "../../domain/takeout";
import { preferenceSummary } from "../../presentation/view-models";
import { getAppStateRepository, type AppState } from "../../repositories/app-state";
import { removeTakeoutSelection, setTakeoutSelection, toggleTakeoutFavorite } from "../../services/takeout-state";

export interface TakeoutCard {
  id: string; name: string; categoryLabel: string; searchKeyword: string;
  portionDescription: string; caloriesText: string; proteinText: string;
  carbsText: string; fatText: string; orderText: string; assumptions: string[];
  tips: string[]; reasonText: string; isFavorite: boolean; meetsTargets: boolean; expanded: boolean;
}

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "本地操作未完成，请重试。";
}

Page({
  data: {
    loading: true, busy: false, errorMessage: "", dateText: "",
    members: [] as Array<{id: string; name: string; emoji: string}>,
    memberId: "", mealType: "lunch" as TakeoutMealType, mealLabel: "午餐",
    category: "all" as TakeoutCategory | "all",
    categories: [{id: "all", label: "全部"}, ...TAKEOUT_CATEGORIES],
    maxCaloriesInput: "", minProteinInput: "", targetSummary: "", filterError: "",
    preferenceText: "", blockedReason: "", notice: "", onlyFavorites: false,
    matches: [] as TakeoutCard[], alternatives: [] as TakeoutCard[],
    selectedName: "", selectedNotice: "", hasSelection: false, showAlternatives: false,
  },
  state: undefined as AppState | undefined,
  appliedTargets: undefined as { maxCaloriesKcal: number; minProteinG: number } | undefined,
  filtersDirty: false,
  expandedIds: [] as string[],
  pendingRefresh: false,

  onLoad(query: Record<string, string | undefined>) {
    if (query.meal === "dinner") this.setData({mealType: "dinner", mealLabel: "晚餐"});
  },
  async onShow() {
    if (this.data.busy) { this.pendingRefresh = true; return; }
    await this.loadState();
  },
  async loadState() {
    if (this.data.busy) return;
    this.setData({busy: true, loading: true, errorMessage: ""});
    try {
      this.state = await getAppStateRepository().load();
      this.renderState();
    } catch (error) {
      this.state = undefined;
      this.setData({errorMessage: message(error), matches: [], alternatives: [], hasSelection: false});
    } finally {
      this.setData({busy: false, loading: false});
      await this.flushRefresh();
    }
  },
  async flushRefresh() {
    if (!this.pendingRefresh || this.data.busy) return;
    this.pendingRefresh = false;
    const operationError = this.data.errorMessage;
    await this.loadState();
    if (operationError && !this.data.errorMessage) this.setData({errorMessage: operationError});
  },
  resultFor(state: AppState) {
    const profile = state.profiles.find(item => item.id === this.data.memberId) ?? state.profiles[0];
    if (!profile) throw new Error("请先填写成员档案。");
    return getTakeoutRecommendations({
      profile, preferences: state.preferences, mealType: this.data.mealType,
      category: this.data.category, ...this.appliedTargets,
    });
  },
  renderState() {
    const state = this.state;
    if (!state) return;
    const profile = state.profiles.find(item => item.id === this.data.memberId) ?? state.profiles[0];
    if (!profile) throw new Error("请先填写成员档案。");
    this.setData({memberId: profile.id});
    const result = this.resultFor(state);
    const selected = state.takeout.selections.find(item =>
      item.date === localDate() && item.memberId === profile.id && item.mealType === this.data.mealType);
    // A category filter is only a display choice; it must not invalidate a saved reference.
    const allResults = getTakeoutRecommendations({profile, preferences: state.preferences,
      mealType: this.data.mealType, ...this.appliedTargets});
    const selectedMatch = allResults.matches.find(item => item.template.id === selected?.templateId);
    const favoriteIds = state.takeout.favoriteTemplateIds;
    const card = (item: TakeoutRecommendation): TakeoutCard => ({
      id: item.template.id, name: item.template.name,
      categoryLabel: TAKEOUT_CATEGORIES.find(category => category.id === item.template.category)?.label ?? "外卖搭配",
      searchKeyword: item.template.searchKeyword, portionDescription: item.template.portionDescription,
      caloriesText: `${item.nutrition.min.caloriesKcal}–${item.nutrition.max.caloriesKcal} 千卡`,
      proteinText: `${item.nutrition.min.proteinG}–${item.nutrition.max.proteinG} 克`,
      carbsText: `${item.nutrition.min.carbsG}–${item.nutrition.max.carbsG} 克`,
      fatText: `${item.nutrition.min.fatG}–${item.nutrition.max.fatG} 克`,
      orderText: item.template.orderText, assumptions: [...item.template.assumptions], tips: [...item.template.tips],
      reasonText: item.mismatchReasons.join("；"), isFavorite: favoriteIds.includes(item.template.id),
      meetsTargets: item.meetsTargets, expanded: this.expandedIds.includes(item.template.id),
    });
    const show = (items: TakeoutRecommendation[]) => items
      .filter(item => !this.data.onlyFavorites || favoriteIds.includes(item.template.id)).map(card);
    const mealLabel = this.data.mealType === "lunch" ? "午餐" : "晚餐";
    this.setData({
      dateText: localDate(), mealLabel,
      members: state.profiles.map(item => ({id: item.id, name: item.name, emoji: item.emoji ?? ""})),
      targetSummary: `${profile.name}的${mealLabel}参考：按当前档案每日目标的 ${Math.round(result.targets.mealRatio * 100)}% 分配。热量是筛选上限，不是吃得越少越好。`,
      ...(!this.filtersDirty ? {maxCaloriesInput: String(result.targets.maxCaloriesKcal), minProteinInput: String(result.targets.minProteinG)} : {}),
      preferenceText: preferenceSummary(state.preferences).map(item => item.label).join(" · ") || "未设置饮食禁忌，可在今日页填写。",
      blockedReason: result.blockedReason ?? "", notice: result.notice,
      matches: this.filtersDirty ? [] : show(result.matches),
      alternatives: this.filtersDirty ? [] : show(result.alternatives),
      hasSelection: Boolean(selected),
      selectedName: selectedMatch?.template.name ?? (selected ? "原点单参考需重新选择" : ""),
      selectedNotice: selected && !selectedMatch
        ? "当前档案、禁忌或筛选条件下，原参考不再适用。请重新选择；记录已保留，可移除。"
        : "仅记录本餐点单参考，不代表实际摄入；自炊菜单、营养合计和购物清单仍按原计划。",
    });
  },
  onRetryLoad() { return this.loadState(); },
  onMemberTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this.state) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!this.state.profiles.some(profile => profile.id === id)) return;
    this.setData({memberId: id}); this.onResetTargets();
  },
  onMealTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const meal = event.currentTarget.dataset.meal;
    if (meal !== "lunch" && meal !== "dinner") return;
    this.setData({mealType: meal}); this.onResetTargets();
  },
  onCategoryTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    if (id !== "all" && !TAKEOUT_CATEGORIES.some(item => item.id === id)) return;
    this.setData({category: id as TakeoutCategory | "all"}); this.safeRender();
  },
  onCaloriesInput(event: WechatMiniprogram.Input) {
    if (this.data.busy) return;
    this.filtersDirty = true;
    this.setData({maxCaloriesInput: event.detail.value, matches: [], alternatives: [], filterError: "条件已修改，请点“更新推荐”。"});
  },
  onProteinInput(event: WechatMiniprogram.Input) {
    if (this.data.busy) return;
    this.filtersDirty = true;
    this.setData({minProteinInput: event.detail.value, matches: [], alternatives: [], filterError: "条件已修改，请点“更新推荐”。"});
  },
  onApplyTargets() {
    if (this.data.busy || !this.state) return;
    const energy = this.data.maxCaloriesInput.trim();
    const protein = this.data.minProteinInput.trim();
    if (!/^\d+(\.\d+)?$/.test(energy) || !/^\d+(\.\d+)?$/.test(protein)) {
      this.setData({filterError: "请填写有效的热量上限和蛋白质下限。", matches: [], alternatives: []}); return;
    }
    const previous = this.appliedTargets;
    this.appliedTargets = {maxCaloriesKcal: Number(energy), minProteinG: Number(protein)};
    try {
      this.resultFor(this.state);
      this.filtersDirty = false;
      this.setData({filterError: "", errorMessage: ""}); this.renderState();
    } catch (error) {
      this.appliedTargets = previous; this.filtersDirty = true;
      this.setData({filterError: message(error), matches: [], alternatives: []});
    }
  },
  onResetTargets() {
    if (this.data.busy) return;
    this.appliedTargets = undefined; this.filtersDirty = false;
    this.setData({filterError: "", errorMessage: ""}); this.safeRender();
  },
  onToggleFavorites() {
    if (this.data.busy) return;
    this.setData({onlyFavorites: !this.data.onlyFavorites}); this.safeRender();
  },
  onToggleAlternatives() { this.setData({showAlternatives: !this.data.showAlternatives}); },
  onToggleDetails(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    this.expandedIds = this.expandedIds.includes(id) ? this.expandedIds.filter(item => item !== id) : [...this.expandedIds, id];
    this.safeRender();
  },
  safeRender() {
    try { this.renderState(); }
    catch (error) { this.setData({errorMessage: message(error), matches: [], alternatives: []}); }
  },
  async mutate(change: (latest: AppState) => AppState) {
    if (this.data.busy || !this.state) return;
    this.setData({busy: true, errorMessage: ""});
    try {
      this.state = await getAppStateRepository().update(change); this.renderState();
    } catch (error) {
      try { this.state = await getAppStateRepository().load(); this.safeRender(); }
      catch { this.state = undefined; this.setData({matches: [], alternatives: [], hasSelection: false}); }
      this.setData({errorMessage: `未保存：${message(error)}`});
    } finally {
      this.setData({busy: false}); await this.flushRefresh();
    }
  },
  requireCurrentRecommendation(latest: AppState, id: string, allowAlternative = false) {
    if (this.filtersDirty) throw new Error("请先更新推荐条件。");
    if (!latest.profiles.some(item => item.id === this.data.memberId)) throw new Error("成员档案已变化，请重新打开页面。");
    const result = this.resultFor(latest);
    const item = (allowAlternative ? [...result.matches, ...result.alternatives] : result.matches)
      .find(item => item.template.id === id);
    if (!item) throw new Error("这份搭配已不满足当前档案或禁忌，请重新选择。");
    return item;
  },
  onFavoriteTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    return this.mutate(latest => {
      this.requireCurrentRecommendation(latest, id, true);
      return toggleTakeoutFavorite(latest, id);
    });
  },
  onSelectTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.busy || !this.state) return Promise.resolve();
    if (this.data.dateText !== localDate()) {
      this.safeRender();
      this.setData({errorMessage: "日期已变化，已更新为今天，请重试选择本餐参考。"});
      return Promise.resolve();
    }
    const id = String(event.currentTarget.dataset.id ?? "");
    const date = this.data.dateText;
    return this.mutate(latest => {
      this.requireCurrentRecommendation(latest, id);
      return setTakeoutSelection(latest, {date, memberId: this.data.memberId,
        mealType: this.data.mealType, templateId: id});
    });
  },
  onClearSelection() {
    const date = this.data.dateText;
    return this.mutate(latest => removeTakeoutSelection(latest,
      {date, memberId: this.data.memberId, mealType: this.data.mealType}));
  },
  async copyTemplate(id: string, keywordOnly: boolean) {
    if (this.data.busy || !this.state) return;
    this.setData({busy: true, errorMessage: ""});
    try {
      this.state = await getAppStateRepository().load();
      const item = this.requireCurrentRecommendation(this.state, id, keywordOnly);
      const excluded = preferenceSummary(this.state.preferences).filter(tag => tag.kind === "exclude_food" || tag.kind === "exclude_group");
      // Copy only the selected meal, never body measurements or the complete local backup.
      const note = excluded.length ? ` 饮食要求：${excluded.map(tag => tag.label).join("、")}。请确认配菜和调料是否含有。` : "";
      await wx.setClipboardData({data: keywordOnly ? item.template.searchKeyword : item.template.orderText + note});
      this.renderState();
    } catch (error) {
      this.safeRender(); this.setData({errorMessage: `复制失败：${message(error)}`});
    } finally {
      this.setData({busy: false}); await this.flushRefresh();
    }
  },
  onCopyOrder(event: WechatMiniprogram.TouchEvent) { return this.copyTemplate(String(event.currentTarget.dataset.id ?? ""), false); },
  onCopyKeyword(event: WechatMiniprogram.TouchEvent) { return this.copyTemplate(String(event.currentTarget.dataset.id ?? ""), true); },
  async onGoProfile() {
    try { await wx.switchTab({url: "/pages/profile/profile"}); }
    catch { this.setData({errorMessage: "请返回后切换到档案页。"}); }
  },
  async onGoPreferences() {
    try { await wx.switchTab({url: "/pages/index/index"}); }
    catch { this.setData({errorMessage: "请返回今日页，在饮食小助手中修改忌口。"}); }
  },
});

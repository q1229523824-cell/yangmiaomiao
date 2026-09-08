import { buildShoppingList } from "../../domain/shopping-list";
import { toShoppingViewModels } from "../../presentation/view-models";
import type { AppState } from "../../repositories/app-state";
import { getAppStateRepository } from "../../repositories/app-state";

let state: AppState | undefined;
let operationInProgress = false;
let loadInProgress = false;
let refreshRequested = false;

Page({
  data: {
    hasPlan: false,
    canUsePlan: false,
    loading: true,
    busy: false,
    errorMessage: "",
    planWarning: "",
    date: "",
    items: [] as ReturnType<typeof toShoppingViewModels>
  },

  async onShow() {
    if (operationInProgress || loadInProgress) {
      refreshRequested = true;
      return;
    }
    await this.loadShoppingList();
  },

  onHide() {
    refreshRequested = false;
  },

  async flushPendingRefresh() {
    if (!refreshRequested || operationInProgress || loadInProgress) return;
    refreshRequested = false;
    const previousError = this.data.errorMessage;
    await this.loadShoppingList();
    if (previousError && !this.data.errorMessage) {
      this.setData({ errorMessage: previousError });
    }
  },

  async loadShoppingList() {
    if (operationInProgress || loadInProgress) return;
    refreshRequested = false;
    loadInProgress = true;
    this.setData({ loading: true, errorMessage: "", planWarning: "" });
    try {
      state = await getAppStateRepository().load();
      this.renderState();
    } catch (error) {
      state = undefined;
      this.setData({
        loading: false,
        hasPlan: false,
        canUsePlan: false,
        date: "",
        items: [],
        planWarning: "",
        errorMessage:
          error instanceof Error
            ? `读取购物清单失败：${error.message}`
            : "读取购物清单失败，请稍后重试。"
      });
    } finally {
      loadInProgress = false;
      this.setData({ loading: false });
      await this.flushPendingRefresh();
    }
  },

  renderState() {
    const plan = state?.currentPlan;
    if (!state || !plan) {
      this.setData({
        loading: false,
        hasPlan: false,
        canUsePlan: false,
        date: "",
        items: [],
        planWarning: ""
      });
      return;
    }
    const blocked =
      state.planNeedsRefresh && state.planRefreshReason === "preferences_changed";
    const checked = state.checkedFoodIdsByPlanId[plan.id] ?? [];
    this.setData({
      loading: false,
      hasPlan: true,
      canUsePlan: !blocked,
      date: plan.date,
      planWarning: blocked
        ? "当前菜单与新禁忌冲突，购物清单已隐藏。请先回到今日页调整。"
        : state.planNeedsRefresh
          ? "档案已修改，这份清单仍使用旧菜单的份量。"
          : "",
      items: blocked
        ? []
        : toShoppingViewModels(plan, buildShoppingList(plan), checked)
    });
  },

  onRetry() {
    void this.loadShoppingList();
  },

  async onGoToday() {
    try {
      await wx.switchTab({ url: "/pages/index/index" });
    } catch {
      wx.showToast({ title: "请切换到今日页", icon: "none" });
    }
  },

  async onToggle(event: WechatMiniprogram.CheckboxGroupChange) {
    if (
      !state?.currentPlan || operationInProgress || loadInProgress || !this.data.canUsePlan
    ) return;
    // The current menu may change in another tab while this write is queued.
    const clickedPlanId = state.currentPlan.id;
    const checked = event.detail.value.map(String);

    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      const committed = await getAppStateRepository().transaction((latest) => {
        const clickedPlan = latest.history.find(
          (plan) => plan.id === clickedPlanId
        );
        if (!clickedPlan) return { state: latest, value: false };
        const allowedFoodIds = new Set(
          buildShoppingList(clickedPlan).map((item) => item.foodId)
        );
        return {
          state: {
            ...latest,
            checkedFoodIdsByPlanId: {
              ...latest.checkedFoodIdsByPlanId,
              [clickedPlanId]: [
                ...new Set(checked.filter((id) => allowedFoodIds.has(id)))
              ]
            }
          },
          value: true
        };
      });
      state = committed.state;
      this.renderState();
      if (!committed.value) {
        this.setData({ errorMessage: "原菜单已不存在，清单已刷新，请重新操作。" });
      }
    } catch (error) {
      try {
        state = await getAppStateRepository().load();
      } catch {
        state = undefined;
      }
      this.renderState();
      this.setData({
        errorMessage:
          error instanceof Error ? `保存勾选失败：${error.message}` : "保存勾选失败。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
      await this.flushPendingRefresh();
    }
  }
});

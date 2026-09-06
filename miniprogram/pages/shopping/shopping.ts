import { buildShoppingList } from "../../domain/shopping-list";
import { toShoppingViewModels } from "../../presentation/view-models";
import type { AppState } from "../../repositories/app-state";
import { getAppStateRepository } from "../../repositories/app-state";

let state: AppState | undefined;
let operationInProgress = false;
let loadInProgress = false;

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
    await this.loadShoppingList();
  },

  async loadShoppingList() {
    if (operationInProgress || loadInProgress) return;
    loadInProgress = true;
    this.setData({ loading: true, errorMessage: "", planWarning: "" });
    try {
      state = await getAppStateRepository().load();
      const plan = state.currentPlan;
      if (!plan) {
        this.setData({
          loading: false,
          hasPlan: false,
          canUsePlan: false,
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
    }
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
    if (!state?.currentPlan || operationInProgress || !this.data.canUsePlan) return;
    const checked = event.detail.value.map(String);
    const previousState = state;
    const previousItems = this.data.items;
    const nextState: AppState = {
      ...state,
      checkedFoodIdsByPlanId: {
        ...state.checkedFoodIdsByPlanId,
        [state.currentPlan.id]: checked
      }
    };

    operationInProgress = true;
    this.setData({ busy: true, errorMessage: "" });
    try {
      await getAppStateRepository().save(nextState);
      state = nextState;
      this.setData({
        items: this.data.items.map((item) => ({
          ...item,
          checked: checked.includes(item.foodId)
        }))
      });
    } catch (error) {
      state = previousState;
      this.setData({
        items: previousItems.map((item) => ({ ...item })),
        errorMessage:
          error instanceof Error ? `保存勾选失败：${error.message}` : "保存勾选失败。"
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false });
    }
  }
});

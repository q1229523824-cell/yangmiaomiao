import {
  toHistoryPlanViewModels,
} from "../../presentation/history-view-models";
import type { AppState } from "../../repositories/app-state";
import { getAppStateRepository } from "../../repositories/app-state";
import {
  HistoryPlanNotFoundError,
  restorePlanFromHistory,
} from "../../services/history-service";

let state: AppState | undefined;
let operationInProgress = false;
let loadInProgress = false;

Page({
  data: {
    loading: true,
    busy: false,
    restoringPlanId: "",
    errorMessage: "",
    items: [] as ReturnType<typeof toHistoryPlanViewModels>,
  },

  async onShow() {
    await this.loadHistory();
  },

  async loadHistory() {
    if (operationInProgress || loadInProgress) return;
    loadInProgress = true;
    this.setData({ loading: true, errorMessage: "" });
    try {
      state = await getAppStateRepository().load();
      this.setData({
        loading: false,
        items: toHistoryPlanViewModels(
          state.history,
          state.currentPlan?.id,
        ),
      });
    } catch (error) {
      state = undefined;
      this.setData({
        loading: false,
        items: [],
        errorMessage:
          error instanceof Error
            ? `读取历史菜单失败：${error.message}`
            : "读取历史菜单失败，请稍后重试。",
      });
    } finally {
      loadInProgress = false;
      this.setData({ loading: false });
    }
  },

  onRetry() {
    void this.loadHistory();
  },

  async onGoToday() {
    try {
      await wx.switchTab({ url: "/pages/index/index" });
    } catch {
      wx.showToast({ title: "请切换到今日页", icon: "none" });
    }
  },

  async onRestoreTap(event: WechatMiniprogram.TouchEvent) {
    if (!state || operationInProgress) return;
    const planId = String(event.currentTarget.dataset.planId ?? "");
    const item = this.data.items.find((candidate) => candidate.id === planId);
    if (!item || item.isCurrent) return;

    operationInProgress = true;
    this.setData({
      busy: true,
      restoringPlanId: planId,
      errorMessage: "",
    });

    try {
      const result = await wx.showModal({
        title: "恢复这份菜单？",
        content: `将使用 ${item.dateLabel} 的菜单并恢复当时的普通偏好；当前过敏原保护会保留。`,
        confirmText: "确认恢复",
        confirmColor: "#d49f00",
      });
      if (!result.confirm) return;

      const restored = restorePlanFromHistory(state, planId);
      try {
        await getAppStateRepository().save(restored);
      } catch (error) {
        this.setData({
          errorMessage:
            error instanceof Error
              ? `保存恢复结果失败：${error.message}`
              : "保存恢复结果失败，原菜单没有改变。",
        });
        return;
      }

      state = restored;
      this.setData({
        items: toHistoryPlanViewModels(restored.history, restored.currentPlan?.id),
      });
      try {
        await wx.switchTab({ url: "/pages/index/index" });
      } catch {
        this.setData({
          errorMessage: "菜单已经恢复，请手动切换到“今日”页面查看。",
        });
      }
    } catch (error) {
      this.setData({
        errorMessage:
          error instanceof HistoryPlanNotFoundError
            ? "这份历史菜单已不存在，请重新加载历史记录。"
            : error instanceof Error
              ? `恢复菜单失败：${error.message}`
              : "恢复菜单失败，请稍后重试。",
      });
    } finally {
      operationInProgress = false;
      this.setData({ busy: false, restoringPlanId: "" });
    }
  },
});

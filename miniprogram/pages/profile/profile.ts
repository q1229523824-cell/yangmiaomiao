import type { Profile } from "../../domain/models";
import {
  createDefaultAppState,
  getAppStateRepository,
  refreshFlagsAfterProfileSave
} from "../../repositories/app-state";
import {
  ACTIVITY_OPTIONS,
  TARGET_OPTIONS,
  cloneDrafts,
  draftsEqual,
  profileToDraft,
  validateProfileDraft,
  withActivityOption,
  withTargetOption,
  type ProfileDraft
} from "./profile-form";
import {
  LocalBackupError,
  parseLocalBackup,
  serializeLocalBackup,
} from "../../services/local-backup";

type DraftTextField = "name" | "heightCm" | "weightKg" | "ageYears";

const DRAFT_TEXT_FIELDS: readonly DraftTextField[] = [
  "name",
  "heightCm",
  "weightKg",
  "ageYears"
];

let drafts: ProfileDraft[] = [];
let baselineDrafts: ProfileDraft[] = [];
let sourceProfiles: Profile[] = [];
let operationBusy = false;
let refreshRequested = false;

function cloneProfiles(profiles: readonly Profile[]): Profile[] {
  return profiles.map((profile) => ({
    ...profile,
    goalSettings: { ...profile.goalSettings }
  }));
}

function profilesEqual(left: readonly Profile[], right: readonly Profile[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((profile, index) => {
    const other = right[index];
    return (
      profile.id === other?.id &&
      profile.name === other.name &&
      profile.heightCm === other.heightCm &&
      profile.weightKg === other.weightKg &&
      profile.ageYears === other.ageYears &&
      profile.goalSettings.activityFactor === other.goalSettings.activityFactor &&
      profile.goalSettings.calorieTargetRatio ===
        other.goalSettings.calorieTargetRatio
    );
  });
}

function isDraftTextField(value: string): value is DraftTextField {
  return DRAFT_TEXT_FIELDS.includes(value as DraftTextField);
}

function validDraftIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < drafts.length;
}

Page({
  data: {
    drafts: [] as ProfileDraft[],
    activityOptions: ACTIVITY_OPTIONS.map((option) => ({ ...option })),
    targetOptions: TARGET_OPTIONS.map((option) => ({ ...option })),
    loading: true,
    busy: false,
    hasUnsavedChanges: false,
    saveDisabled: true,
    loadFailed: false,
    savedMessage: "",
    pageError: ""
  },

  async onShow() {
    // Tab pages remain alive. Do not silently discard edits when the user briefly
    // checks another tab and comes back.
    if (operationBusy) {
      refreshRequested = true;
      return;
    }
    if (this.data.hasUnsavedChanges) return;
    await this.loadProfiles();
  },

  onHide() {
    refreshRequested = false;
  },

  async flushPendingRefresh() {
    if (!refreshRequested || operationBusy) return;
    refreshRequested = false;
    // Failed saves must retain the user's draft for correction or retry.
    if (this.data.hasUnsavedChanges) return;
    const savedMessage = this.data.savedMessage;
    const pageError = this.data.pageError;
    await this.loadProfiles();
    if (!this.data.loadFailed) this.setData({ savedMessage, pageError });
  },

  async loadProfiles() {
    if (operationBusy) return;
    refreshRequested = false;
    operationBusy = true;
    this.setData({
      loading: true,
      busy: true,
      saveDisabled: true,
      loadFailed: false,
      pageError: ""
    });
    try {
      const state = await getAppStateRepository().load();
      sourceProfiles = cloneProfiles(state.profiles);
      drafts = state.profiles.map(profileToDraft);
      baselineDrafts = cloneDrafts(drafts);
      this.setData({
        drafts,
        hasUnsavedChanges: false,
        loadFailed: false,
        savedMessage: ""
      });
    } catch (error) {
      sourceProfiles = [];
      drafts = [];
      baselineDrafts = [];
      this.setData({
        drafts: [],
        hasUnsavedChanges: false,
        loadFailed: true,
        pageError:
          error instanceof Error ? error.message : "读取本地档案失败，请稍后重试。"
      });
    } finally {
      operationBusy = false;
      this.setData({ loading: false, busy: false, saveDisabled: true });
      await this.flushPendingRefresh();
    }
  },

  onRetryLoad() {
    void this.loadProfiles();
  },

  /**
   * Copy only the latest committed state. This is deliberately user-initiated
   * and uses the clipboard instead of a server, so the first version remains
   * usable without cloud services or a network connection.
   */
  async onExportBackup() {
    if (operationBusy) return;
    operationBusy = true;
    this.setData({ busy: true, pageError: "" });
    try {
      if (this.data.hasUnsavedChanges) {
        const confirmation = await wx.showModal({
          title: "还有未保存修改",
          content: "备份只包含最近一次已保存的数据。要继续复制吗？",
          confirmText: "继续复制",
          confirmColor: "#d49f00",
        });
        if (!confirmation.confirm) return;
      }
      const latest = await getAppStateRepository().load();
      const serialized = serializeLocalBackup(latest);
      await wx.setClipboardData({ data: serialized });
      const sizeKb = Math.max(1, Math.ceil(serialized.length / 1024));
      this.setData({
        savedMessage: `本地备份已复制（约 ${sizeKb} KB）。请只粘贴到自己信任的位置。`,
        pageError: "",
      });
      wx.showToast({ title: "备份已复制", icon: "success" });
    } catch (error) {
      this.setData({
        pageError:
          error instanceof LocalBackupError || error instanceof Error
            ? `复制备份失败：${error.message}`
            : "复制备份失败，请稍后重试。",
      });
    } finally {
      operationBusy = false;
      this.setData({ busy: false, saveDisabled: !this.data.hasUnsavedChanges });
      await this.flushPendingRefresh();
    }
  },

  /** Replace this app's local state only after a validated, explicit confirmation. */
  async onImportBackup() {
    if (operationBusy) return;
    operationBusy = true;
    this.setData({ busy: true, pageError: "" });
    try {
      const clipboard = await wx.getClipboardData();
      const raw = typeof clipboard?.data === "string" ? clipboard.data : "";
      const imported = parseLocalBackup(raw);
      const confirmation = await wx.showModal({
        title: "恢复本地备份？",
        content:
          "这会替换本小程序在当前设备保存的档案、偏好、菜单历史和购物勾选。备份不会上传网络。",
        confirmText: "确认恢复",
        confirmColor: "#d49f00",
      });
      if (!confirmation.confirm) return;

      // `save` is an explicit, queued replacement. Unlike a transaction it
      // does not first load the current envelope, so a confirmed valid backup
      // can also recover from a corrupt or future-version local cache.
      await getAppStateRepository().save(imported);
      sourceProfiles = cloneProfiles(imported.profiles);
      drafts = imported.profiles.map(profileToDraft);
      baselineDrafts = cloneDrafts(drafts);
      this.setData({
        drafts,
        hasUnsavedChanges: false,
        saveDisabled: true,
        loadFailed: false,
        savedMessage: "本地备份已恢复。请到“今日”页检查当前菜单和过敏原提示。",
        pageError: "",
      });
      wx.showToast({ title: "已恢复备份", icon: "success" });
    } catch (error) {
      this.setData({
        pageError:
          error instanceof LocalBackupError || error instanceof Error
            ? `恢复备份失败：${error.message}`
            : "恢复备份失败，请确认剪贴板内容后重试。",
      });
    } finally {
      operationBusy = false;
      this.setData({ busy: false, saveDisabled: !this.data.hasUnsavedChanges });
      await this.flushPendingRefresh();
    }
  },

  onDraftInput(event: WechatMiniprogram.Input) {
    if (operationBusy) return;
    const index = Number(event.currentTarget.dataset.index);
    const field = String(event.currentTarget.dataset.field ?? "");
    if (!validDraftIndex(index) || !isDraftTextField(field)) return;

    drafts = drafts.map((draft, draftIndex) =>
      draftIndex === index
        ? {
            ...draft,
            [field]: event.detail.value,
            errors: { ...draft.errors, [field]: "" }
          }
        : draft
    );
    const hasUnsavedChanges = !draftsEqual(drafts, baselineDrafts);
    this.setData({
      drafts,
      hasUnsavedChanges,
      saveDisabled: !hasUnsavedChanges,
      savedMessage: "",
      pageError: ""
    });
  },

  onActivityChange(event: WechatMiniprogram.PickerChange) {
    if (operationBusy) return;
    const index = Number(event.currentTarget.dataset.index);
    const optionIndex = Number(event.detail.value);
    if (!validDraftIndex(index) || !Number.isInteger(optionIndex)) return;
    drafts = drafts.map((draft, draftIndex) =>
      draftIndex === index ? withActivityOption(draft, optionIndex) : draft
    );
    const hasUnsavedChanges = !draftsEqual(drafts, baselineDrafts);
    this.setData({
      drafts,
      hasUnsavedChanges,
      saveDisabled: !hasUnsavedChanges,
      savedMessage: "",
      pageError: ""
    });
  },

  onTargetChange(event: WechatMiniprogram.PickerChange) {
    if (operationBusy) return;
    const index = Number(event.currentTarget.dataset.index);
    const optionIndex = Number(event.detail.value);
    if (!validDraftIndex(index) || !Number.isInteger(optionIndex)) return;
    drafts = drafts.map((draft, draftIndex) =>
      draftIndex === index ? withTargetOption(draft, optionIndex) : draft
    );
    const hasUnsavedChanges = !draftsEqual(drafts, baselineDrafts);
    this.setData({
      drafts,
      hasUnsavedChanges,
      saveDisabled: !hasUnsavedChanges,
      savedMessage: "",
      pageError: ""
    });
  },

  async onSave() {
    if (operationBusy || !this.data.hasUnsavedChanges) return;

    const validations = drafts.map((draft, index) =>
      validateProfileDraft(draft, sourceProfiles[index])
    );
    drafts = validations.map((result) => result.draft);
    this.setData({ drafts, savedMessage: "", pageError: "" });
    const firstInvalidIndex = validations.findIndex((result) => !result.profile);
    if (firstInvalidIndex !== -1) {
      wx.showToast({ title: "请检查标红字段", icon: "none" });
      try {
        await wx.pageScrollTo({
          selector: `#profile-member-${firstInvalidIndex}`,
          duration: 250
        });
      } catch {
        wx.showToast({
          title: `请检查第 ${firstInvalidIndex + 1} 位成员`,
          icon: "none"
        });
      }
      return;
    }

    const nextProfiles = validations.map((result) => result.profile as Profile);
    operationBusy = true;
    this.setData({ busy: true, saveDisabled: true });
    try {
      const committed = await getAppStateRepository().transaction((latest) => {
        const profilesChanged = !profilesEqual(latest.profiles, nextProfiles);
        return {
          state: {
            ...latest,
            profiles: cloneProfiles(nextProfiles),
            ...refreshFlagsAfterProfileSave(latest, profilesChanged)
          },
          value: profilesChanged && Boolean(latest.currentPlan)
        };
      });

      sourceProfiles = cloneProfiles(nextProfiles);
      drafts = nextProfiles.map(profileToDraft);
      baselineDrafts = cloneDrafts(drafts);
      this.setData({
        drafts,
        hasUnsavedChanges: false,
        saveDisabled: true,
        savedMessage: committed.value
          ? "已保存在本机。当前菜单保持不变，请到今日页主动重新计算。"
          : "已保存在本机。"
      });
      wx.showToast({ title: "档案已保存", icon: "success" });
    } catch (error) {
      this.setData({
        pageError:
          error instanceof Error ? error.message : "保存失败，请稍后再试。"
      });
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    } finally {
      operationBusy = false;
      this.setData({
        busy: false,
        saveDisabled: !this.data.hasUnsavedChanges
      });
      await this.flushPendingRefresh();
    }
  },

  async onClearData() {
    if (operationBusy) return;
    const previousPageError = this.data.pageError;
    operationBusy = true;
    this.setData({ busy: true, saveDisabled: true, pageError: "" });
    try {
      const result = await wx.showModal({
        title: "清除本地数据？",
        content: "档案、普通偏好、过敏原过滤记录、菜单历史和购物勾选都会从这台设备删除。",
        confirmText: "清除",
        confirmColor: "#d64545"
      });
      if (!result.confirm) {
        this.setData({ pageError: previousPageError });
        return;
      }

      await getAppStateRepository().clearOwnedData();
      const reset = createDefaultAppState();
      sourceProfiles = cloneProfiles(reset.profiles);
      drafts = reset.profiles.map(profileToDraft);
      baselineDrafts = cloneDrafts(drafts);
      this.setData({
        drafts,
        hasUnsavedChanges: false,
        loadFailed: false,
        pageError: "",
        savedMessage: "本地数据已清除，档案已恢复为默认值。"
      });
    } catch (error) {
      this.setData({
        pageError:
          error instanceof Error ? error.message : "清除失败，请稍后再试。"
      });
      wx.showToast({ title: "清除失败，请重试", icon: "none" });
    } finally {
      operationBusy = false;
      this.setData({
        busy: false,
        loading: false,
        saveDisabled: !this.data.hasUnsavedChanges
      });
      await this.flushPendingRefresh();
    }
  }
});

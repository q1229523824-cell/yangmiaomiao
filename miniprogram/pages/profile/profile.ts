import type { Profile } from "../../domain/models";
import {
  createDefaultAppState,
  getAppStateRepository,
  refreshFlagsAfterProfileSave
} from "../../repositories/app-state";
import {
  clearAllOwnedData,
  createWxStorageAdapter
} from "../../repositories/storage";
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
    if (this.data.hasUnsavedChanges || operationBusy) return;
    await this.loadProfiles();
  },

  async loadProfiles() {
    if (operationBusy) return;
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
    }
  },

  onRetryLoad() {
    void this.loadProfiles();
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
    if (validations.some((result) => !result.profile)) {
      wx.showToast({ title: "请检查标红字段", icon: "none" });
      return;
    }

    const nextProfiles = validations.map((result) => result.profile as Profile);
    operationBusy = true;
    this.setData({ busy: true, saveDisabled: true });
    try {
      const state = await getAppStateRepository().load();
      const profilesChanged = !profilesEqual(state.profiles, nextProfiles);
      const markPlanStale = profilesChanged && Boolean(state.currentPlan);
      await getAppStateRepository().save({
        ...state,
        profiles: cloneProfiles(nextProfiles),
        ...refreshFlagsAfterProfileSave(state, profilesChanged)
      });

      sourceProfiles = cloneProfiles(nextProfiles);
      drafts = nextProfiles.map(profileToDraft);
      baselineDrafts = cloneDrafts(drafts);
      this.setData({
        drafts,
        hasUnsavedChanges: false,
        saveDisabled: true,
        savedMessage: markPlanStale
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
    }
  },

  async onClearData() {
    if (operationBusy) return;
    operationBusy = true;
    this.setData({ busy: true, saveDisabled: true, pageError: "" });
    try {
      const result = await wx.showModal({
        title: "清除本地数据？",
        content: "档案、普通偏好、过敏原安全设置、菜单历史和购物勾选都会从这台设备删除。",
        confirmText: "清除",
        confirmColor: "#d64545"
      });
      if (!result.confirm) return;

      await clearAllOwnedData(createWxStorageAdapter());
      const reset = createDefaultAppState();
      sourceProfiles = cloneProfiles(reset.profiles);
      drafts = reset.profiles.map(profileToDraft);
      baselineDrafts = cloneDrafts(drafts);
      this.setData({
        drafts,
        hasUnsavedChanges: false,
        loadFailed: false,
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
    }
  }
});

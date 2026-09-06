import type { Profile } from "../../domain/models";

export interface SelectOption {
  label: string;
  description: string;
  value: number;
}

export const ACTIVITY_OPTIONS: readonly SelectOption[] = [
  { label: "久坐少动", description: "日常以坐着为主，很少专门运动", value: 1.2 },
  { label: "轻量活动", description: "每周运动约 1–3 次", value: 1.375 },
  { label: "中等活动", description: "每周运动约 3–5 次", value: 1.55 },
  { label: "较高活动", description: "每周运动约 6–7 次", value: 1.725 },
  { label: "高强度活动", description: "高强度训练或体力劳动", value: 1.9 }
];

export const TARGET_OPTIONS: readonly SelectOption[] = [
  { label: "维持体重", description: "按估算消耗的 100% 安排热量", value: 1 },
  { label: "温和减脂", description: "比估算消耗少约 10%", value: 0.9 },
  { label: "标准减脂", description: "比估算消耗少约 20%", value: 0.8 },
  { label: "较快减脂", description: "比估算消耗少约 25%", value: 0.75 }
];

export interface ProfileDraftErrors {
  name: string;
  heightCm: string;
  weightKg: string;
  ageYears: string;
}

export interface ProfileDraft {
  id: string;
  emoji: string;
  name: string;
  heightCm: string;
  weightKg: string;
  ageYears: string;
  activityIndex: number;
  activityLabel: string;
  activityDescription: string;
  targetIndex: number;
  targetLabel: string;
  targetDescription: string;
  errors: ProfileDraftErrors;
}

export interface ProfileDraftValidation {
  draft: ProfileDraft;
  profile?: Profile;
}

const EMPTY_ERRORS: ProfileDraftErrors = {
  name: "",
  heightCm: "",
  weightKg: "",
  ageYears: ""
};

function closestOptionIndex(value: number, options: readonly SelectOption[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  options.forEach((option, index) => {
    const distance = Math.abs(option.value - value);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function displayNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

export function profileToDraft(profile: Profile): ProfileDraft {
  const activityIndex = closestOptionIndex(
    profile.goalSettings.activityFactor,
    ACTIVITY_OPTIONS
  );
  const targetIndex = closestOptionIndex(
    profile.goalSettings.calorieTargetRatio,
    TARGET_OPTIONS
  );
  const activity = ACTIVITY_OPTIONS[activityIndex];
  const target = TARGET_OPTIONS[targetIndex];
  return {
    id: profile.id,
    emoji: profile.emoji ?? "🙂",
    name: profile.name,
    heightCm: displayNumber(profile.heightCm),
    weightKg: displayNumber(profile.weightKg),
    ageYears: displayNumber(profile.ageYears),
    activityIndex,
    activityLabel: activity.label,
    activityDescription: activity.description,
    targetIndex,
    targetLabel: target.label,
    targetDescription: target.description,
    errors: { ...EMPTY_ERRORS }
  };
}

export function withActivityOption(draft: ProfileDraft, index: number): ProfileDraft {
  const safeIndex = Math.max(0, Math.min(ACTIVITY_OPTIONS.length - 1, index));
  const option = ACTIVITY_OPTIONS[safeIndex];
  return {
    ...draft,
    activityIndex: safeIndex,
    activityLabel: option.label,
    activityDescription: option.description
  };
}

export function withTargetOption(draft: ProfileDraft, index: number): ProfileDraft {
  const safeIndex = Math.max(0, Math.min(TARGET_OPTIONS.length - 1, index));
  const option = TARGET_OPTIONS[safeIndex];
  return {
    ...draft,
    targetIndex: safeIndex,
    targetLabel: option.label,
    targetDescription: option.description
  };
}

function requiredNumber(
  raw: string,
  label: string,
  minimum: number,
  maximum: number,
  integerOnly = false
): { value?: number; error: string } {
  const normalized = raw.trim();
  if (!normalized) return { error: `请填写${label}` };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { error: `${label}必须是数字` };
  if (integerOnly && !Number.isInteger(value)) return { error: `${label}请填写整数` };
  if (value < minimum || value > maximum) {
    return { error: `${label}应在 ${minimum}–${maximum} 之间` };
  }
  return { value, error: "" };
}

export function validateProfileDraft(
  draft: ProfileDraft,
  source: Profile
): ProfileDraftValidation {
  const name = draft.name.trim();
  const height = requiredNumber(draft.heightCm, "身高", 100, 230);
  const weight = requiredNumber(draft.weightKg, "体重", 30, 300);
  const age = requiredNumber(draft.ageYears, "年龄", 16, 100, true);
  const errors: ProfileDraftErrors = {
    name: name ? "" : "请填写称呼",
    heightCm: height.error,
    weightKg: weight.error,
    ageYears: age.error
  };
  const validatedDraft = { ...draft, errors };
  if (Object.values(errors).some(Boolean)) return { draft: validatedDraft };

  const activity = ACTIVITY_OPTIONS[draft.activityIndex] ?? ACTIVITY_OPTIONS[0];
  const target = TARGET_OPTIONS[draft.targetIndex] ?? TARGET_OPTIONS[0];
  return {
    draft: validatedDraft,
    profile: {
      ...source,
      name,
      heightCm: height.value as number,
      weightKg: weight.value as number,
      ageYears: age.value as number,
      goalSettings: {
        ...source.goalSettings,
        activityFactor: activity.value,
        calorieTargetRatio: target.value
      }
    }
  };
}

export function draftsEqual(
  left: readonly ProfileDraft[],
  right: readonly ProfileDraft[]
): boolean {
  if (left.length !== right.length) return false;
  return left.every((draft, index) => {
    const other = right[index];
    return (
      draft.id === other?.id &&
      draft.name === other.name &&
      draft.heightCm === other.heightCm &&
      draft.weightKg === other.weightKg &&
      draft.ageYears === other.ageYears &&
      draft.activityIndex === other.activityIndex &&
      draft.targetIndex === other.targetIndex
    );
  });
}

export function cloneDrafts(drafts: readonly ProfileDraft[]): ProfileDraft[] {
  return drafts.map((draft) => ({ ...draft, errors: { ...draft.errors } }));
}

import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILES } from "../miniprogram/data/defaults";
import {
  draftsEqual,
  profileToDraft,
  validateProfileDraft,
  withActivityOption,
  withTargetOption
} from "../miniprogram/pages/profile/profile-form";

describe("profile form", () => {
  it("keeps empty numeric text as a draft and reports the exact field on save", () => {
    const source = DEFAULT_PROFILES[0];
    const draft = {
      ...profileToDraft(source),
      heightCm: "",
      weightKg: "not-a-number",
      ageYears: "18.5"
    };

    expect(draft.heightCm).toBe("");
    const result = validateProfileDraft(draft, source);
    expect(result.profile).toBeUndefined();
    expect(result.draft.errors).toEqual({
      name: "",
      heightCm: "请填写身高",
      weightKg: "体重必须是数字",
      ageYears: "年龄请填写整数"
    });
  });

  it("validates ranges independently instead of returning one generic error", () => {
    const source = DEFAULT_PROFILES[0];
    const result = validateProfileDraft(
      {
        ...profileToDraft(source),
        name: "   ",
        heightCm: "99",
        weightKg: "301",
        ageYears: "15"
      },
      source
    );

    expect(result.profile).toBeUndefined();
    expect(result.draft.errors.name).toBe("请填写称呼");
    expect(result.draft.errors.heightCm).toContain("100–230");
    expect(result.draft.errors.weightKg).toContain("30–300");
    expect(result.draft.errors.ageYears).toContain("16–100");
  });

  it("converts valid drafts and selected activity/target options into a profile", () => {
    const source = DEFAULT_PROFILES[0];
    let draft = profileToDraft(source);
    draft = {
      ...draft,
      name: "  喵喵  ",
      heightCm: "171.5",
      weightKg: "62.5",
      ageYears: "26"
    };
    draft = withActivityOption(draft, 1);
    draft = withTargetOption(draft, 1);

    const result = validateProfileDraft(draft, source);
    expect(result.profile).toMatchObject({
      name: "喵喵",
      heightCm: 171.5,
      weightKg: 62.5,
      ageYears: 26,
      goalSettings: {
        activityFactor: 1.375,
        calorieTargetRatio: 0.9,
        proteinGPerKg: source.goalSettings.proteinGPerKg,
        fatGPerKg: source.goalSettings.fatGPerKg
      }
    });
  });

  it("tracks meaningful edits while ignoring validation message changes", () => {
    const original = profileToDraft(DEFAULT_PROFILES[0]);
    const withError = {
      ...original,
      errors: { ...original.errors, name: "请填写称呼" }
    };
    expect(draftsEqual([original], [withError])).toBe(true);
    expect(draftsEqual([original], [{ ...original, weightKg: "64" }])).toBe(false);
  });
});

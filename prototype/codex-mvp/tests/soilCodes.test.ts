import { describe, expect, it } from "vitest";
import {
  decodedSoilProfile,
  drainageCategoryFromProfile,
  hasMaterialUplandLimit,
  uplandGradeNumber,
} from "@/lib/analysis/soilCodes";
import type { SoilPhysicalProfile } from "@/types/domain";

const profile: SoilPhysicalProfile = {
  drainageCode: "02",
  effectiveDepthCode: "04",
  erosionCode: "01",
  topsoilTextureCode: "04",
  mainLandUseCode: "03",
  useRecommendationCode: "03",
  uplandGradeCode: "04",
  uplandLimitingFactorCode: "02",
  orchardGradeCode: "03",
  orchardLimitingFactorCode: "02",
};

describe("Soil V3 official code tables", () => {
  it("시연 필지의 공식 코드를 사람이 읽는 값으로 해석한다", () => {
    expect(decodedSoilProfile(profile)).toMatchObject({
      drainage: "양호",
      effectiveDepth: "깊음 · 100cm 이상",
      topsoilTexture: "세사양토",
      mainLandUse: "과수·상전",
      uplandGrade: "4급지",
      uplandLimitingFactor: "경사",
    });
  });

  it("공식 세부 배수등급은 단기 위험용 3단계로만 묶는다", () => {
    expect(drainageCategoryFromProfile(profile)).toBe("good");
    expect(drainageCategoryFromProfile({ ...profile, drainageCode: "04" }))
      .toBe("moderate");
    expect(drainageCategoryFromProfile({ ...profile, drainageCode: "06" }))
      .toBe("poor");
  });

  it("밭 등급과 저해요인 유무를 판정 입력으로 반환한다", () => {
    expect(uplandGradeNumber(profile)).toBe(4);
    expect(hasMaterialUplandLimit(profile)).toBe(true);
    expect(hasMaterialUplandLimit({ ...profile, uplandLimitingFactorCode: "01" }))
      .toBe(false);
  });
});

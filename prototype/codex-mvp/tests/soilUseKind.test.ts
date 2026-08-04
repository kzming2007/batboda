import { describe, expect, it, vi } from "vitest";

// 공공데이터 클라이언트는 `server-only`를 참조한다. 이 표식은 Next 런타임이 제공하므로
// 테스트에서는 빈 모듈로 대체해 순수 함수만 불러온다.
vi.mock("server-only", () => ({}));

import { analyzeFarm } from "@/lib/analysis/engine";
import { cropProfiles } from "@/lib/analysis/cropProfiles";
import { decodedSoilProfile } from "@/lib/analysis/soilCodes";
import { parseSoilPhysicalProfile } from "@/lib/public-data/client";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import {
  verifiedParcel,
  verifiedRecentClimate,
  verifiedSoil,
  verifiedWeather,
} from "@/lib/cache/verifiedSnapshot";
import snapshot from "@/lib/report/snapshots/llmResponses.json";
import type { AnalysisSelection, CropId, SoilPhysicalProfile } from "@/types/domain";

/**
 * 토양특성 V3는 같은 필지에 밭·논·과수 적성등급을 따로 준다.
 * 판정은 작물 종류에 맞는 등급을 봐야 한다. 사과·배는 과수, 상추·오이·감자는 밭이다.
 * 논 등급은 아직 판정에 넣지 않고 값만 읽어 둔다.
 */

const demo: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

const cropNames: Record<CropId, string> = {
  lettuce: "상추",
  apple: "사과",
  pear: "배",
  cucumber: "오이",
  potato: "감자",
};

/** 시연 자료의 물리 항목은 밭 4급지 · 과수 3급지로 서로 다르다. 이 차이로 어느 등급을 봤는지 가른다. */
function analyzeWith(
  cropId: CropId,
  patch: Partial<SoilPhysicalProfile> = {},
  ph?: number,
) {
  const selection = { ...demo, cropId };
  const soil = createMockSoil(selection);
  return analyzeFarm({
    mode: "live",
    selection,
    parcel: createMockParcel(selection, "connected"),
    soil: {
      ...soil,
      ph: ph ?? soil.ph,
      physicalProfile: { ...soil.physicalProfile!, ...patch },
      status: "connected",
    },
    weather: { ...createMockWeather(selection), status: "connected" },
    analyzedAt: "2026-08-04T00:00:00.000Z",
  });
}

const gradeFactorOf = (result: ReturnType<typeof analyzeWith>) =>
  result.factors.find((factor) => factor.id === "upland-suitability");

const gradePenaltyOf = (result: ReturnType<typeof analyzeWith>) =>
  result.scoreExplanations.suitability.terms.find(
    (term) => term.id === "upland-grade-penalty",
  )?.value;

describe("작물 종류에 맞는 적성등급", () => {
  it("사과와 배는 과수 적성등급을 판정에 쓴다", () => {
    for (const cropId of ["apple", "pear"] as const) {
      const result = analyzeWith(cropId);

      expect(cropProfiles[cropId].soilUseKind).toBe("orchard");
      expect(gradeFactorOf(result)?.label).toBe("과수 적성등급");
      // 시연 자료는 과수 3급지 · 밭 4급지다. 3급지가 나와야 과수 등급을 본 것이다.
      expect(gradeFactorOf(result)?.value).toBe("3급지");
      expect(gradePenaltyOf(result)).toBe(25);
      expect(result.scoreExplanations.suitability.formula).toContain("과수 등급");
    }
  });

  it("상추·오이·감자는 밭 적성등급을 그대로 쓴다", () => {
    for (const cropId of ["lettuce", "cucumber", "potato"] as const) {
      const result = analyzeWith(cropId);

      expect(cropProfiles[cropId].soilUseKind).toBe("upland");
      expect(gradeFactorOf(result)?.label).toBe("밭 적성등급");
      expect(gradeFactorOf(result)?.value).toBe("4급지");
      expect(gradePenaltyOf(result)).toBe(40);
      expect(result.scoreExplanations.suitability.formula).toContain("밭 등급");
    }
  });

  it("밭 등급이 나빠도 과수 작물의 판정은 움직이지 않는다", () => {
    const good = { orchardGradeCode: "01", orchardLimitingFactorCode: "01" };
    const appleBaseline = analyzeWith("apple", { ...good, uplandGradeCode: "01" }, 6.2);
    const appleWithBadUpland = analyzeWith(
      "apple",
      { ...good, uplandGradeCode: "05", uplandLimitingFactorCode: "02" },
      6.2,
    );

    expect(appleBaseline.suitabilityLabel).toBe("적합");
    expect(appleWithBadUpland.suitabilityLabel).toBe(appleBaseline.suitabilityLabel);
    expect(appleWithBadUpland.suitabilityScore).toBe(appleBaseline.suitabilityScore);

    // 같은 필지·같은 등급이라도 밭작물은 밭 등급을 보므로 판정이 바뀐다.
    const potato = analyzeWith(
      "potato",
      { ...good, uplandGradeCode: "05", uplandLimitingFactorCode: "02" },
      5.5,
    );
    expect(potato.suitabilityLabel).toBe("현장 확인 필요");
  });

  it("과수 저해요인을 과수 작물의 판정 근거로 읽는다", () => {
    const result = analyzeWith(
      "apple",
      {
        uplandGradeCode: "01",
        uplandLimitingFactorCode: "01",
        orchardGradeCode: "02",
        orchardLimitingFactorCode: "03",
      },
      6.2,
    );

    expect(result.suitabilityLabel).toBe("조건부 적합");
    expect(gradeFactorOf(result)?.state).toBe("watch");
    expect(gradeFactorOf(result)?.impact).toContain("저습");
  });
});

describe("논 적성등급", () => {
  it("판정에 넣지 않고 값만 보관한다", () => {
    for (const cropId of ["potato", "apple"] as const) {
      const fit = analyzeWith(cropId, { paddyGradeCode: "01", paddyLimitingFactorCode: "01" });
      const unfit = analyzeWith(cropId, { paddyGradeCode: "05", paddyLimitingFactorCode: "03" });

      expect(unfit.suitabilityLabel).toBe(fit.suitabilityLabel);
      expect(unfit.suitabilityScore).toBe(fit.suitabilityScore);
      expect(unfit.factors).toEqual(fit.factors);
    }
  });

  it("코드표로 해석한 값을 화면이 쓸 수 있게 함께 돌려준다", () => {
    const decoded = decodedSoilProfile({
      drainageCode: "03",
      effectiveDepthCode: "03",
      erosionCode: "01",
      topsoilTextureCode: "04",
      mainLandUseCode: "01",
      useRecommendationCode: "01",
      uplandGradeCode: "02",
      uplandLimitingFactorCode: "03",
      orchardGradeCode: "02",
      orchardLimitingFactorCode: "03",
      paddyGradeCode: "03",
      paddyLimitingFactorCode: "03",
    });

    expect(decoded).toMatchObject({
      uplandGrade: "2급지",
      orchardGrade: "2급지",
      paddyGrade: "3급지",
      paddyLimitingFactor: "저습",
    });
  });

  it("논 항목이 없는 예전 자료는 없다고 표시한다", () => {
    const soil = createMockSoil(demo);
    const decoded = decodedSoilProfile(soil.physicalProfile!);

    expect(decoded.paddyGrade).toBe("확인되지 않음");
  });
});

describe("토양특성 V3 응답 해석", () => {
  // 2026-08-04 실측 응답의 항목 이름과 값이다(대관령면 85-61전 밭 02·논 03·과수 02).
  it("밭·논·과수 등급과 저해요인을 모두 읽는다", () => {
    expect(
      parseSoilPhysicalProfile({
        Soildra_Cd: "03",
        Vldsoildep_Cd: "03",
        Erosion_Cd: "01",
        Surtture_Cd: "04",
        Main_Landuse_Cd: "01",
        Soil_Use_Rec_Cd: "01",
        Pfld_Grd_Cd: "02",
        Upland_Factor_Cd: "03",
        Rfld_Grd_Cd: "03",
        Paddy_Factor_Cd: "03",
        Fruit_Grd_Cd: "02",
        Fruit_Factor_Cd: "03",
      }),
    ).toMatchObject({
      uplandGradeCode: "02",
      uplandLimitingFactorCode: "03",
      paddyGradeCode: "03",
      paddyLimitingFactorCode: "03",
      orchardGradeCode: "02",
      orchardLimitingFactorCode: "03",
    });
  });

  it("응답에 없는 항목은 null로 남긴다", () => {
    expect(parseSoilPhysicalProfile({ Pfld_Grd_Cd: "02" })).toMatchObject({
      uplandGradeCode: "02",
      paddyGradeCode: null,
      orchardGradeCode: null,
    });
    expect(parseSoilPhysicalProfile(undefined)).toBeNull();
  });
});

/**
 * 저장해 둔 시연 조합의 판정이 바뀌면 04 리포트가 저장본을 재생하지 못하고 규칙 문장으로 내려간다.
 * 85-61전은 밭 02와 과수 02, 저해요인 03과 03이 같은 값이라 과수 작물도 판정이 그대로여야 한다.
 */
describe("저장한 시연 조합의 판정 유지", () => {
  const storedStage = (crop: string, horizonDays: number) =>
    (snapshot as {
      records: { key: string; capturedAt?: { stage: string } }[];
    }).records.find((record) => record.key === `대관령면 85-61전|${crop}|${horizonDays}`)
      ?.capturedAt?.stage;

  const analyzeSnapshot = (cropId: CropId, horizonDays: 1 | 3) => {
    const selection = { ...demo, cropId, horizonDays };
    return analyzeFarm({
      mode: "fallback",
      selection,
      parcel: verifiedParcel(selection)!,
      soil: verifiedSoil(selection)!,
      weather: verifiedWeather(selection)!,
      recentClimate: verifiedRecentClimate(selection)!,
      analyzedAt: "2026-08-04T00:00:00.000Z",
    });
  };

  it("밭 등급과 과수 등급이 같은 필지다", () => {
    const profile = verifiedSoil(demo)!.physicalProfile!;

    expect(profile.orchardGradeCode).toBe(profile.uplandGradeCode);
    expect(profile.orchardLimitingFactorCode).toBe(profile.uplandLimitingFactorCode);
  });

  it.each([
    { cropId: "lettuce" as const, horizonDays: 3 as const },
    { cropId: "apple" as const, horizonDays: 3 as const },
    { cropId: "pear" as const, horizonDays: 3 as const },
    { cropId: "cucumber" as const, horizonDays: 3 as const },
    { cropId: "potato" as const, horizonDays: 3 as const },
    { cropId: "lettuce" as const, horizonDays: 1 as const },
  ])("$cropId $horizonDays일 조합의 판정 단계가 저장본과 같다", ({ cropId, horizonDays }) => {
    const stage = storedStage(cropNames[cropId], horizonDays);

    expect(stage).toBeDefined();
    expect(analyzeSnapshot(cropId, horizonDays).suitabilityLabel).toBe(stage);
  });
});

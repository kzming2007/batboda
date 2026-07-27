import { describe, expect, it } from "vitest";
import { analyzeFarm } from "@/lib/analysis/engine";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import type { AnalysisSelection } from "@/types/domain";

const selection: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

describe("analyzeFarm", () => {
  it("같은 입력에 같은 점수와 행동을 반환한다", () => {
    const input = {
      mode: "mock" as const,
      selection,
      parcel: createMockParcel(selection),
      soil: createMockSoil(selection),
      weather: createMockWeather(selection),
      analyzedAt: "2026-07-23T00:00:00.000Z",
    };

    const first = analyzeFarm(input);
    const second = analyzeFarm(input);

    expect(first.suitabilityScore).toBe(second.suitabilityScore);
    expect(first.riskScore).toBe(second.riskScore);
    expect(first.actions).toEqual(second.actions);
  });

  it("강수와 습도가 높으면 선택 기간 위험을 주의 이상으로 분류한다", () => {
    const result = analyzeFarm({
      mode: "mock",
      selection,
      parcel: createMockParcel(selection),
      soil: createMockSoil(selection),
      weather: createMockWeather(selection),
    });

    expect(result.riskScore).toBeGreaterThanOrEqual(35);
    expect(["moderate", "high"]).toContain(result.riskLevel);
    expect(result.actions.some((action) => action.title.includes("배수"))).toBe(true);
  });

  it("감자는 저온·다습·비 복합 운영 조건을 역병 예찰 신호로 표시한다", () => {
    const result = analyzeFarm({
      mode: "mock",
      selection,
      parcel: createMockParcel(selection),
      soil: createMockSoil(selection),
      weather: createMockWeather(selection),
    });
    const advisory = result.factors.find(
      (factor) => factor.id === "potato-late-blight-watch",
    );

    expect(advisory?.value).toBe("예찰 필요 · 1일");
    expect(advisory?.state).toBe("watch");
    expect(advisory?.impact).toContain("현장 예찰");
    expect(result.actions[0].title).toContain("역병");
    expect(result.scoreExplanations.risk.caveat).toContain("중복 가산하지 않습니다");
  });

  it("감자 복합 조건이 맞지 않으면 역병 행동을 우선 제시하지 않는다", () => {
    const weather = createMockWeather(selection);
    weather.days = weather.days.map((day) => ({
      ...day,
      rainProbability: 10,
      precipitation: 0,
      humidity: 70,
    }));
    const result = analyzeFarm({
      mode: "mock",
      selection,
      parcel: createMockParcel(selection),
      soil: createMockSoil(selection),
      weather,
    });
    const advisory = result.factors.find(
      (factor) => factor.id === "potato-late-blight-watch",
    );

    expect(advisory?.state).toBe("good");
    expect(advisory?.value).toBe("현재 복합 신호 없음");
    expect(advisory?.impact).toContain("세 조건이 함께 나타나지 않음");
    expect(result.actions.some((action) => action.title.includes("역병"))).toBe(false);
  });

  it("공식 화면과 교차한 EC는 dS/m로 표시하되 점수에는 반영하지 않는다", () => {
    const soil = createMockSoil(selection);
    soil.electricalConductivity = 1.413;
    soil.electricalConductivityUnit = "dS/m";
    soil.electricalConductivityUnitStatus = "official-cross-reference";
    const result = analyzeFarm({
      mode: "live",
      selection,
      parcel: createMockParcel(selection, "connected"),
      soil: { ...soil, status: "connected" },
      weather: { ...createMockWeather(selection), status: "connected" },
    });
    const ec = result.factors.find(
      (factor) => factor.id === "electrical-conductivity",
    );

    expect(ec?.value).toBe("1.41 dS/m");
    expect(ec?.impact).toContain("교차확인한 dS/m");
    expect(result.scoreExplanations.suitability.formula).not.toContain("EC");
  });

  it("값이 없을 때 확신도를 낮추고 미확인 요인을 표시한다", () => {
    const soil = createMockSoil(selection);
    soil.ph = null;
    soil.organicMatter = null;
    soil.drainage = "good";
    const weather = createMockWeather(selection);
    weather.days = weather.days.map((day) => ({ ...day, maxTemp: null }));

    const result = analyzeFarm({
      mode: "fallback",
      selection,
      parcel: createMockParcel(selection),
      soil,
      weather,
    });

    expect(result.confidence).toBeLessThan(50);
    expect(result.factors.filter((factor) => factor.state === "unknown")).toHaveLength(2);
    expect(result.factors.find((factor) => factor.id === "organic")?.state).toBe("info");
  });

  it("배수는 밭 적성등급과 적합 지수에 중복 반영하지 않는다", () => {
    const knownSoil = createMockSoil(selection);
    knownSoil.ph = 5.5;
    knownSoil.physicalProfile = {
      ...knownSoil.physicalProfile!,
      drainageCode: "02",
      uplandGradeCode: "02",
      uplandLimitingFactorCode: "01",
    };
    const poorDrainageSoil = {
      ...knownSoil,
      drainage: "poor" as const,
      physicalProfile: { ...knownSoil.physicalProfile, drainageCode: "06" },
    };
    const weather = createMockWeather(selection);

    const known = analyzeFarm({
      mode: "live",
      selection,
      parcel: createMockParcel(selection, "connected"),
      soil: { ...knownSoil, status: "connected" },
      weather: { ...weather, status: "connected" },
    });
    const poorDrainage = analyzeFarm({
      mode: "live",
      selection,
      parcel: createMockParcel(selection, "connected"),
      soil: { ...poorDrainageSoil, status: "connected" },
      weather: { ...weather, status: "connected" },
    });

    expect(poorDrainage.suitabilityScore).toBe(known.suitabilityScore);
    expect(poorDrainage.suitabilityLabel).toBe(known.suitabilityLabel);
    expect(poorDrainage.riskScore).toBeGreaterThan(known.riskScore);
  });

  it("단위 미확인 EC와 유기물은 표시하지만 토양 기초 적합도 점수에는 반영하지 않는다", () => {
    const baseSoil = createMockSoil(selection);
    const weather = createMockWeather(selection);
    const analyzeWithReferenceValues = (
      organicMatter: number,
      electricalConductivity: number,
    ) =>
      analyzeFarm({
        mode: "live",
        selection,
        parcel: createMockParcel(selection, "connected"),
        soil: {
          ...baseSoil,
          organicMatter,
          electricalConductivity,
          electricalConductivityUnit: null,
          electricalConductivityUnitStatus: "api-unspecified",
          status: "connected",
        },
        weather: { ...weather, status: "connected" },
      });

    const low = analyzeWithReferenceValues(5, 0.5);
    const high = analyzeWithReferenceValues(80, 4.25);

    expect(low.suitabilityScore).toBe(high.suitabilityScore);
    expect(low.factors.find((factor) => factor.id === "organic")?.target)
      .toContain("점수 미반영");
    expect(high.factors.find((factor) => factor.id === "electrical-conductivity")?.value)
      .toContain("API 단위 미표기");
    expect(high.requirementCoverage.find((item) => item.id === "soil")?.status)
      .toBe("partial");
  });

  it("공식 범위에서 더 멀리 벗어날수록 pH 감점을 연속적으로 키운다", () => {
    const baseSoil = createMockSoil(selection);
    baseSoil.drainage = "good";
    const weather = createMockWeather(selection);
    const analyzeWithPh = (ph: number) =>
      analyzeFarm({
        mode: "live",
        selection,
        parcel: createMockParcel(selection, "connected"),
        soil: { ...baseSoil, ph, status: "connected" },
        weather: { ...weather, status: "connected" },
      });

    const slight = analyzeWithPh(6.2);
    const large = analyzeWithPh(7.0);

    expect(large.suitabilityScore).toBeLessThan(slight.suitabilityScore);
    expect(large.scoreExplanations.suitability.terms.find((term) => term.id === "ph-penalty")?.value)
      .toBeGreaterThan(
        slight.scoreExplanations.suitability.terms.find((term) => term.id === "ph-penalty")?.value ?? 0,
      );
  });

  it("같은 강수 신호에도 작물별 과습 민감도를 다르게 반영한다", () => {
    const appleSelection = { ...selection, cropId: "apple" as const };
    const potatoWeather = createMockWeather(selection);
    potatoWeather.days = potatoWeather.days.map((day) => ({
      ...day,
      minTemp: null,
      maxTemp: null,
      rainProbability: 80,
      humidity: 0,
    }));
    const appleWeather = { ...potatoWeather, days: potatoWeather.days.map((day) => ({ ...day })) };

    const potato = analyzeFarm({
      mode: "mock",
      selection,
      parcel: createMockParcel(selection),
      soil: { ...createMockSoil(selection), drainage: "good" },
      weather: potatoWeather,
    });
    const apple = analyzeFarm({
      mode: "mock",
      selection: appleSelection,
      parcel: createMockParcel(appleSelection),
      soil: { ...createMockSoil(appleSelection), drainage: "good" },
      weather: appleWeather,
    });

    expect(potato.riskScore).toBeGreaterThan(apple.riskScore);
    expect(potato.scoreExplanations.risk.terms.find((term) => term.id === "rain-contribution")?.label)
      .toContain("1.30");
  });

  it("허용범위 밖 입력은 계산에서 제외하고 품질 표식에 기록한다", () => {
    const soil = createMockSoil(selection);
    soil.ph = 99;
    soil.organicMatter = -10;
    const weather = createMockWeather(selection);
    weather.days = weather.days.map((day) => ({
      ...day,
      minTemp: -90,
      maxTemp: 100,
      rainProbability: 140,
      humidity: -5,
    }));

    const result = analyzeFarm({
      mode: "live",
      selection,
      parcel: createMockParcel(selection, "connected"),
      soil: { ...soil, status: "connected" },
      weather: { ...weather, status: "connected" },
    });

    expect(result.factors.find((factor) => factor.id === "ph")?.value).toBe("이상치 제외");
    expect(result.evidenceQuality.outlierCount).toBeGreaterThanOrEqual(4);
    expect(result.evidenceQuality.marks).toBeGreaterThanOrEqual(1);
    expect(result.scoreExplanations.confidence.formula).toContain("이상치");
  });

  it("오이는 선택 기간의 낮·밤 기온을 공식 범위와 따로 대조한다", () => {
    const cucumberSelection = { ...selection, cropId: "cucumber" as const };
    const result = analyzeFarm({
      mode: "mock",
      selection: cucumberSelection,
      parcel: createMockParcel(cucumberSelection),
      soil: createMockSoil(cucumberSelection),
      weather: createMockWeather(cucumberSelection),
    });
    const temperature = result.factors.find((factor) => factor.id === "temperature");

    expect(temperature?.value).toContain("낮");
    expect(temperature?.value).toContain("밤");
    expect(temperature?.target).toContain("22–28℃");
    expect(temperature?.target).toContain("15–18℃");
  });

  it("최종 지수와 계산 장부의 산식을 함께 반환한다", () => {
    const result = analyzeFarm({
      mode: "mock",
      selection,
      parcel: createMockParcel(selection),
      soil: createMockSoil(selection),
      weather: createMockWeather(selection),
    });

    expect(result.scoreExplanations.suitability.formula).toContain(`= ${result.suitabilityScore}`);
    expect(result.scoreExplanations.risk.formula).toContain(`= ${result.riskScore}`);
    expect(result.scoreExplanations.confidence.formula).toContain(`= ${result.confidence}`);
    expect(result.scoreExplanations.risk.caveat).toContain("발생 확률");
  });

  it.each([
    { grade: "01", limiter: "01", ph: 5.5, expected: "적합" },
    { grade: "03", limiter: "01", ph: 5.5, expected: "조건부 적합" },
    { grade: "04", limiter: "02", ph: 5.5, expected: "현장 확인 필요" },
    { grade: "01", limiter: "01", ph: 7.0, expected: "현장 확인 필요" },
  ])("밭 등급 $grade와 pH $ph를 단계 우선 규칙으로 판정한다", ({ grade, limiter, ph, expected }) => {
    const soil = createMockSoil(selection);
    soil.ph = ph;
    soil.physicalProfile = {
      ...soil.physicalProfile!,
      uplandGradeCode: grade,
      uplandLimitingFactorCode: limiter,
    };
    const result = analyzeFarm({
      mode: "live",
      selection,
      parcel: createMockParcel(selection, "connected"),
      soil: { ...soil, status: "connected" },
      weather: { ...createMockWeather(selection), status: "connected" },
    });

    expect(result.suitabilityLabel).toBe(expected);
  });

  it("핵심 pH 또는 밭 적성등급이 없으면 현장 확인 필요로 판정한다", () => {
    const missingPh = createMockSoil(selection);
    missingPh.ph = null;
    const missingGrade = createMockSoil(selection);
    missingGrade.ph = 5.5;
    missingGrade.physicalProfile = null;
    const common = {
      mode: "live" as const,
      selection,
      parcel: createMockParcel(selection, "connected"),
      weather: { ...createMockWeather(selection), status: "connected" as const },
    };

    expect(analyzeFarm({ ...common, soil: missingPh }).suitabilityLabel)
      .toBe("현장 확인 필요");
    expect(analyzeFarm({ ...common, soil: missingGrade }).suitabilityLabel)
      .toBe("현장 확인 필요");
  });
});

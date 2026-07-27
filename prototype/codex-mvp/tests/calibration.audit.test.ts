import { describe, expect, it } from "vitest";
import { analyzeFarm } from "@/lib/analysis/engine";
import { baselineEnginePolicy, scaledEnginePolicy } from "@/lib/analysis/modelPolicy";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import type { AnalysisSelection, CropId, SoilData, WeatherData } from "@/types/domain";

const baseSelection: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

const crops: CropId[] = ["apple", "pear", "cucumber", "potato", "lettuce"];
const phValues = [4.5, 5, 5.5, 6, 6.5, 7, 7.5];
const drainageValues: SoilData["drainage"][] = ["good", "moderate", "poor", "unknown"];
const weatherScenarios = [
  { minTemp: 8, maxTemp: 14, rainProbability: 10, humidity: 55 },
  { minTemp: 15, maxTemp: 22, rainProbability: 20, humidity: 65 },
  { minTemp: 16, maxTemp: 24, rainProbability: 80, humidity: 90 },
  { minTemp: 25, maxTemp: 35, rainProbability: 90, humidity: 95 },
];

function scenarioWeather(
  selection: AnalysisSelection,
  scenario: (typeof weatherScenarios)[number],
): WeatherData {
  const weather = createMockWeather(selection);
  return {
    ...weather,
    days: weather.days.map((day) => ({
      ...day,
      minTemp: scenario.minTemp,
      maxTemp: scenario.maxTemp,
      rainProbability: scenario.rainProbability,
      humidity: scenario.humidity,
      precipitation: scenario.rainProbability >= 60 ? 8 : 0,
    })),
  };
}

describe("engine calibration audit", () => {
  it("pH가 공식 범위에서 멀어질 때 적합 지수가 역으로 오르지 않는다", () => {
    for (const cropId of crops) {
      const selection = { ...baseSelection, cropId };
      const profileCenters: Record<CropId, number> = {
        apple: 6.25,
        pear: 6,
        cucumber: 6.25,
        potato: 5.5,
        lettuce: 6.75,
      };
      const scores = [0, 0.25, 0.5, 1, 2].map((offset) => {
        const soil = createMockSoil(selection);
        soil.ph = profileCenters[cropId] + offset;
        soil.drainage = "good";
        return analyzeFarm({
          mode: "mock",
          selection,
          parcel: createMockParcel(selection),
          soil,
          weather: createMockWeather(selection),
        }).suitabilityScore;
      });

      for (let index = 1; index < scores.length; index += 1) {
        expect(scores[index]).toBeLessThanOrEqual(scores[index - 1]);
      }
    }
  });

  it("운영 감점 폭을 ±20% 바꿔도 주판정 단계가 바뀌지 않는지 계측한다", () => {
    const policies = {
      lenient: scaledEnginePolicy(0.8),
      baseline: baselineEnginePolicy,
      conservative: scaledEnginePolicy(1.2),
    };
    let scenarios = 0;
    let lenientSuitabilityFlips = 0;
    let conservativeSuitabilityFlips = 0;
    let lenientRiskFlips = 0;
    let conservativeRiskFlips = 0;

    for (const cropId of crops) {
      const selection = { ...baseSelection, cropId };
      for (const ph of phValues) {
        for (const drainage of drainageValues) {
          for (const weatherScenario of weatherScenarios) {
            const soil = createMockSoil(selection);
            soil.ph = ph;
            soil.drainage = drainage;
            const input = {
              mode: "mock" as const,
              selection,
              parcel: createMockParcel(selection),
              soil,
              weather: scenarioWeather(selection, weatherScenario),
              analyzedAt: "2026-07-24T00:00:00.000Z",
            };
            const baseline = analyzeFarm(input, policies.baseline);
            const lenient = analyzeFarm(input, policies.lenient);
            const conservative = analyzeFarm(input, policies.conservative);

            scenarios += 1;
            lenientSuitabilityFlips += Number(
              lenient.suitabilityLabel !== baseline.suitabilityLabel,
            );
            conservativeSuitabilityFlips += Number(
              conservative.suitabilityLabel !== baseline.suitabilityLabel,
            );
            lenientRiskFlips += Number(lenient.riskLevel !== baseline.riskLevel);
            conservativeRiskFlips += Number(
              conservative.riskLevel !== baseline.riskLevel,
            );
          }
        }
      }
    }

    const percentage = (count: number) => Number(((count / scenarios) * 100).toFixed(1));
    const report = {
      scenarios,
      suitabilityLabelFlipRate: {
        lenient: percentage(lenientSuitabilityFlips),
        conservative: percentage(conservativeSuitabilityFlips),
      },
      riskLabelFlipRate: {
        lenient: percentage(lenientRiskFlips),
        conservative: percentage(conservativeRiskFlips),
      },
    };

    console.info(`CALIBRATION_AUDIT ${JSON.stringify(report)}`);
    expect(scenarios).toBe(560);
    expect(lenientSuitabilityFlips + conservativeSuitabilityFlips).toBe(0);
    expect(
      lenientRiskFlips + conservativeRiskFlips,
    ).toBeGreaterThan(0);
  });
});

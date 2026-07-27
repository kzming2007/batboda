import type { SensitivityLevel } from "@/lib/analysis/cropProfiles";

export type EnginePolicy = {
  version: string;
  rainProbabilityWatch: number;
  humidityWatch: number;
  ph: {
    maxPenalty: number;
    unknownPenalty: number;
  };
  temperature: {
    maxPenalty: number;
    unknownPenalty: number;
  };
  uplandGradePenalty: Record<1 | 2 | 3 | 4 | 5, number> & {
    unknown: number;
  };
  riskContribution: {
    rainMax: number;
    humidityMax: number;
    drainagePoor: number;
    drainageModerate: number;
  };
  sensitivityMultipliers: Record<SensitivityLevel, number>;
  riskThresholds: {
    high: number;
    moderate: number;
  };
};

// 문제정의서의 설명 가능한 baseline을 구현하기 위한 운영 파라미터다.
// 작물 지침에서 확인한 적정 범위와 달리, 아래 감점 폭·등급 경계·민감도 배율은
// 아직 현장 라벨이나 전문가 합의로 보정되지 않았으므로 검증된 농업 계수로 취급하지 않는다.
export const baselineEnginePolicy: EnginePolicy = {
  version: "v4-stage-first",
  rainProbabilityWatch: 60,
  humidityWatch: 85,
  ph: {
    maxPenalty: 32,
    unknownPenalty: 18,
  },
  temperature: {
    maxPenalty: 30,
    unknownPenalty: 12,
  },
  uplandGradePenalty: {
    1: 0,
    2: 10,
    3: 25,
    4: 40,
    5: 60,
    unknown: 30,
  },
  riskContribution: {
    rainMax: 28,
    humidityMax: 20,
    drainagePoor: 14,
    drainageModerate: 5,
  },
  sensitivityMultipliers: {
    standard: 1,
    sensitive: 1.15,
    "very-sensitive": 1.3,
  },
  riskThresholds: {
    high: 65,
    moderate: 35,
  },
};

export function scaledEnginePolicy(scale: number): EnginePolicy {
  return {
    ...baselineEnginePolicy,
    version: `${baselineEnginePolicy.version}@${scale.toFixed(2)}`,
    ph: {
      maxPenalty: baselineEnginePolicy.ph.maxPenalty * scale,
      unknownPenalty: baselineEnginePolicy.ph.unknownPenalty,
    },
    temperature: {
      maxPenalty: baselineEnginePolicy.temperature.maxPenalty * scale,
      unknownPenalty: baselineEnginePolicy.temperature.unknownPenalty,
    },
    uplandGradePenalty: {
      1: baselineEnginePolicy.uplandGradePenalty[1] * scale,
      2: baselineEnginePolicy.uplandGradePenalty[2] * scale,
      3: baselineEnginePolicy.uplandGradePenalty[3] * scale,
      4: baselineEnginePolicy.uplandGradePenalty[4] * scale,
      5: baselineEnginePolicy.uplandGradePenalty[5] * scale,
      unknown: baselineEnginePolicy.uplandGradePenalty.unknown,
    },
    riskContribution: {
      rainMax: baselineEnginePolicy.riskContribution.rainMax * scale,
      humidityMax: baselineEnginePolicy.riskContribution.humidityMax * scale,
      drainagePoor: baselineEnginePolicy.riskContribution.drainagePoor * scale,
      drainageModerate: baselineEnginePolicy.riskContribution.drainageModerate * scale,
    },
  };
}

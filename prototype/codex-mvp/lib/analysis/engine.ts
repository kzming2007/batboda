import { cropProfiles } from "@/lib/analysis/cropProfiles";
import { createMockRecentClimate } from "@/lib/mock/data";
import {
  baselineEnginePolicy,
  type EnginePolicy,
} from "@/lib/analysis/modelPolicy";
import {
  decodedSoilProfile,
  drainageCategoryFromProfile,
  hasMaterialUplandLimit,
  uplandGradeNumber,
} from "@/lib/analysis/soilCodes";
import type {
  ActionItem,
  AnalysisFactor,
  AnalysisResult,
  AnalysisSelection,
  AnalysisSource,
  DataMode,
  ParcelData,
  RecentClimateData,
  RiskLevel,
  SoilData,
  WeatherData,
} from "@/types/domain";

type EngineInput = {
  mode: DataMode;
  warning?: string | null;
  cacheNotice?: string | null;
  selection: AnalysisSelection;
  parcel: ParcelData;
  soil: SoilData;
  weather: WeatherData;
  recentClimate?: RecentClimateData;
  analyzedAt?: string;
};

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, Math.round(value)));

function bounded(value: number | null, min: number, max: number) {
  return value !== null && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function isOutlier(value: number | null, min: number, max: number) {
  return value !== null && bounded(value, min, max) === null;
}

function rangeState(
  rawValue: number | null,
  range: [number, number],
  options: {
    maxPenalty: number;
    sensitivity: number;
    unknownPenalty: number;
    plausible: [number, number];
  },
) {
  const value = bounded(rawValue, options.plausible[0], options.plausible[1]);
  const outlier = isOutlier(rawValue, options.plausible[0], options.plausible[1]);
  if (value === null) {
    return {
      state: "unknown" as const,
      penalty: options.unknownPenalty,
      value,
      deviation: null,
      outlier,
    };
  }
  if (value >= range[0] && value <= range[1]) {
    return {
      state: "good" as const,
      penalty: 0,
      value,
      deviation: 0,
      outlier,
    };
  }
  const distance = value < range[0] ? range[0] - value : value - range[1];
  const span = Math.max(range[1] - range[0], 0.5);
  const normalizedDeviation = distance / span;
  const penalty = Math.min(
    options.maxPenalty,
    Math.max(
      3,
      Math.round(
        options.maxPenalty * Math.min(normalizedDeviation, 1) * options.sensitivity,
      ),
    ),
  );
  return {
    state: normalizedDeviation <= 0.35 ? ("watch" as const) : ("risk" as const),
    penalty,
    value,
    deviation: distance,
    outlier,
  };
}

function thresholdContribution(
  value: number | null,
  watch: number,
  maxContribution: number,
  sensitivity = 1,
) {
  if (value === null) return 0;
  const base =
    value <= watch
      ? (value / watch) * maxContribution * 0.5
      : maxContribution * 0.5 +
        ((value - watch) / (100 - watch)) * maxContribution * 0.5;
  return Math.min(maxContribution, base * sensitivity);
}

function average(values: number[]) {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weatherAdvisoryAssessment(
  profile: (typeof cropProfiles)[keyof typeof cropProfiles],
  days: WeatherData["days"],
  rainProbabilityWatch: number,
) {
  const advisory = profile.weatherAdvisory;
  if (!advisory) return null;

  const matchedDays = days.filter((day) => {
    const minTemp = bounded(day.minTemp, -50, 60);
    const maxTemp = bounded(day.maxTemp, -50, 60);
    const humidity = bounded(day.humidity, 0, 100);
    const rainProbability = bounded(day.rainProbability, 0, 100);
    const precipitation = bounded(day.precipitation, 0, 1000);
    if (minTemp === null || maxTemp === null || humidity === null) return false;

    const meanTemperature = (minTemp + maxTemp) / 2;
    const temperatureMatched =
      meanTemperature >= advisory.temperatureRange[0] &&
      meanTemperature <= advisory.temperatureRange[1];
    const humidityMatched = humidity >= advisory.minHumidity;
    const wetSignal =
      (precipitation !== null && precipitation > 0) ||
      (rainProbability !== null && rainProbability >= rainProbabilityWatch);

    return (
      temperatureMatched &&
      humidityMatched &&
      (!advisory.requireWetSignal || wetSignal)
    );
  });

  return {
    advisory,
    matchedDays: matchedDays.length,
    totalDays: days.length,
    matched: matchedDays.length > 0,
  };
}

function temperatureAssessment(
  standard: (typeof cropProfiles)[keyof typeof cropProfiles]["temperature"],
  days: WeatherData["days"],
  sensitivity: number,
  policy: EnginePolicy["temperature"],
) {
  const rawTemperatures = days.flatMap((day) => [day.minTemp, day.maxTemp]);
  const outlierCount = rawTemperatures.filter((value) =>
    isOutlier(value, -50, 60),
  ).length;
  const options = {
    maxPenalty: policy.maxPenalty,
    sensitivity,
    unknownPenalty: policy.unknownPenalty,
    plausible: [-50, 60] as [number, number],
  };

  if (standard.mode === "day-night") {
    const daytime = average(
      days.flatMap((day) => {
        const value = bounded(day.maxTemp, -50, 60);
        return value === null ? [] : [value];
      }),
    );
    const nighttime = average(
      days.flatMap((day) => {
        const value = bounded(day.minTemp, -50, 60);
        return value === null ? [] : [value];
      }),
    );
    const dayCheck = rangeState(daytime, standard.day, options);
    const nightCheck = rangeState(nighttime, standard.night, options);
    const checks = [dayCheck, nightCheck];
    const state = checks.some((check) => check.state === "unknown")
      ? ("unknown" as const)
      : checks.some((check) => check.state === "risk")
        ? ("risk" as const)
        : checks.some((check) => check.state === "watch")
          ? ("watch" as const)
          : ("good" as const);

    return {
      state,
      penalty: Math.max(...checks.map((check) => check.penalty)),
      value:
        daytime === null && nighttime === null
          ? "자료 없음"
          : `낮 ${daytime === null ? "-" : daytime.toFixed(1)}℃ · 밤 ${nighttime === null ? "-" : nighttime.toFixed(1)}℃`,
      target: `낮 ${standard.day[0]}–${standard.day[1]}℃ · 밤 ${standard.night[0]}–${standard.night[1]}℃`,
      missing: daytime === null || nighttime === null,
      outlierCount,
    };
  }

  const dailyMeans = days.flatMap((day) => {
    const minTemp = bounded(day.minTemp, -50, 60);
    const maxTemp = bounded(day.maxTemp, -50, 60);
    return minTemp === null || maxTemp === null
      ? []
      : [(minTemp + maxTemp) / 2];
  });
  const mean = average(dailyMeans);
  const check = rangeState(mean, standard.range, options);
  return {
    ...check,
    value: mean === null ? "자료 없음" : `평균 ${mean.toFixed(1)}℃`,
    target: `${standard.range[0]}–${standard.range[1]}℃`,
    missing: mean === null,
    outlierCount,
  };
}

function riskLevel(score: number, policy: EnginePolicy): RiskLevel {
  if (score >= policy.riskThresholds.high) return "high";
  if (score >= policy.riskThresholds.moderate) return "moderate";
  return "low";
}

function levelLabel(level: RiskLevel) {
  return level === "high" ? "높음" : level === "moderate" ? "주의" : "낮음";
}

function suitabilityStage(
  phState: "good" | "watch" | "risk" | "unknown",
  uplandGrade: number | null,
  hasUplandLimit: boolean,
) {
  // 단계 판정은 점수 경계가 아니라 공식 밭 적성등급과 작물별 pH 상태로 결정한다.
  if (
    phState === "risk" ||
    phState === "unknown" ||
    uplandGrade === null ||
    uplandGrade >= 4
  ) {
    return "현장 확인 필요";
  }
  if (phState === "watch" || uplandGrade === 3 || hasUplandLimit) {
    return "조건부 적합";
  }
  return "적합";
}

function createActions(
  weatherAdvisory: ReturnType<typeof weatherAdvisoryAssessment>,
  rainRisk: boolean,
  humidityRisk: boolean,
  temperatureRisk: boolean,
  soilRisk: boolean,
): ActionItem[] {
  const actions: ActionItem[] = [];
  if (weatherAdvisory?.matched) {
    actions.push({
      priority: 1,
      ...weatherAdvisory.advisory.action,
    });
  }
  if (rainRisk) {
    actions.push({
      priority: 1,
      title: "배수로와 고랑을 먼저 점검",
      detail: "강수 확률이 높은 날 전에 물 고임 구간과 배수구 막힘을 확인합니다.",
      timing: "비 예보 6시간 전",
    });
  }
  if (humidityRisk) {
    actions.push({
      priority: actions.length === 0 ? 1 : 2,
      title: "통풍 간격 확보",
      detail: "습도가 높은 시간대의 과밀 구간을 확인하고 병징을 함께 관찰합니다.",
      timing: "매일 오전",
    });
  }
  if (temperatureRisk) {
    actions.push({
      priority: actions.length === 0 ? 1 : 2,
      title: "온도 급변 시간대 대비",
      detail: "최저·최고 기온이 적정 범위를 벗어나는 시간의 관수·차광 계획을 조정합니다.",
      timing: "해당일 전날",
    });
  }
  if (soilRisk) {
    actions.push({
      priority: actions.length === 0 ? 1 : 3,
      title: "토양 실측으로 보정",
      detail: "정식 전 간이 토양검정으로 pH와 유기물 값을 확인한 뒤 투입량을 결정합니다.",
      timing: "정식 전",
    });
  }
  if (actions.length === 0) {
    actions.push({
      priority: 1,
      title: "현재 관리 계획 유지",
      detail: "큰 위험 신호는 없지만 예보 갱신 시 강수와 온도를 다시 확인합니다.",
      timing: "다음 예보 발표 후",
    });
  }
  return actions.slice(0, 3).map((action, index) => ({
    ...action,
    priority: (index + 1) as 1 | 2 | 3,
  }));
}

export function analyzeFarm(
  input: EngineInput,
  policy: EnginePolicy = baselineEnginePolicy,
): AnalysisResult {
  const profile = cropProfiles[input.selection.cropId];
  const recentClimate = input.recentClimate ?? createMockRecentClimate();
  const phSensitivity = policy.sensitivityMultipliers[profile.sensitivity.ph];
  const temperatureSensitivity =
    policy.sensitivityMultipliers[profile.sensitivity.temperature];
  const moistureSensitivity =
    policy.sensitivityMultipliers[profile.sensitivity.excessMoisture];
  const phCheck = rangeState(input.soil.ph, profile.ph, {
    maxPenalty: policy.ph.maxPenalty,
    sensitivity: phSensitivity,
    unknownPenalty: policy.ph.unknownPenalty,
    plausible: [0, 14],
  });
  const physicalProfile = input.soil.physicalProfile;
  const decodedProfile = physicalProfile ? decodedSoilProfile(physicalProfile) : null;
  const uplandGrade = uplandGradeNumber(physicalProfile);
  const hasUplandLimit = hasMaterialUplandLimit(physicalProfile);
  const uplandGradePenalty = uplandGrade === null
    ? policy.uplandGradePenalty.unknown
    : policy.uplandGradePenalty[uplandGrade as 1 | 2 | 3 | 4 | 5];
  const effectiveDrainage = physicalProfile
    ? drainageCategoryFromProfile(physicalProfile)
    : input.soil.drainage;
  const stage = suitabilityStage(phCheck.state, uplandGrade, hasUplandLimit);

  const tempCheck = temperatureAssessment(
    profile.temperature,
    input.weather.days,
    temperatureSensitivity,
    policy.temperature,
  );
  const weatherAdvisory = weatherAdvisoryAssessment(
    profile,
    input.weather.days,
    policy.rainProbabilityWatch,
  );
  const rawRain = input.weather.days.map((day) => day.rainProbability);
  const rainValues = rawRain.flatMap((value) => {
    const valid = bounded(value, 0, 100);
    return valid === null ? [] : [valid];
  });
  const rainOutlierCount = rawRain.filter((value) => isOutlier(value, 0, 100)).length;
  const maxRain = rainValues.length ? Math.max(...rainValues) : null;
  const rawHumidity = input.weather.days.map((day) => day.humidity);
  const humidityValues = rawHumidity.flatMap((value) => {
    const valid = bounded(value, 0, 100);
    return valid === null ? [] : [valid];
  });
  const humidityOutlierCount = rawHumidity.filter((value) =>
    isOutlier(value, 0, 100),
  ).length;
  const maxHumidity = humidityValues.length ? Math.max(...humidityValues) : null;
  const organicMatter = bounded(input.soil.organicMatter, 0, 300);
  const organicOutlier = isOutlier(input.soil.organicMatter, 0, 300);
  const electricalConductivity = bounded(input.soil.electricalConductivity, 0, 100);
  const electricalConductivityOutlier = isOutlier(
    input.soil.electricalConductivity,
    0,
    100,
  );
  const ecUnitResolved =
    input.soil.electricalConductivityUnit === "dS/m" &&
    ["verified", "official-cross-reference"].includes(
      input.soil.electricalConductivityUnitStatus,
    );
  const hasCropSpecificEcReference = ["apple", "lettuce"].includes(profile.id);

  const rainRisk = maxRain !== null && maxRain >= policy.rainProbabilityWatch;
  const humidityRisk = maxHumidity !== null && maxHumidity >= policy.humidityWatch;
  const temperatureRisk = tempCheck.state === "risk" || tempCheck.state === "watch";
  const soilRisk =
    stage !== "적합" ||
    effectiveDrainage === "poor" ||
    effectiveDrainage === "unknown";

  const suitabilityBase = 100;
  const rainContribution = thresholdContribution(
    maxRain,
    policy.rainProbabilityWatch,
    policy.riskContribution.rainMax,
    moistureSensitivity,
  );
  const humidityContribution = thresholdContribution(
    maxHumidity,
    policy.humidityWatch,
    policy.riskContribution.humidityMax,
  );
  const temperatureContribution = tempCheck.penalty;
  const drainageRiskContribution =
    effectiveDrainage === "poor"
      ? Math.round(policy.riskContribution.drainagePoor * moistureSensitivity)
      : effectiveDrainage === "moderate"
        ? Math.round(policy.riskContribution.drainageModerate * moistureSensitivity)
        : 0;
  const suitabilityScore = clamp(
    suitabilityBase - phCheck.penalty - uplandGradePenalty,
  );
  const riskScore = clamp(
    rainContribution +
      humidityContribution +
      temperatureContribution +
      drainageRiskContribution,
  );
  const risk = riskLevel(riskScore, policy);

  const factors: AnalysisFactor[] = [
    {
      id: "ph",
      label: "토양 pH",
      value: phCheck.outlier
        ? "이상치 제외"
        : phCheck.value === null
          ? "자료 없음"
          : phCheck.value.toFixed(1),
      target: `${profile.ph[0].toFixed(1)}–${profile.ph[1].toFixed(1)}`,
      state: phCheck.state,
      impact:
        phCheck.outlier
          ? "허용범위 밖 값 제외"
          : phCheck.state === "good"
          ? "공식 범위 안"
          : phCheck.state === "unknown"
            ? "현장 측정 필요"
            : "토양 보정 검토",
    },
    {
      id: "upland-suitability",
      label: "밭 적성등급",
      value: decodedProfile?.uplandGrade ?? "자료 없음",
      target: "1–2급지",
      state:
        uplandGrade === null
          ? "unknown"
          : uplandGrade <= 2 && !hasUplandLimit
            ? "good"
            : uplandGrade === 3 || (uplandGrade <= 2 && hasUplandLimit)
              ? "watch"
              : "risk",
      impact:
        uplandGrade === null
          ? "공식 적성등급 확인 필요"
          : uplandGrade === 5
            ? "공식상 밭 이용 부적합"
            : uplandGrade === 4
              ? `이용 가능하나 제한이 매우 큼${hasUplandLimit ? ` · ${decodedProfile?.uplandLimitingFactor}` : ""}`
              : hasUplandLimit
                ? `저해요인 확인 · ${decodedProfile?.uplandLimitingFactor}`
                : "공식 토양도 제한 낮음",
    },
    {
      id: "drainage",
      label: "배수 조건",
      value: decodedProfile?.drainage ??
        (effectiveDrainage === "good"
          ? "양호"
          : effectiveDrainage === "moderate"
            ? "보통"
            : effectiveDrainage === "poor"
              ? "불량"
              : "자료 없음"),
      target: "양호",
      state:
        effectiveDrainage === "good"
          ? "good"
          : effectiveDrainage === "moderate"
            ? "watch"
            : effectiveDrainage === "poor"
              ? "risk"
              : "unknown",
      impact:
        effectiveDrainage === "unknown"
          ? "물리성 자료 추가 필요"
          : effectiveDrainage !== "good"
            ? "강수 시 물 고임 주의"
            : "단기 위험 판단에만 반영",
    },
    {
      id: "temperature",
      label: `선택 기간 기온 · ${profile.temperature.label}`,
      value: tempCheck.value,
      target: tempCheck.target,
      state: tempCheck.state,
      impact:
        tempCheck.outlierCount > 0
          ? `예보 이상치 ${tempCheck.outlierCount}건 제외`
          : temperatureRisk
            ? "온도 대응 필요"
            : "공식 범위 안",
    },
    ...(weatherAdvisory
      ? [
          {
            id: weatherAdvisory.advisory.id,
            label: weatherAdvisory.advisory.label,
            value: weatherAdvisory.matched
              ? `예찰 필요 · ${weatherAdvisory.matchedDays}일`
              : "현재 복합 신호 없음",
            target: weatherAdvisory.advisory.conditionLabel,
            state: weatherAdvisory.matched ? ("watch" as const) : ("good" as const),
            impact: weatherAdvisory.matched
              ? "서늘함·높은 습도·비 신호가 겹침 · 생육 중일 때 현장 예찰"
              : `${weatherAdvisory.totalDays}일 예보에서 세 조건이 함께 나타나지 않음`,
          },
        ]
      : []),
    {
      id: "electrical-conductivity",
      label: "전기전도도(EC)",
      value: electricalConductivityOutlier
        ? "이상치 제외"
        : electricalConductivity === null
          ? "자료 없음"
          : ecUnitResolved
            ? `${electricalConductivity.toFixed(2)} dS/m`
            : `${electricalConductivity.toFixed(2)} · API 단위 미표기`,
      // 표시 단위는 2026-07-24에 흙토람 공식 화면과 교차해 dS/m로 확정했다.
      // 값이 없을 때는 단위 상태를 문제처럼 보여주지 않고 공식 기준만 안내한다.
      target:
        electricalConductivity === null
          ? "공식 참고 ≤ 2.0 dS/m · 점수 미반영"
          : !ecUnitResolved
            ? "응답 단위 표기 확인 필요 · 점수 미반영"
            : hasCropSpecificEcReference
              ? "공식 ≤ 2.0 dS/m · 점수 미반영"
              : "dS/m 기준 · 작물·작형별 기준 추가 검증",
      state: "info",
      impact: electricalConductivityOutlier
        ? "허용범위 밖 값 제외"
        : electricalConductivity === null
          ? "이 필지 토양검정 응답에 값이 없음"
          : ecUnitResolved
            ? "흙토람 공식 화면과 교차확인한 dS/m 표시 · 점수 미반영"
            : "응답 단위 확인 전이라 점수 미반영",
    },
    {
      id: "organic",
      label: "유기물",
      value:
        organicOutlier
          ? "이상치 제외"
          : organicMatter === null
          ? "자료 없음"
          : `${organicMatter.toFixed(1)} g/kg`,
      target: "참고값 · 점수 미반영",
      state: "info",
      impact:
        organicOutlier
          ? "허용범위 밖 값 제외"
          : organicMatter === null
          ? "토양검정 시 확인"
          : "토지이용별 기준으로 별도 해석",
    },
  ];

  const missingCount =
    Number(input.soil.ph === null) +
    Number(electricalConductivity === null || !ecUnitResolved) +
    Number(tempCheck.missing) +
    Number(uplandGrade === null) +
    Number(effectiveDrainage === "unknown") +
    Number(maxRain === null && rainOutlierCount === 0) +
    Number(maxHumidity === null && humidityOutlierCount === 0) +
    Number(recentClimate.status !== "connected" || recentClimate.itemCount === 0);
  const outlierCount =
    Number(phCheck.outlier) +
    tempCheck.outlierCount +
    rainOutlierCount +
    humidityOutlierCount +
    Number(electricalConductivityOutlier) +
    Number(organicOutlier);
  const evidenceGapCount = missingCount;
  const sourceStatuses = [
    input.parcel.status,
    input.soil.status,
    input.weather.status,
    recentClimate.status,
  ];
  const connectedCount = sourceStatuses.filter((status) => status === "connected").length;
  const cachedCount = sourceStatuses.filter((status) => status === "cache").length;
  const confidenceBase = input.mode === "mock" ? 66 : 52 + connectedCount * 12;
  const evidenceGapPenalty = evidenceGapCount * 8;
  const outlierPenalty = outlierCount * 6;
  const parcelMatchPenalty = input.parcel.selectionStatus === "needs_confirmation" ? 10 : 0;
  const confidence = clamp(
    confidenceBase - evidenceGapPenalty - outlierPenalty - parcelMatchPenalty,
  );
  const qualityLevel: AnalysisResult["evidenceQuality"]["level"] =
    confidence >= 75 ? "strong" : confidence >= 50 ? "partial" : "weak";
  const evidenceQuality: AnalysisResult["evidenceQuality"] = {
    level: qualityLevel,
    label:
      qualityLevel === "strong"
        ? "근거 충분"
        : qualityLevel === "partial"
          ? "일부 확인 필요"
          : "근거 부족",
    marks: Math.max(1, Math.min(5, Math.ceil(confidence / 20))) as 1 | 2 | 3 | 4 | 5,
    score: confidence,
    connectedSources: connectedCount,
    totalSources: 4,
    missingCount,
    outlierCount,
    note: `실시간 연결 ${connectedCount}/4${
      cachedCount > 0 ? ` · 검증 스냅샷 ${cachedCount}건` : ""
    } · 자료 없음 ${missingCount}건 · 허용범위 밖 제외 ${outlierCount}건`,
  };
  const modeLabel =
    input.mode === "live"
      ? "공공데이터 연결"
      : input.mode === "fallback"
        ? cachedCount > 0
          ? connectedCount > 0
            ? "실데이터 + 검증 스냅샷"
            : "검증 스냅샷"
          : connectedCount > 0
            ? "실데이터 + 일부 대체"
            : "대체 데이터"
        : "시연용 검증 자료";

  const summary = `${profile.name} 재배 판단은 ${stage}, 가까운 ${input.selection.horizonDays}일 위험은 ${levelLabel(risk)}입니다.`;
  const analyzedAt = input.analyzedAt ?? new Date().toISOString();
  const soilHasChemical = hasChemicalSoil(input.soil);

  return {
    mode: input.mode,
    modeLabel,
    // 시연 모드는 화면 상단 배지(`시연용 검증 자료`)로 이미 드러나므로 같은 내용을 문장으로 반복하지 않는다.
    warning: input.warning ?? null,
    selection: input.selection,
    cropName: profile.name,
    parcel: input.parcel,
    soil: input.soil,
    weather: input.weather,
    recentClimate,
    suitabilityScore,
    suitabilityLabel: stage,
    riskScore,
    riskLevel: risk,
    riskLabel: levelLabel(risk),
    confidence,
    evidenceQuality,
    modelCard: {
      version: policy.version,
      label: "공식 등급·pH 우선 판정",
      calibrationStatus: "prototype",
      note: "판정 단계는 공식 밭 적성등급과 작물별 pH 기준으로 정합니다. 아래 점수는 공식 범위 이탈 거리·작물 민감도·결측을 반영하도록 팀이 설계한 가중치 산식으로 계산합니다. 현장 수확 자료로 보정한 계수는 아닙니다.",
    },
    requirementCoverage: [
      {
        id: "soil",
        label: "실제 토양",
        status:
          input.soil.status === "connected" &&
          input.soil.ph !== null &&
          uplandGrade !== null &&
          electricalConductivity !== null &&
          ecUnitResolved
            ? "ready"
            : "partial",
        detail:
          uplandGrade === null
            ? "pH는 사용하고 공식 밭 적성등급은 확인되지 않았습니다."
            : ecUnitResolved
              ? `pH와 공식 밭 ${decodedProfile?.uplandGrade}를 판정에 사용합니다. EC는 dS/m로 해석하되 작물 기준 확정 전 점수에서 제외합니다.`
              : `pH와 공식 밭 ${decodedProfile?.uplandGrade}를 판정에 사용합니다. EC는 단위 확인 전 참고값입니다.`,
      },
      {
        id: "recent-climate",
        label: "최근 기후 추이",
        status: recentClimate.status === "connected" ? "ready" : "partial",
        detail: recentClimate.status === "connected"
          ? `${recentClimate.station.name}(${recentClimate.station.distanceKm}km)의 최근 ${recentClimate.itemCount}일 관측을 근거로 표시합니다.`
          : "관측소 매핑은 동작하지만 현재 결과는 대체 데이터입니다.",
      },
      {
        id: "forecast",
        label: "단기예보",
        status: input.weather.status === "connected" ? "ready" : "partial",
        detail: `${input.selection.horizonDays}일 기온·강수·습도를 위험 신호에 반영합니다.`,
      },
      {
        id: "explanation",
        label: "초보자 설명",
        status: "partial",
        detail:
          "근거 묶음·금지 표현·출력 검증·규칙 기반 대체까지 구현했습니다. 설명 생성 제공자만 연결하면 같은 계약으로 동작하고, 실패하면 규칙 문장으로 돌아옵니다.",
      },
    ],
    summary,
    factors,
    actions: createActions(
      weatherAdvisory,
      rainRisk,
      humidityRisk,
      temperatureRisk,
      soilRisk,
    ),
    sources: [
      {
        id: "parcel",
        name: input.parcel.source,
        provider: providerFromSource(input.parcel.source, "농림축산식품부"),
        usedFields: parcelUsedFields(input.parcel),
        status: input.parcel.status,
        observedAt: input.parcel.observedAt,
        observedAtLabel: "자료 기준시각",
        ...ageNoteFor("parcel", input.parcel.observedAt, analyzedAt, soilHasChemical),
      },
      {
        id: "soil",
        name: input.soil.source,
        provider: providerFromSource(input.soil.source, "농촌진흥청"),
        usedFields: soilUsedFields(input.soil, input.parcel.selectionStatus === "matched"),
        status: input.soil.status,
        observedAt: input.soil.observedAt,
        observedAtLabel: soilHasChemical ? "검정 시점" : "",
        ...ageNoteFor("soil", input.soil.observedAt, analyzedAt, soilHasChemical),
      },
      {
        id: "forecast",
        name: input.weather.source,
        provider: providerFromSource(input.weather.source, "기상청"),
        usedFields: [
          `향후 ${input.selection.horizonDays}일 최저·최고기온`,
          "강수확률·강수형태",
          "습도",
          "하늘 상태",
        ],
        status: input.weather.status,
        observedAt: input.weather.issuedAt,
        observedAtLabel: "발표 시각",
        ...ageNoteFor("forecast", input.weather.issuedAt, analyzedAt, soilHasChemical),
      },
      {
        id: "climate",
        name: recentClimate.source,
        provider: providerFromSource(recentClimate.source, "농촌진흥청"),
        usedFields: [
          "최근 7일 누적 강수·강수일수",
          "최저·최고기온",
          "평균 습도",
          `최근접 관측소 ${recentClimate.station.name} ${recentClimate.station.distanceKm.toFixed(1)}km`,
        ],
        status: recentClimate.status,
        observedAt: recentClimate.observedAt,
        observedAtLabel: "관측 기간",
        ...ageNoteFor("climate", recentClimate.observedAt, analyzedAt, soilHasChemical),
      },
    ],
    scoreExplanations: {
      suitability: {
        label: "토양 조건 점수(보조)",
        formula: `${suitabilityBase} - pH ${phCheck.penalty} - 밭 등급 ${uplandGradePenalty} = ${suitabilityScore}`,
        terms: [
          {
            id: "suitability-base",
            label: "기준점(자체 산식)",
            value: suitabilityBase,
            display: `+${suitabilityBase}`,
            effect: "base",
            basis: "operational",
          },
          {
            id: "ph-penalty",
            label: `pH 이탈 × ${phSensitivity.toFixed(2)}`,
            value: phCheck.penalty,
            display: `-${phCheck.penalty}`,
            effect: "deduct",
            basis: phCheck.outlier
              ? "outlier"
              : input.soil.ph === null
                ? "missing"
                : "mixed",
          },
          {
            id: "upland-grade-penalty",
            label: `밭 적성 ${decodedProfile?.uplandGrade ?? "자료 없음"}`,
            value: uplandGradePenalty,
            display: `-${uplandGradePenalty}`,
            effect: "deduct",
            basis: uplandGrade === null ? "missing" : "mixed",
          },
        ],
        caveat: `판정 단계는 공식 밭 적성등급 정의와 작물별 pH 상태를 우선합니다. 등급·pH 감점 폭은 공식 범위 이탈 거리와 작물 민감도를 반영하도록 팀이 설계한 가중치이며, 배수는 밭 등급과 중복 감점하지 않습니다. 수확량이나 성공 확률을 예측하지 않습니다.`,
      },
      risk: {
        label: `가까운 ${input.selection.horizonDays}일 위험 점수(보조)`,
        formula: `강수 ${rainContribution.toFixed(1)} + 습도 ${humidityContribution.toFixed(1)} + 기온 ${temperatureContribution.toFixed(1)} + 배수 ${drainageRiskContribution} = ${riskScore}`,
        terms: [
          {
            id: "rain-contribution",
            label: `최대 강수확률 ${maxRain === null ? "자료 없음" : `${maxRain}%`} × ${moistureSensitivity.toFixed(2)}`,
            value: rainContribution,
            display: `+${rainContribution.toFixed(1)}`,
            effect: "add",
            basis:
              rainOutlierCount > 0 && maxRain === null
                ? "outlier"
                : maxRain === null
                  ? "missing"
                  : "mixed",
          },
          {
            id: "humidity-contribution",
            label: `최대 습도 ${maxHumidity === null ? "자료 없음" : `${maxHumidity}%`}`,
            value: humidityContribution,
            display: `+${humidityContribution.toFixed(1)}`,
            effect: "add",
            basis:
              humidityOutlierCount > 0 && maxHumidity === null
                ? "outlier"
                : maxHumidity === null
                  ? "missing"
                  : "operational",
          },
          {
            id: "temperature-contribution",
            label: `기온 이탈 × ${temperatureSensitivity.toFixed(2)}`,
            value: temperatureContribution,
            display: `+${temperatureContribution.toFixed(1)}`,
            effect: "add",
            basis:
              tempCheck.outlierCount > 0 && tempCheck.missing
                ? "outlier"
                : tempCheck.missing
                  ? "missing"
                  : "mixed",
          },
          {
            id: "drainage-risk",
            label: "배수 불량 추가 위험",
            value: drainageRiskContribution,
            display: `+${drainageRiskContribution}`,
            effect: "add",
            basis: effectiveDrainage === "unknown" ? "missing" : "mixed",
          },
        ],
        caveat: `강수확률 ${policy.rainProbabilityWatch}%·습도 ${policy.humidityWatch}%를 중심으로 기여도가 연속 증가합니다. 작물 민감도 단계와 기여도는 자체 설계 가중치이며 병해 발생 확률이나 재해 확률이 아닙니다.${weatherAdvisory ? ` ${weatherAdvisory.advisory.label}는 ${weatherAdvisory.advisory.reference}의 복합 조건을 별도 표시하며 점수에 중복 가산하지 않습니다.` : ""}`,
      },
      confidence: {
        label: "데이터 근거 상태",
        formula: `${confidenceBase} - 결측 ${evidenceGapPenalty} - 이상치 ${outlierPenalty} - 농지 미확정 ${parcelMatchPenalty} = ${confidence}`,
        terms: [
          {
            id: "evidence-base",
            label: input.mode === "mock" ? "시연 자료 기준점" : `연결된 자료 ${connectedCount}/4 반영`,
            value: confidenceBase,
            display: `+${confidenceBase}`,
            effect: "base",
            basis: "operational",
          },
          {
            id: "evidence-gap",
            label: `핵심 근거 결측 ${evidenceGapCount}건`,
            value: evidenceGapPenalty,
            display: `-${evidenceGapPenalty}`,
            effect: "deduct",
            basis: evidenceGapCount > 0 ? "missing" : "operational",
          },
          {
            id: "outlier-guard",
            label: `허용범위 밖 값 ${outlierCount}건 제외`,
            value: outlierPenalty,
            display: `-${outlierPenalty}`,
            effect: "deduct",
            basis: outlierCount > 0 ? "outlier" : "operational",
          },
          {
            id: "parcel-match-gap",
            label: "농지 확인 상태",
            value: parcelMatchPenalty,
            display: `-${parcelMatchPenalty}`,
            effect: "deduct",
            basis: parcelMatchPenalty > 0 ? "missing" : "operational",
          },
        ],
        caveat: "필요한 자료가 얼마나 채워졌는지, 고른 농지와 같은 땅의 자료인지, 허용범위를 벗어난 값이 제외됐는지를 보여주는 표시입니다. 판단이 맞을 확률이 아닙니다.",
      },
    },
    cacheNotice: input.cacheNotice ?? null,
    report: null,
    // 설명 계층은 규칙 판정이 확정된 뒤 `withReport`에서 채운다.
    showcaseReport: null,
    showcaseNote: null,
    // 설명 계층은 엔진 밖에서 붙인다. 판정은 규칙만으로 끝난다.
    showcaseTrace: null,
    analyzedAt,
    basisNote:
      `주결론은 공식 밭 적성등급과 작물별 pH 상태로 정하고, 숫자는 계산 근거를 비교하기 위한 보조 점수로만 사용합니다. 밭 적성등급은 여러 물리 조건을 종합하므로 배수 상태를 적합 지수에 다시 감점하지 않습니다. EC는 흙토람 공식 화면과 교차해 dS/m로 해석하되 작물별 기준이 확인되기 전까지, 유기물은 토지이용별 기준이 확인되기 전까지 점수에서 제외합니다. 민감도는 ${policy.sensitivityMultipliers.standard.toFixed(2)}·${policy.sensitivityMultipliers.sensitive.toFixed(2)}·${policy.sensitivityMultipliers["very-sensitive"].toFixed(2)}의 자체 설계 계수입니다. 기온 기준은 ${profile.references.temperature}에 따르며, 강수확률 ${policy.rainProbabilityWatch}%·습도 ${policy.humidityWatch}%는 자체 설계 임계값입니다.${weatherAdvisory ? ` ${weatherAdvisory.advisory.label}는 ${weatherAdvisory.advisory.reference}를 근거로 예찰 필요 여부만 표시하고 발병 확률로 해석하지 않습니다.` : ""}`,
  };
}

// 출처 표의 제공기관은 손으로 적지 않는다.
// 토양은 필지 확정 여부에 따라 농촌진흥청·농림축산식품부 중 다른 API를 타므로
// 응답의 출처 문자열에서 읽어야 실제와 어긋나지 않는다.
// 시연·스냅샷 출처명에는 기관명이 없으므로, 그 자료가 재현하는 기관을 기본값으로 받는다.
const dataProviders = ["농림축산식품부", "농촌진흥청", "기상청"];

function providerFromSource(source: string, fallback: string) {
  return dataProviders.find((provider) => source.includes(provider)) ?? fallback;
}

/**
 * 기준시각 나이 판단.
 *
 * 자료마다 `오래됐다`의 의미가 다르다. 흙의 물리 성질과 필지 형상은 잘 변하지 않아
 * 기준시각이 몇 년 지나도 그대로 쓸 수 있지만, 산도·유기물은 거름과 석회로 바뀐다.
 * 그래서 경과 기간만 보여주지 않고 그 나이가 이 자료에서 문제인지까지 적는다.
 * 재검정 권장 시점은 공식 주기가 아니라 이 서비스의 운영 기준이다.
 */
const CHEMICAL_AGING_MONTHS = 36;

function monthsSince(observedAt: string, analyzedAt: string): number | null {
  const found = observedAt.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!found) return null;
  const observed = Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3]));
  const now = Date.parse(analyzedAt);
  if (!Number.isFinite(now) || now < observed) return null;
  return Math.floor((now - observed) / (1000 * 60 * 60 * 24 * 30.44));
}

/** `1년 2개월`처럼 기간만 돌려준다. `전`·`지났습니다`는 쓰는 쪽에서 붙인다. */
function elapsedText(months: number) {
  if (months < 1) return "1개월 이내";
  if (months < 12) return `${months}개월`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years}년` : `${years}년 ${rest}개월`;
}

function ageNoteFor(
  id: AnalysisSource["id"],
  observedAt: string,
  analyzedAt: string,
  hasChemical: boolean,
): { ageNote: string; ageState: AnalysisSource["ageState"] } {
  const months = monthsSince(observedAt, analyzedAt);
  const elapsed = months === null ? null : elapsedText(months);

  if (id === "forecast") {
    return { ageNote: "오늘 발표된 예보입니다.", ageState: "fresh" };
  }
  if (id === "climate") {
    return { ageNote: "최근 7일 관측이라 지금 상태를 그대로 반영합니다.", ageState: "fresh" };
  }
  if (id === "parcel") {
    return {
      ageNote: elapsed
        ? `판독 영상 기준으로 ${elapsed} 지났습니다. 필지 형상과 지목은 잘 바뀌지 않아 그대로 씁니다. 다만 최근 형질변경은 반영되지 않을 수 있습니다.`
        : "필지 형상과 지목은 잘 바뀌지 않아 기준시각이 오래돼도 그대로 씁니다.",
      ageState: "stable",
    };
  }

  // 토양 행: 화학성이 있으면 나이를 따지고, 물리 성질은 나이와 무관함을 함께 적는다.
  if (!hasChemical) {
    return {
      ageNote: "토양도의 물리 성질은 잘 변하지 않아 기준시각이 오래돼도 그대로 씁니다. 산도는 조회되지 않았습니다.",
      ageState: "stable",
    };
  }
  if (months !== null && months >= CHEMICAL_AGING_MONTHS) {
    return {
      ageNote: `검정 후 ${elapsed} 지났습니다. 산도·유기물은 거름과 석회로 바뀌므로 심기 전 간이 검정으로 다시 확인하는 편이 안전합니다. 토성·유효토심은 이 기간에 거의 변하지 않습니다.`,
      ageState: "aging",
    };
  }
  return {
    ageNote: elapsed
      ? `검정 후 ${elapsed} 지났습니다. 산도·유기물은 아직 참고할 수 있는 값으로 봤습니다. 토성·유효토심은 나이와 무관합니다.`
      : "검정 시점을 읽지 못했습니다. 산도·유기물은 심기 전 간이 검정으로 다시 확인하는 편이 안전합니다.",
    ageState: "stable",
  };
}

function parcelUsedFields(parcel: EngineInput["parcel"]): string[] {
  if (parcel.selectionStatus !== "matched") {
    return [
      "필지 미확정 — 좌표 기준으로 조회했습니다",
      parcel.address,
      parcel.interpretation,
    ];
  }
  return [
    `반경 후보 ${parcel.candidateCount}건에서 필지 확정`,
    `PNU ${parcel.parcelId}`,
    parcel.address,
    `논밭 판독 ${parcel.interpretation}`,
  ];
}

/** 토양검정(화학성)은 필지별로 있을 수도 없을 수도 있다. 없으면 물리 항목만 온다. */
function hasChemicalSoil(soil: EngineInput["soil"]) {
  return (
    soil.ph !== null ||
    soil.organicMatter !== null ||
    soil.electricalConductivity !== null
  );
}

function soilUsedFields(soil: EngineInput["soil"], parcelMatched: boolean): string[] {
  const chemical = hasChemicalSoil(soil)
    ? [
        `pH ${soil.ph ?? "미확인"}`,
        `유기물 ${soil.organicMatter ?? "미확인"} · EC ${
          soil.electricalConductivity ?? "미확인"
        }${soil.electricalConductivity === null ? "" : ` ${soil.electricalConductivityUnit ?? ""}`}`.trim() +
          " — 표시용, 점수 미반영",
        `시료 ${soil.sampleType}`,
      ]
    : ["토양검정 화학성 자료 없음 — pH·유기물·EC 미조회"];

  // 토양특성 V3를 타지 못한 경로는 물리 항목이 아예 없다. 있는 척 적지 않는다.
  // 필지를 확정했는데도 없는 경우와 아직 확정하지 않은 경우는 원인이 다르므로 나눠 적는다.
  if (!soil.physicalProfile) {
    return [
      ...chemical,
      "토양특성 V3 물리 항목 없음 — 밭 적성등급·저해요인·배수·유효토심·표토 토성 미조회",
      parcelMatched
        ? "확정한 필지가 토양특성 V3 제공 범위에 없어 좌표 기준 자료로 대체했습니다"
        : "필지를 확정하면 물리 항목까지 조회됩니다",
    ];
  }

  const decoded = decodedSoilProfile(soil.physicalProfile);
  return [
    `밭 적성등급 ${decoded.uplandGrade}`,
    `저해요인 ${decoded.uplandLimitingFactor}`,
    `배수 ${decoded.drainage}`,
    `유효토심 ${decoded.effectiveDepth}`,
    `표토 토성 ${decoded.topsoilTexture}`,
    ...chemical,
  ];
}

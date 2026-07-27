import type { AnalysisResult } from "@/types/domain";

/**
 * 근거 묶음(Evidence Bundle).
 * 규칙 엔진이 이미 확정한 값만 담는다. 설명 단계는 이 묶음 밖의 사실을 새로 만들 수 없다.
 */
export type ReportBundle = {
  crop: string;
  parcel: { address: string; interpretation: string; confirmation: string };
  stage: string;
  riskLabel: string;
  horizonDays: number;
  keyFactors: {
    label: string;
    value: string;
    target: string;
    state: string;
    impact: string;
  }[];
  actions: { title: string; detail: string; timing: string }[];
  dataStatus: { label: string; note: string; modeLabel: string };
  limits: string[];
  /** 설명 문장에 쓸 수 있는 숫자·문구 화이트리스트 */
  allowedNumbers: string[];
};

const stateLabel = (state: string) =>
  state === "good"
    ? "기준 안"
    : state === "watch"
      ? "주의"
      : state === "risk"
        ? "기준 밖"
        : state === "info"
          ? "참고"
          : "확인 필요";

function collectNumbers(values: string[]) {
  const found = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(/\d+(?:\.\d+)?/g)) {
      found.add(match[0]);
    }
  }
  return [...found];
}

export function buildReportBundle(result: AnalysisResult): ReportBundle {
  const keyFactors = result.factors
    .filter((factor) => factor.state !== "info")
    .slice(0, 4)
    .map((factor) => ({
      label: factor.label,
      value: factor.value,
      target: factor.target,
      state: stateLabel(factor.state),
      impact: factor.impact,
    }));

  // 말투는 화면 전체와 같은 `-습니다`체로 맞추고, 단정 대신 보수적으로 쓴다.
  const limits: string[] = [
    "이 결과는 공식 기준과 조회된 자료를 대조한 참고 판단입니다. 숫자는 비교를 돕는 값이며 성공 가능성이나 수확량을 예측하지 않습니다.",
    "최근 날씨는 가장 가까운 관측소 기록이라 농지의 실제 환경과는 차이가 있을 수 있습니다.",
  ];
  if (result.soil.sampledAt) {
    limits.push(
      `토양 값은 ${result.soil.sampledAt} 검정 기록입니다. 그 뒤에 흙에 손을 댔다면 지금 값과 다를 수 있습니다.`,
    );
  }
  if (result.cacheNotice) {
    limits.push("일부 자료는 실시간 조회가 아니라 저장해 둔 검증 자료를 사용했습니다.");
  }
  limits.push("심기 전에 현장 상태를 직접 보고 지역 농업기술센터의 확인을 함께 받는 편이 안전합니다.");

  return {
    crop: result.cropName,
    parcel: {
      address: result.parcel.address,
      interpretation: result.parcel.interpretation,
      confirmation:
        result.parcel.selectionStatus === "matched"
          ? "사용자가 확인한 농지"
          : result.parcel.selectionStatus === "needs_confirmation"
            ? "농지 확인 필요"
            : "시연용 농지",
    },
    stage: result.suitabilityLabel,
    riskLabel: result.riskLabel,
    horizonDays: result.selection.horizonDays,
    keyFactors,
    actions: result.actions.map((action) => ({
      title: action.title,
      detail: action.detail,
      timing: action.timing,
    })),
    dataStatus: {
      label: result.evidenceQuality.label,
      note: result.evidenceQuality.note,
      modeLabel: result.modeLabel,
    },
    limits,
    // 설명이 쓸 수 있는 숫자 목록. 화면에 이미 나온 값만 담고, 여기 없는 숫자가 문장에 있으면 검증에서 막는다.
    // 예보 날짜·강수·습도처럼 정상적인 설명에 필요한 값이 빠지면 정상 문장까지 반려되므로 함께 넣는다.
    allowedNumbers: collectNumbers([
      // 지번·필지번호·검정 시점도 근거 묶음에 있는 값이다. 빠뜨리면 주소를 쓴 정상 문장이 반려된다.
      `${result.parcel.address} ${result.parcel.interpretation} ${result.parcel.parcelId}`,
      `${result.soil.sampledAt} ${result.soil.year}`,
      ...result.factors.map((factor) => `${factor.value} ${factor.target}`),
      ...result.actions.map((action) => `${action.detail} ${action.timing}`),
      ...result.weather.days.map(
        (day) =>
          `${day.label} ${day.date} ${day.minTemp ?? ""} ${day.maxTemp ?? ""} ` +
          `${day.rainProbability ?? ""} ${day.humidity ?? ""} ${day.precipitation ?? ""}`,
      ),
      `${result.recentClimate.totalRainMm ?? ""} ${result.recentClimate.wetDays ?? ""} ` +
        `${result.recentClimate.minTempC ?? ""} ${result.recentClimate.maxTempC ?? ""} ` +
        `${result.recentClimate.averageHumidityPct ?? ""} ${result.recentClimate.station.distanceKm}`,
      `${result.recentClimate.period.begin} ${result.recentClimate.period.end}`,
      result.evidenceQuality.note,
      `${result.evidenceQuality.connectedSources} ${result.evidenceQuality.totalSources}`,
      String(result.selection.horizonDays),
      String(result.suitabilityScore),
      String(result.riskScore),
      String(result.confidence),
    ]),
  };
}

export type CropId = "apple" | "pear" | "cucumber" | "potato" | "lettuce";

export type DataMode = "mock" | "live" | "fallback";

export type SourceStatus = "connected" | "cache" | "mock" | "fallback";

export type AnalysisSelection = {
  lat: number;
  lng: number;
  cropId: CropId;
  horizonDays: 1 | 3;
  parcelId?: string;
  farmMapId?: string;
  parcelAddress?: string;
  parcelInterpretation?: string;
};

export type ParcelData = {
  address: string;
  parcelId: string;
  farmMapId: string | null;
  interpretation: string;
  candidateCount: number;
  selectionStatus: "matched" | "needs_confirmation" | "mock";
  status: SourceStatus;
  source: string;
  observedAt: string;
};

export type ParcelCandidate = {
  address: string;
  parcelId: string;
  farmMapId: string;
  interpretation: string;
  observedAt: string;
};

export type ParcelSearch = {
  candidates: ParcelCandidate[];
  candidateCount: number;
  radiusM: 250 | 500 | 1000;
  requiresRefinement: boolean;
  /** 후보 목록의 출처. connected=실시간 조회, cache=검증 스냅샷, mock=시연 자료 */
  status: SourceStatus;
  source: string;
  /**
   * 실시간 조회가 실패해 다른 출처로 대체한 경우 그 실패 이유.
   * 화면에 그대로 보여준다. 대체를 실시간처럼 보이게 하지 않기 위한 값이다.
   */
  liveFailure?: string | null;
};

export type SoilPhysicalProfile = {
  drainageCode: string | null;
  effectiveDepthCode: string | null;
  erosionCode: string | null;
  topsoilTextureCode: string | null;
  mainLandUseCode: string | null;
  useRecommendationCode: string | null;
  uplandGradeCode: string | null;
  uplandLimitingFactorCode: string | null;
  orchardGradeCode: string | null;
  orchardLimitingFactorCode: string | null;
};

export type SoilData = {
  ph: number | null;
  organicMatter: number | null;
  electricalConductivity: number | null;
  electricalConductivityUnit: "dS/m" | null;
  electricalConductivityUnitStatus:
    | "verified"
    | "official-cross-reference"
    | "api-unspecified"
    | "mock";
  drainage: "good" | "moderate" | "poor" | "unknown";
  year: string;
  sampledAt: string;
  sampleType: string;
  parcelId: string | null;
  farmMapId: string | null;
  boundaryAvailable: boolean;
  physicalProfile: SoilPhysicalProfile | null;
  status: SourceStatus;
  source: string;
  observedAt: string;
};

export type WeatherDay = {
  date: string;
  label: string;
  minTemp: number | null;
  maxTemp: number | null;
  rainProbability: number | null;
  precipitation: number | null;
  precipitationType: string;
  /** 위험 산식이 쓰는 값. 하루 중 최고 습도다. */
  humidity: number | null;
  /** 화면 표시용 하루 평균 습도. 산식에는 쓰지 않는다. */
  humidityAverage?: number | null;
  maxWindSpeed: number | null;
  sky: string;
};

export type WeatherData = {
  issuedAt: string;
  status: SourceStatus;
  source: string;
  days: WeatherDay[];
};

export type WeatherStation = {
  code: string;
  name: string;
  distanceKm: number;
  elevationM: number | null;
  address: string;
  observedSince: string;
};

export type RecentClimateData = {
  station: WeatherStation;
  period: { begin: string; end: string };
  itemCount: number;
  totalRainMm: number | null;
  wetDays: number | null;
  minTempC: number | null;
  maxTempC: number | null;
  averageHumidityPct: number | null;
  representativeness: "nearby" | "regional" | "weak";
  status: SourceStatus;
  source: string;
  observedAt: string;
};

export type FactorState = "good" | "watch" | "risk" | "unknown" | "info";

export type AnalysisFactor = {
  id: string;
  label: string;
  value: string;
  target: string;
  state: FactorState;
  impact: string;
};

export type RiskLevel = "low" | "moderate" | "high";

export type ActionItem = {
  priority: 1 | 2 | 3;
  title: string;
  detail: string;
  timing: string;
};

export type AnalysisSource = {
  id: "parcel" | "soil" | "forecast" | "climate";
  name: string;
  provider: string;
  usedFields: string[];
  status: SourceStatus;
  observedAt: string;
  observedAtLabel: string;
  /** 기준시각이 얼마나 지났는지와, 그 나이가 이 자료에서 문제인지 아닌지 */
  ageNote: string;
  ageState: "fresh" | "stable" | "aging";
};

export type ScoreTerm = {
  id: string;
  label: string;
  value: number;
  display: string;
  effect: "base" | "add" | "deduct";
  basis: "official" | "operational" | "mixed" | "missing" | "outlier";
};

export type ScoreExplanation = {
  label: string;
  formula: string;
  terms: ScoreTerm[];
  caveat: string;
};

export type EvidenceQuality = {
  level: "strong" | "partial" | "weak";
  label: string;
  marks: 1 | 2 | 3 | 4 | 5;
  score: number;
  connectedSources: number;
  totalSources: number;
  missingCount: number;
  outlierCount: number;
  note: string;
};

export type RequirementCoverage = {
  id: "soil" | "recent-climate" | "forecast" | "explanation";
  label: string;
  status: "ready" | "partial" | "blocked";
  detail: string;
};

export type AnalysisModelCard = {
  version: string;
  label: string;
  calibrationStatus: "prototype" | "validated";
  note: string;
};

export type ReportSection = { heading: string; body: string };

export type ReportPipelineStep = {
  id: "bundle" | "prompt" | "generate" | "validate" | "deliver";
  label: string;
  detail: string;
  state: "done" | "skipped";
};

export type ReportValidation = {
  ok: boolean;
  failures: string[];
  checked: string[];
};

export type ReportActionNote = { title: string; note: string };

export type FarmReport = {
  origin: "rule" | "llm";
  originLabel: string;
  sections: ReportSection[];
  actionNotes: ReportActionNote[];
  text: string;
  pipeline: ReportPipelineStep[];
  validation: ReportValidation | null;
  providerNote: string | null;
};

/**
 * 초보자용 자연어 리포트의 예시 문안.
 * 실제 LLM 출력이 아니다. 제공자를 연결하면 이 자리에 생성 문장이 들어간다는 것을
 * 심사·시연에서 보여주기 위한 사전 작성 문안이며, 화면에 예시임을 표시한다.
 * 수치는 규칙 엔진이 확정한 값만 끌어 쓰고 새로 만들지 않는다.
 */
export type ShowcaseHighlight = {
  text: string;
  /** value=실측 수치(골드) · official=공식 기준(딥그린) · caution=주의·한계(클레이 레드) */
  kind: "value" | "official" | "caution";
};

export type ShowcaseReport = {
  caseLabel: string;
  curated: boolean;
  /** 화면 배지 문구. AI가 쓴 경우와 사람이 써 둔 문안을 구분해 표시한다. */
  originLabel?: string;
  headline: string;
  blocks: { id: string; heading: string; body: string }[];
  checklist: { title: string; timing: string; body: string }[];
  closing: string;
  usedValues: string[];
  /** 본문에서 강조할 표현. 화면이 이 목록으로만 색을 입힌다. */
  highlights: ShowcaseHighlight[];
};

export type AnalysisResult = {
  mode: DataMode;
  modeLabel: string;
  warning: string | null;
  selection: AnalysisSelection;
  cropName: string;
  parcel: ParcelData;
  soil: SoilData;
  weather: WeatherData;
  recentClimate: RecentClimateData;
  suitabilityScore: number;
  suitabilityLabel: string;
  riskScore: number;
  riskLevel: RiskLevel;
  riskLabel: string;
  confidence: number;
  evidenceQuality: EvidenceQuality;
  modelCard: AnalysisModelCard;
  requirementCoverage: RequirementCoverage[];
  summary: string;
  factors: AnalysisFactor[];
  actions: ActionItem[];
  sources: AnalysisSource[];
  scoreExplanations: {
    suitability: ScoreExplanation;
    risk: ScoreExplanation;
    confidence: ScoreExplanation;
  };
  analyzedAt: string;
  basisNote: string;
  cacheNotice: string | null;
  report: FarmReport | null;
  showcaseReport: ShowcaseReport | null;
  /** 예시 문안을 만들지 못한 이유. 화면에서 조건을 설명하는 데 쓴다. */
  showcaseNote: string | null;
  /**
   * 04 리포트가 AI 문장 대신 규칙 문장을 쓰게 된 경과.
   * 02 판정서는 생성 5단계를 화면에 보여주는데 04에는 그게 없어서, 왜 `AI 생성 아님`이
   * 되었는지 사용자가 알 수 없었다. 실패를 숨기지 않는 것이 이 서비스의 원칙이다.
   */
  showcaseTrace: ShowcaseTrace | null;
};

export type ShowcaseTrace = {
  /** AI를 실제로 불렀는지 */
  attempted: boolean;
  /** 불렀다면 검사를 통과했는지 */
  passed: boolean;
  /**
   * 어디서 멈췄는지.
   * `call`은 호출 자체가 실패해 문장이 만들어지지 않은 경우다. 한도 초과가 여기 해당한다.
   * `validation`은 문장은 받았지만 검사에서 걸린 경우다. 둘을 뭉치면 화면이 사실과 달라진다.
   */
  failedAt: "call" | "validation" | null;
  /** 검사에 걸린 항목 또는 호출 실패 사유 */
  failures: string[];
  /** 어느 경로로 문장을 만들었는지 (`replay-live`, `저장본 판정 불일치` 등) */
  source: string;
};

export type VerifiedSnapshotProvenance = {
  id: string;
  label: string;
  collectedAt: string;
  collectedBy: "documented-audit" | "capture-route";
  reproduce: string;
  verificationDocs: string[];
};

export type AnalyzeResponse =
  | { ok: true; result: AnalysisResult }
  | { ok: false; error: string };

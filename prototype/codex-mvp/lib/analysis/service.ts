import { analyzeFarm } from "@/lib/analysis/engine";
import { reconcileParcel } from "@/lib/analysis/evidence";
import {
  snapshotNotice,
  verifiedParcel,
  verifiedRecentClimate,
  verifiedSoil,
  verifiedWeather,
} from "@/lib/cache/verifiedSnapshot";
import {
  createMockParcel,
  createMockRecentClimate,
  createMockSoil,
  createMockWeather,
} from "@/lib/mock/data";
import { createFarmReport } from "@/lib/report";
import { buildShowcaseOutcome } from "@/lib/report/showcaseRunner";
import {
  fetchFarmMapCandidates,
  fetchRecentClimate,
  fetchSoil,
  fetchSoilByParcel,
  fetchWeather,
  hasPublicDataKey,
} from "@/lib/public-data/client";
import type {
  AnalysisResult,
  AnalysisSelection,
  DataMode,
} from "@/types/domain";

/**
 * 실시간 우선 → 검증 스냅샷 → Mock 순서로 대체한다.
 * 검증 스냅샷은 실제 응답에서 확인된 값이고 Mock은 화면 확인용 값이므로 화면에서 구분해 표시한다.
 */
type FallbackTrace = {
  warnings: string[];
  cachedSources: string[];
};

export async function runAnalysis(
  selection: AnalysisSelection,
  requestedMode?: "mock" | "live",
): Promise<AnalysisResult> {
  const configuredMode = process.env.PUBLIC_DATA_MODE === "live" ? "live" : "mock";
  const requestedDataMode = requestedMode ?? configuredMode;

  if (requestedDataMode === "mock") {
    return withReport(
      analyzeFarm({
        mode: "mock",
        selection,
        parcel: createMockParcel(selection),
        soil: createMockSoil(selection),
        weather: createMockWeather(selection),
        recentClimate: createMockRecentClimate(),
      }),
    );
  }

  if (!hasPublicDataKey()) {
    return fallbackResult(selection, "공공데이터 키가 없어 대체 자료로 분석했습니다.");
  }

  const [farmResult, weatherResult, recentClimateResult] = await Promise.allSettled([
    fetchFarmMapCandidates(selection),
    fetchWeather(selection),
    fetchRecentClimate(selection),
  ]);

  const trace: FallbackTrace = { warnings: [], cachedSources: [] };
  const weather = weatherResult.status === "fulfilled"
    ? weatherResult.value
    : fallbackWeather(selection, weatherResult.reason, trace);
  const recentClimate = recentClimateResult.status === "fulfilled"
    ? recentClimateResult.value
    : fallbackRecentClimate(selection, recentClimateResult.reason, trace);
  const parcel = farmResult.status === "fulfilled"
    ? reconcileParcel(farmResult.value.candidates, null, trace.warnings, selection)
    : fallbackParcel(selection, farmResult.reason, trace);
  const soil = await soilForParcel(selection, parcel, trace);

  const resultMode: DataMode = [parcel.status, soil.status, weather.status, recentClimate.status].every(
    (status) => status === "connected",
  ) ? "live" : "fallback";

  return withReport(
    analyzeFarm({
      mode: resultMode,
      warning: trace.warnings.length > 0 ? trace.warnings.join(" ") : null,
      cacheNotice: snapshotNotice(trace.cachedSources),
      selection,
      parcel,
      soil,
      weather,
      recentClimate,
    }),
  );
}

/**
 * 규칙 결과가 확정된 뒤에만 설명을 만든다.
 * 설명 단계는 판정·수치를 바꿀 수 없고, 실패하면 같은 근거의 규칙 기반 문장으로 대체된다.
 */
async function withReport(result: AnalysisResult): Promise<AnalysisResult> {
  const [report, showcase] = await Promise.all([
    createFarmReport(result),
    buildShowcaseOutcome(result),
  ]);
  return {
    ...result,
    report,
    showcaseReport: showcase.report,
    showcaseNote: showcase.note,
  };
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "알 수 없는 연결 오류";
}

function fallbackParcel(
  selection: AnalysisSelection,
  reason: unknown,
  trace: FallbackTrace,
) {
  const cached = verifiedParcel(selection);
  if (cached) {
    trace.cachedSources.push("농지 정보");
    trace.warnings.push(`농지 정보는 검증 스냅샷으로 대체했습니다. (${errorMessage(reason)})`);
    return cached;
  }
  trace.warnings.push(`농지 정보는 대체 자료를 사용합니다. (${errorMessage(reason)})`);
  return createMockParcel(selection, "fallback");
}

function fallbackSoil(
  selection: AnalysisSelection,
  reason: unknown,
  trace: FallbackTrace,
) {
  const cached = verifiedSoil(selection);
  if (cached) {
    trace.cachedSources.push("토양 자료");
    trace.warnings.push(`토양 자료는 검증 스냅샷으로 대체했습니다. (${errorMessage(reason)})`);
    return cached;
  }
  trace.warnings.push(`토양 자료는 대체 자료를 사용합니다. (${errorMessage(reason)})`);
  return createMockSoil(selection, "fallback");
}

function fallbackWeather(
  selection: AnalysisSelection,
  reason: unknown,
  trace: FallbackTrace,
) {
  const cached = verifiedWeather(selection);
  if (cached) {
    trace.cachedSources.push("단기예보");
    trace.warnings.push(`단기예보는 검증 스냅샷으로 대체했습니다. (${errorMessage(reason)})`);
    return cached;
  }
  trace.warnings.push(`단기예보는 대체 자료를 사용합니다. (${errorMessage(reason)})`);
  return createMockWeather(selection, undefined, "fallback");
}

function fallbackRecentClimate(
  selection: AnalysisSelection,
  reason: unknown,
  trace: FallbackTrace,
) {
  const cached = verifiedRecentClimate(selection);
  if (cached) {
    trace.cachedSources.push("최근 관측");
    trace.warnings.push(`최근 관측은 검증 스냅샷으로 대체했습니다. (${errorMessage(reason)})`);
    return cached;
  }
  trace.warnings.push(`최근 관측은 대체 자료를 사용합니다. (${errorMessage(reason)})`);
  return createMockRecentClimate("fallback");
}

async function soilForParcel(
  selection: AnalysisSelection,
  parcel: ReturnType<typeof createMockParcel>,
  trace: FallbackTrace,
) {
  if (parcel.selectionStatus === "matched" && /^\d{19}$/.test(parcel.parcelId)) {
    try {
      return await fetchSoilByParcel(parcel.parcelId);
    } catch (error) {
      trace.warnings.push(
        `필지번호로 토양을 조회하지 못해 좌표로 다시 확인합니다. (${errorMessage(error)})`,
      );
    }
  }

  try {
    return await fetchSoil(selection);
  } catch (error) {
    return fallbackSoil(selection, error, trace);
  }
}

function fallbackResult(selection: AnalysisSelection, warning: string) {
  const trace: FallbackTrace = { warnings: [], cachedSources: [] };
  const parcel = verifiedParcel(selection);
  const soil = verifiedSoil(selection);
  const weather = verifiedWeather(selection);
  const recentClimate = verifiedRecentClimate(selection);
  if (parcel) trace.cachedSources.push("농지 정보");
  if (soil) trace.cachedSources.push("토양 자료");
  if (weather) trace.cachedSources.push("단기예보");
  if (recentClimate) trace.cachedSources.push("최근 관측");

  return withReport(
    analyzeFarm({
      mode: "fallback",
      warning,
      cacheNotice: snapshotNotice(trace.cachedSources),
      selection,
      parcel: parcel ?? createMockParcel(selection, "fallback"),
      soil: soil ?? createMockSoil(selection, "fallback"),
      weather: weather ?? createMockWeather(selection, undefined, "fallback"),
      recentClimate: recentClimate ?? createMockRecentClimate("fallback"),
    }),
  );
}

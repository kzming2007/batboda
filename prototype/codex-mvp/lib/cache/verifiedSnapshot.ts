import snapshot from "@/lib/cache/snapshots/verified.json";
import type {
  AnalysisSelection,
  ParcelData,
  RecentClimateData,
  SoilData,
  VerifiedSnapshotProvenance,
  WeatherData,
} from "@/types/domain";

/**
 * 검증 스냅샷은 실시간 호출이 실패했을 때만 사용하는 대체 경로다.
 * Mock과 달리 실제 공공데이터 응답에서 확인된 값만 담고, 출처·수집시각·재현 절차를 함께 노출한다.
 * 값을 새로 채울 때는 개발 서버에서 `/api/cache/capture`를 호출해 이 파일을 갱신한다.
 */

const source = snapshot as unknown as {
  id: string;
  label: string;
  match: { lat: number; lng: number; toleranceDeg: number };
  provenance: {
    collectedAt: string;
    collectedBy: "documented-audit" | "capture-route";
    reproduce: string;
    verificationDocs: string[];
  };
  parcel: {
    address: string;
    parcelId: string;
    farmMapId: string | null;
    interpretation: string;
    candidateCount: number;
    observedAt: string;
  } | null;
  soil: (Omit<
    SoilData,
    "status" | "source" | "parcelId" | "farmMapId"
  > & { parcelId?: string | null; farmMapId?: string | null }) | null;
  recentClimate: Omit<RecentClimateData, "status" | "source"> | null;
  weather: { issuedAt: string; days: WeatherData["days"] } | null;
};

export function snapshotProvenance(): VerifiedSnapshotProvenance {
  return {
    id: source.id,
    label: source.label,
    collectedAt: source.provenance.collectedAt,
    collectedBy: source.provenance.collectedBy,
    reproduce: source.provenance.reproduce,
    verificationDocs: source.provenance.verificationDocs,
  };
}

/**
 * 스냅샷은 같은 땅일 때만 쓴다.
 * 좌표 허용 오차는 최대 0.002°(약 200m)로 제한하고, 사용자가 필지를 확정했다면
 * 그 필지번호가 스냅샷과 같을 때만 사용한다. 다른 필지에 남의 토양값을 붙이지 않기 위한 조건이다.
 */
const MAX_TOLERANCE_DEG = 0.002;

function matchesSnapshot(selection: AnalysisSelection) {
  const { lat, lng } = source.match;
  const tolerance = Math.min(source.match.toleranceDeg, MAX_TOLERANCE_DEG);
  const withinRadius =
    Math.abs(selection.lat - lat) <= tolerance &&
    Math.abs(selection.lng - lng) <= tolerance;
  if (!withinRadius) return false;
  if (selection.parcelId && source.parcel && selection.parcelId !== source.parcel.parcelId) {
    return false;
  }
  return true;
}

function collectedLabel() {
  return `검증 스냅샷 ${source.provenance.collectedAt} 수집`;
}

export function verifiedParcel(selection: AnalysisSelection): ParcelData | null {
  if (!matchesSnapshot(selection) || !source.parcel) return null;
  return {
    address: source.parcel.address,
    parcelId: source.parcel.parcelId,
    farmMapId: source.parcel.farmMapId,
    interpretation: source.parcel.interpretation,
    candidateCount: source.parcel.candidateCount,
    selectionStatus: "matched",
    status: "cache",
    source: `농림축산식품부 팜맵 · ${collectedLabel()}`,
    observedAt: source.parcel.observedAt,
  };
}

export function verifiedSoil(selection: AnalysisSelection): SoilData | null {
  if (!matchesSnapshot(selection) || !source.soil) return null;
  return {
    ...source.soil,
    parcelId: source.parcel?.parcelId ?? null,
    farmMapId: source.parcel?.farmMapId ?? null,
    status: "cache",
    source: `농경지 토양분석·토양특성 · ${collectedLabel()}`,
  };
}

export function verifiedRecentClimate(
  selection: AnalysisSelection,
): RecentClimateData | null {
  if (!matchesSnapshot(selection) || !source.recentClimate) return null;
  return {
    ...source.recentClimate,
    status: "cache",
    source: `농업기상 기본 관측 · ${collectedLabel()}`,
  };
}

export function verifiedWeather(
  selection: AnalysisSelection,
): WeatherData | null {
  if (!matchesSnapshot(selection) || !source.weather) return null;
  return {
    issuedAt: `${source.weather.issuedAt} · ${collectedLabel()} 시점 예보`,
    status: "cache",
    source: `기상청 단기예보 · ${collectedLabel()}`,
    // 저장된 `오늘·내일` 라벨은 재생 시점에 맞지 않으므로 날짜 표기로 바꾼다.
    days: source.weather.days.slice(0, selection.horizonDays).map((day) => ({
      ...day,
      label: day.date.slice(5).replace("-", "."),
    })),
  };
}

export function snapshotNotice(usedSources: string[]): string | null {
  if (usedSources.length === 0) return null;
  return `${usedSources.join("·")}는 실시간 조회가 실패해 ${source.label}(${source.provenance.collectedAt} 수집)으로 대체했습니다. 출처와 재현 절차는 ${source.provenance.verificationDocs[0]}에 있습니다.`;
}

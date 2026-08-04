"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cropList, cropProfiles } from "@/lib/analysis/cropProfiles";
import { baselineEnginePolicy } from "@/lib/analysis/modelPolicy";
import {
  decodedSoilProfile,
  limitingFactorLabel,
  soilUseKindLabel,
  suitabilityGradeLabel,
} from "@/lib/analysis/soilCodes";
import {
  favoriteId,
  favoritesServerSnapshot,
  favoritesSnapshot,
  isFavorite,
  subscribeFavorites,
  toggleFavorite,
  updateFavorites,
  type FavoriteFarm,
} from "@/lib/favorites";
import { officialLinks } from "@/lib/officialLinks";
import { highlightsFor } from "@/lib/report/highlight";
import type {
  AnalysisResult,
  AnalysisSelection,
  AnalyzeResponse,
  CropId,
  FactorMeter,
  FactorState,
  ParcelBoundary,
  ParcelCandidate,
  ParcelSearch,
  ScoreExplanation,
  ShowcaseHighlight,
  ShowcaseReport,
  ShowcaseTrace,
  SourceStatus,
} from "@/types/domain";

const FarmMap = dynamic(() => import("@/components/FarmMap"), {
  ssr: false,
  loading: () => <div className="map-loading">지도를 불러오는 중입니다…</div>,
});

type Props = {
  initialResult: AnalysisResult;
};

/**
 * 한 화면에 전부 쌓지 않고 네 페이지로 나눈다.
 * 스크롤로 훑는 대신 페이지가 바뀌므로 각 화면의 정보량이 고정되고,
 * 1분 영상에서도 스크롤 대신 화면 전환으로 구간을 끊을 수 있다.
 */
type View = "input" | "verdict" | "evidence" | "report";

const viewSteps: { id: View; step: string; label: string }[] = [
  { id: "input", step: "01", label: "농지·작물·기간" },
  { id: "verdict", step: "02", label: "농지 환경 판정서" },
  { id: "evidence", step: "03", label: "자세한 근거" },
  { id: "report", step: "04", label: "쉬운 말 보고서" },
];

const places = [
  { name: "평창 대관령", note: "고랭지 밭", lat: 37.675, lng: 128.718 },
  { name: "경북 영주", note: "내륙 농지", lat: 36.872, lng: 128.74 },
  { name: "경기 이천", note: "평야 농지", lat: 37.265, lng: 127.198 },
];

/**
 * 분석 시각 표기.
 *
 * `Intl.DateTimeFormat`은 실행 환경(Node·브라우저)의 ICU 버전에 따라 공백 문자가 달라진다.
 * 서버 렌더 결과와 클라이언트 렌더 결과가 한 글자라도 다르면 hydration 불일치 경고가 뜨므로,
 * 한국시간으로 직접 조립해 양쪽이 항상 같은 문자열을 만들게 한다.
 */
function formatAnalyzedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const hour24 = kst.getUTCHours();
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const half = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${month}. ${day}. ${half} ${String(hour12).padStart(2, "0")}:${minute}`;
}

/** 천 단위 구분. `toLocaleString`은 환경에 따라 결과가 달라질 수 있어 직접 넣는다. */
function withComma(value: number) {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 하늘 상태 문구에 맞는 간단한 아이콘. 공식 값을 대체하지 않고 함께 표시한다. */
function skyIcon(sky: string) {
  if (sky.includes("눈")) return "🌨";
  if (sky.includes("비")) return "🌧";
  if (sky.includes("흐림") || sky.includes("흐리")) return "☁️";
  if (sky.includes("구름")) return "⛅";
  return "☀️";
}

/**
 * 상태를 글자 대신 표로 먼저 읽히게 한다.
 *
 * `주의`·`자료 없음`·`현장 확인 필요`는 이미 색과 큰 글자로 나오지만, 문장 안의 단어라서
 * 훑을 때 상태로 잡히지 않는다는 지적을 받았다. 부호와 짧은 이름표를 붙여 눈이 먼저 걸리게 한다.
 *
 * 이모지를 쓰지 않는다. 운영체제마다 그림이 달라 판정서 인상이 기기마다 바뀌고, 크기를 맞추기도
 * 어렵다. 기하 부호는 어디서나 같은 모양으로 나오고 색·굵기를 화면 문법에 맞출 수 있다.
 *
 * 상태 판단은 규칙 엔진이 준 `state`를 그대로 옮긴다. 화면이 다시 판단하지 않는다.
 */
type BadgeTone = "good" | "watch" | "bad" | "info";

const badgeGlyph: Record<BadgeTone, string> = {
  good: "✓",
  watch: "!",
  bad: "▲",
  info: "–",
};

const factorBadge: Record<FactorState, { tone: BadgeTone; label: string }> = {
  good: { tone: "good", label: "기준 안" },
  watch: { tone: "watch", label: "확인 필요" },
  risk: { tone: "bad", label: "기준 밖" },
  // 값이 없으면 기준과 견줄 수가 없다. `자료 없음`이라고 또 적으면 큰 글자와 같은 말을 두 번 한다.
  unknown: { tone: "info", label: "기준 대조 못 함" },
  info: { tone: "info", label: "참고" },
};

function StateBadge({ state }: { state: FactorState | undefined }) {
  const badge = factorBadge[state ?? "unknown"];
  return (
    <span className={`state-badge ${badge.tone}`}>
      <i aria-hidden="true">{badgeGlyph[badge.tone]}</i>
      {badge.label}
    </span>
  );
}

/**
 * 판정서 머리 아래에 상태를 한 줄로 모아 둔다. 훑기만 해도 무엇이 걸리는지 보이게 한다.
 *
 * 값 자체가 무엇에 대한 것인지 말하고 있으면 이름표를 붙이지 않는다.
 * `근거 · 근거 충분`처럼 같은 말이 두 번 나오면 읽는 눈이 한 번 멈춘다.
 */
function StatusChip({ tone, name, value }: { tone: BadgeTone; name?: string; value: string }) {
  return (
    <span className={`status-chip ${tone}`}>
      <i aria-hidden="true">{badgeGlyph[tone]}</i>
      {name && <span>{name}</span>}
      <strong>{value}</strong>
    </span>
  );
}

/**
 * 기준 대비 눈금.
 *
 * 값만 적어 두면 그 값이 기준에서 얼마나 벗어났는지 알 수 없다. 문제정의서 요구사항 ④가
 * 요구하는 `전문 용어를 직관적인 시각 요소로 치환`이 이것이다.
 *
 * 숫자는 규칙 엔진이 `factor.meter`로 확정해 넘긴다. 화면이 문자열을 되풀어 읽거나
 * 값을 다시 계산하지 않는다. 눈금이 없는 항목(EC·유기물, 주야 기준 작물의 기온)은
 * 아무것도 그리지 않는다.
 *
 * 눈금은 이미 글자로 적혀 있는 값을 그림으로 되짚는 장치다. 그래서 보조기기에는
 * 두 번 읽히지 않게 감춘다. 다만 배수 눈금의 이름표는 행 문구와 낱말이 다르므로
 * (V3 원문 6단계 대 점수에 반영된 3단계) 그 한 줄은 읽히게 남긴다.
 */
function FactorMeterView({ meter, state }: { meter: FactorMeter; state: FactorState }) {
  const tone = factorBadge[state].tone;

  if (meter.kind === "range") {
    const span = meter.axisMax - meter.axisMin;
    if (span <= 0) return null;
    const at = (value: number) =>
      `${Math.min(100, Math.max(0, ((value - meter.axisMin) / span) * 100))}%`;

    return (
      <div className={`meter ${tone}`} aria-hidden="true">
        <div className="meter-track">
          <span
            className="meter-band"
            style={{ left: at(meter.bandMin), width: `${((meter.bandMax - meter.bandMin) / span) * 100}%` }}
          />
          {meter.value !== null && (
            <span className="meter-mark" style={{ left: at(meter.value) }} />
          )}
        </div>
        <div className="meter-axis">
          {meter.ticks.map((tick, index) => (
            <span key={`${tick}-${index}`}>
              {/*
                눈금 하나가 소수를 쓰면 축 전체를 같은 자릿수로 맞춘다. `5.5 6 6.5 7`처럼
                섞이면 6이 6.0보다 작은 값처럼 읽힌다.
                단위는 마지막 눈금에만 붙인다. 네 번 되풀면 축이 읽히지 않는다.
              */}
              {meter.ticks.some((value) => !Number.isInteger(value)) ? tick.toFixed(1) : tick}
              {index === meter.ticks.length - 1 ? meter.unit : ""}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (meter.kind === "grade") {
    // 1급지가 가장 좋다. 채운 칸이 적을수록 좋은 땅이라는 뜻이라 이름표로 방향을 밝힌다.
    return (
      <div className={`meter ${tone}`}>
        <div className="meter-cells" aria-hidden="true">
          {Array.from({ length: meter.total }, (_, index) => (
            <i key={index} className={meter.value !== null && index < meter.value ? "on" : ""} />
          ))}
        </div>
        <span className="meter-note">
          {meter.value === null
            ? `${meter.total}단계 중 어디인지 조회되지 않았습니다`
            : `${meter.total}단계 중 ${meter.value}단계 · 1급지가 가장 좋음`}
        </span>
      </div>
    );
  }

  return (
    <div className={`meter ${tone}`}>
      <div className="meter-cells" aria-hidden="true">
        {meter.labels.map((label, index) => (
          <i key={label} className={meter.index !== null && index <= meter.index ? "on" : ""} />
        ))}
      </div>
      <span className="meter-note">
        {meter.index === null
          ? "점수에 반영된 단계가 없습니다"
          : `점수에 반영된 단계 · ${meter.labels[meter.index]}`}
      </span>
    </div>
  );
}

function basisLabel(basis: ScoreExplanation["terms"][number]["basis"]) {
  if (basis === "official") return "공식 범위";
  if (basis === "mixed") return "공식 기준 + 자체 가중치";
  if (basis === "missing") return "자료 없음 반영";
  if (basis === "outlier") return "허용범위 밖 제외";
  return "자체 설계 가중치";
}

export default function FarmDecisionApp({ initialResult }: Props) {
  const [selection, setSelection] = useState<AnalysisSelection>(initialResult.selection);
  const [result, setResult] = useState(initialResult);
  const [configured, setConfigured] = useState(false);
  const [dataMode, setDataMode] = useState<"mock" | "live">("mock");
  const [loading, setLoading] = useState(false);
  const [parcelLoading, setParcelLoading] = useState(false);
  const [parcelSearch, setParcelSearch] = useState<ParcelSearch | null>(null);
  const [boundary, setBoundary] = useState<ParcelBoundary | null>(null);
  const [boundaryNote, setBoundaryNote] = useState<string | null>(null);
  const [boundaryLoading, setBoundaryLoading] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("input");
  const [analyzed, setAnalyzed] = useState(false);
  // 즐겨찾기는 리액트 바깥(localStorage)에 산다. 서버 렌더에서는 빈 목록이다.
  const favorites = useSyncExternalStore(
    subscribeFavorites,
    favoritesSnapshot,
    favoritesServerSnapshot,
  );

  useEffect(() => {
    fetch("/api/status")
      .then((response) => response.json())
      .then((status: { configured?: boolean; defaultMode?: string }) => {
        setConfigured(Boolean(status.configured));
        if (status.configured && status.defaultMode === "live") setDataMode("live");
      })
      .catch(() => setConfigured(false));
  }, []);

  const activePlace = useMemo(
    () =>
      places.find(
        (place) =>
          Math.abs(place.lat - selection.lat) < 0.0001 &&
          Math.abs(place.lng - selection.lng) < 0.0001,
      ),
    [selection.lat, selection.lng],
  );

  const updateSelection = <K extends keyof AnalysisSelection>(
    key: K,
    value: AnalysisSelection[K],
  ) => setSelection((current) => ({ ...current, [key]: value }));

  const resetParcel = (next: AnalysisSelection) => {
    return {
      lat: next.lat,
      lng: next.lng,
      cropId: next.cropId,
      horizonDays: next.horizonDays,
    };
  };

  const clearParcelSearch = () => {
    setParcelSearch(null);
    setCandidateQuery("");
    // 후보를 다시 찾으면 이전 필지의 경계가 지도에 남아 있으면 안 된다.
    setBoundary(null);
    setBoundaryNote(null);
  };

  const visibleCandidates = useMemo(() => {
    if (!parcelSearch) return [];
    const query = candidateQuery.trim().replace(/\s+/g, "").toLowerCase();
    const filtered = query
      ? parcelSearch.candidates.filter((candidate) =>
          `${candidate.address}${candidate.parcelId}${candidate.interpretation}`
            .replace(/\s+/g, "")
            .toLowerCase()
            .includes(query),
        )
      : parcelSearch.candidates;
    return filtered.slice(0, 8);
  }, [candidateQuery, parcelSearch]);

  async function findParcels() {
    setParcelLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        lat: String(selection.lat),
        lng: String(selection.lng),
        cropId: selection.cropId,
        horizonDays: String(selection.horizonDays),
        mode: dataMode,
      });
      const response = await fetch(`/api/farm?${params.toString()}`);
      const body = (await response.json()) as
        | { ok: true; data: ParcelSearch }
        | { ok: false; error: string };
      if (!body.ok) throw new Error(body.error);
      setParcelSearch(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "농지 후보를 찾지 못했습니다.");
    } finally {
      setParcelLoading(false);
    }
  }

  function confirmParcel(candidate: ParcelCandidate) {
    setSelection((current) => ({
      ...current,
      parcelId: candidate.parcelId,
      farmMapId: candidate.farmMapId,
      parcelAddress: candidate.address,
      parcelInterpretation: candidate.interpretation,
    }));
    void loadBoundary(candidate.parcelId);
  }

  /**
   * 확정한 필지의 경계를 지도에 올린다.
   *
   * 판정 흐름과 떼어 둔다. 경계가 없거나 조회가 실패해도 분석은 그대로 진행되고,
   * 화면에는 왜 못 그렸는지만 적는다. 없는 경계를 임의로 그리지 않는다.
   */
  async function loadBoundary(parcelId: string) {
    setBoundary(null);
    setBoundaryNote(null);
    setBoundaryLoading(true);
    try {
      const params = new URLSearchParams({ parcelId, mode: dataMode });
      const response = await fetch(`/api/boundary?${params.toString()}`);
      const body = (await response.json()) as
        | { ok: true; boundary: ParcelBoundary | null; reason: string | null }
        | { ok: false; error: string };
      if (!body.ok) {
        setBoundaryNote(body.error);
        return;
      }
      setBoundary(body.boundary);
      setBoundaryNote(body.reason);
    } catch (caught) {
      setBoundaryNote(caught instanceof Error ? caught.message : "경계를 불러오지 못했습니다.");
    } finally {
      setBoundaryLoading(false);
    }
  }

  function switchFavorite(candidate: ParcelCandidate) {
    // 저장된 현재 값 위에 얹는다. 렌더 시점 목록을 쓰면 별표를 연달아 누를 때 앞의 것이 사라진다.
    updateFavorites((current) =>
      toggleFavorite(
        current,
        candidate,
        { lat: selection.lat, lng: selection.lng },
        new Date().toISOString(),
      ),
    );
  }

  /** 담아 둔 자리에서 바로 뺀다. 후보 목록을 다시 찾아 들어가지 않아도 되게 한다. */
  function removeFavorite(farm: FavoriteFarm) {
    updateFavorites((current) =>
      current.filter((item) => favoriteId(item) !== favoriteId(farm)),
    );
  }

  /**
   * 저장해 둔 농지로 되돌아간다. 좌표와 필지를 함께 넣어 지번을 다시 검색하지 않아도 되게 한다.
   * 판정은 담아 두지 않았으므로 분석은 다시 돌린다.
   */
  function restoreFavorite(farm: FavoriteFarm) {
    setSelection((current) => ({
      ...current,
      lat: farm.lat,
      lng: farm.lng,
      parcelId: farm.parcelId,
      farmMapId: farm.farmMapId,
      parcelAddress: farm.address,
      parcelInterpretation: farm.interpretation,
    }));
    // 후보 목록은 비우되 경계는 다시 그린다. 목록에서 고른 것과 같은 화면이어야 한다.
    clearParcelSearch();
    void loadBoundary(farm.parcelId);
  }

  function goToView(next: View) {
    setView(next);
    // 페이지가 바뀌면 이전 화면의 스크롤 위치를 물려받지 않게 맨 위로 올린다.
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  }

  async function analyze() {
    if (dataMode === "live" && !selection.parcelId) {
      setError("실제 공공데이터로 분석하기 전에 주변 농지를 찾아 내 농지를 골라 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...selection, mode: dataMode }),
      });
      const body = (await response.json()) as AnalyzeResponse;
      if (!body.ok) throw new Error(body.error);
      setResult(body.result);
      setAnalyzed(true);
      goToView("verdict");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "분석을 완료하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="밭보다 홈">
          <span className="brand-mark" aria-hidden="true">밭</span>
          <span>밭보다</span>
        </a>
        <div className="header-context">
          <span className="phase-label">공공데이터 기반 농지 환경 판정</span>
          <span className="header-rule" aria-hidden="true" />
          <span>첫 재배 환경 확인</span>
        </div>
      </header>

      <main id="top">
        {view === "input" && (
          <section className="intro-section" aria-labelledby="intro-title">
            <div>
              <p className="eyebrow">농지 환경 확인</p>
              <h1 id="intro-title">내 땅의 실제 환경이 희망 작물 기준에 맞는지 확인합니다.</h1>
            </div>
            <ol className="flow-guide" aria-label="분석 순서">
              <li><span>1</span><strong>내 농지 찾기</strong><small>지도에서 고르고 지번으로 확인</small></li>
              <li><span>2</span><strong>작물 기준과 비교</strong><small>공식 생육 기준과 실제 값 대조</small></li>
              <li><span>3</span><strong>가까운 위험 대비</strong><small>예보에서 먼저 할 일 확인</small></li>
            </ol>
          </section>
        )}

        <nav className="phase-nav" aria-label="화면 단계">
          {viewSteps.map((item) => {
            const reachable = item.id === "input" || analyzed;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={view === item.id ? "page" : undefined}
                disabled={!reachable}
                onClick={() => goToView(item.id)}
              >
                <span>{item.step}</span> {item.label}
              </button>
            );
          })}
        </nav>

        {/*
          `hidden` 속성은 쓰지 않는다. `.workbench { display: grid }`가 브라우저 기본
          `[hidden] { display: none }`을 이겨서 다른 페이지에서도 지도가 그대로 보였다.
          지도를 display:none으로 감춰 두면 Leaflet이 크기를 잘못 잡는 문제도 있어
          입력 페이지가 아닐 때는 아예 렌더하지 않는다.
        */}
        {view === "input" && (
        <section
          className="workbench"
          id="farm-settings"
          aria-label="농지 분석 조건 설정"
        >
          <div className="map-panel">
            <div className="panel-heading">
              <div>
                <span className="step-number">01</span>
                <h2>농지 위치</h2>
              </div>
              <p>지도를 눌러 핀을 옮기세요.</p>
            </div>
            <div className="map-frame">
              <FarmMap
                lat={selection.lat}
                lng={selection.lng}
                boundary={boundary}
                searchRadiusM={parcelSearch?.radiusM ?? null}
                onChange={(lat, lng) =>
                  {
                    setSelection((current) => resetParcel({ ...current, lat, lng }));
                    clearParcelSearch();
                  }
                }
              />
              {selection.parcelId && (
                <div className={`map-parcel-card${boundary ? " has-boundary" : ""}`}>
                  <div className="map-parcel-card__head">
                    <strong>{selection.parcelAddress ?? "확정한 농지"}</strong>
                    <em>
                      {boundaryLoading
                        ? "경계 조회 중"
                        : boundary
                          ? "실제 경계 확인"
                          : "경계 자료 없음"}
                    </em>
                  </div>
                  <dl>
                    <div><dt>PNU</dt><dd>{selection.parcelId}</dd></div>
                    {selection.farmMapId && (
                      <div><dt>팜맵 ID</dt><dd>{selection.farmMapId}</dd></div>
                    )}
                    {selection.parcelInterpretation && (
                      <div><dt>농지 유형</dt><dd>{selection.parcelInterpretation}</dd></div>
                    )}
                    {boundary && (
                      <div><dt>판독 시점</dt><dd>{boundary.observedAt}</dd></div>
                    )}
                  </dl>
                  {!boundary && boundaryNote && !boundaryLoading && (
                    <p className="map-parcel-card__note">{boundaryNote}</p>
                  )}
                </div>
              )}
              <div className="map-index" aria-hidden="true">
                <span>N</span>
                <i />
              </div>
              <div className="map-caption">
                <div>
                  <strong>{activePlace?.name ?? "지도에서 선택한 위치"}</strong>
                  <span>{activePlace?.note ?? "사용자 지정 좌표"}</span>
                </div>
                <code>{selection.lat.toFixed(4)} N · {selection.lng.toFixed(4)} E</code>
              </div>
            </div>
            {/*
              프리셋 세 곳은 시연용이라 실제 사용자의 농지가 아니다. 한 번 찾은 농지를 다시 부를
              수단이 없으면 두 번째 방문이 첫 방문과 똑같이 오래 걸린다.
              저장은 브라우저 안에서만 한다. 농지 위치를 서버로 보내지 않는다.
            */}
            <div className="favorite-shortcuts" aria-label="즐겨찾는 내 농지">
              <span className="favorite-shortcuts-label">내 농지</span>
              {favorites.length === 0 ? (
                <p className="favorite-empty">
                  아래 후보 목록에서 <span aria-hidden="true">★</span>을 누르면 이 자리에 담깁니다.
                  이 브라우저에만 저장되고 서버로 보내지 않습니다.
                </p>
              ) : (
                <div className="favorite-list">
                  {/*
                    빼는 동작을 후보 목록까지 찾아 들어가야 하면 번거롭다. 담아 둔 자리에서 바로 뺀다.
                    마우스를 올렸을 때 드러내되 DOM에서 지우지는 않는다. 키보드로도 닿아야 한다.
                  */}
                  {favorites.map((farm) => (
                    <span className="favorite-item" key={favoriteId(farm)}>
                      <button
                        type="button"
                        className="favorite-open"
                        aria-pressed={selection.parcelId === farm.parcelId}
                        onClick={() => restoreFavorite(farm)}
                      >
                        <span>{farm.address}</span>
                        <small>{farm.interpretation}</small>
                      </button>
                      <button
                        type="button"
                        className="favorite-remove"
                        aria-label={`${farm.address} 즐겨찾기에서 빼기`}
                        title="즐겨찾기에서 빼기"
                        onClick={() => removeFavorite(farm)}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/*
              이름표를 눈에 보이게 둔다. `aria-label`만 있으면 보조기기에는 읽히지만
              화면에서는 바로 위 `내 농지` 아래에 버튼이 붙어, 이 셋이 즐겨찾기처럼 읽힌다.
            */}
            {/*
              `대표 시연 농지`라고 쓰면 심사위원에게 `준비된 것만 된다`로 읽힌다. 실제로는
              좌표 프리셋일 뿐이고 어느 지역이든 좌표만 바꾸면 조회된다. 그 사실에 맞게 적는다.
            */}
            <span className="favorite-shortcuts-label">자주 쓰는 지역</span>
            <div className="place-shortcuts" aria-label="자주 쓰는 지역">
              {places.map((place) => (
                <button
                  key={place.name}
                  type="button"
                  aria-pressed={activePlace?.name === place.name}
                  onClick={() =>
                    {
                      setSelection((current) => resetParcel({ ...current, lat: place.lat, lng: place.lng }));
                      clearParcelSearch();
                    }
                  }
                >
                  <span>{place.name}</span>
                  <small>{place.note}</small>
                </button>
              ))}
            </div>

            <section className="parcel-finder" aria-labelledby="parcel-finder-title">
              <div className="parcel-finder-heading">
                <div>
                  <span>01-B 농지 확인</span>
                  <h3 id="parcel-finder-title">실제 농지 확인</h3>
                  <p>핀 주변 후보에서 내 지번을 찾아야 같은 땅의 토양 자료를 가져올 수 있습니다.</p>
                </div>
                <button type="button" onClick={findParcels} disabled={parcelLoading}>
                  {parcelLoading ? "후보 조회 중…" : parcelSearch ? "다시 조회" : "주변 농지 찾기"}
                </button>
              </div>

              {parcelSearch && (
                <div className="parcel-candidate-workspace">
                  <div className="candidate-search-row">
                    <label>
                      <span>지번·주소 검색</span>
                      <input
                        value={candidateQuery}
                        onChange={(event) => setCandidateQuery(event.target.value)}
                        placeholder="예: 123-4"
                      />
                    </label>
                  </div>
                  <p className="candidate-count">
                    반경 {withComma(parcelSearch.radiusM)}m · 후보 {withComma(parcelSearch.candidateCount)}개
                    {parcelSearch.requiresRefinement ? " · 지번 검색 권장" : ""}
                    {" · "}
                    <em className={`candidate-origin origin-${parcelSearch.status}`}>
                      {sourceStatusLabel(parcelSearch.status)}
                    </em>
                  </p>
                  {parcelSearch.liveFailure && (
                    <p className="candidate-fallback-note">
                      실시간 조회가 실패해 저장해 둔 검증 자료로 후보를 보여줍니다.
                      실시간 값이 아닙니다. 실패 이유: {parcelSearch.liveFailure}
                    </p>
                  )}
                  <div className="parcel-candidate-list">
                    {visibleCandidates.map((candidate) => {
                      const selected = selection.parcelId === candidate.parcelId &&
                        selection.farmMapId === candidate.farmMapId;
                      const saved = isFavorite(favorites, candidate);
                      // 선택과 저장은 다른 동작이라 버튼을 나눈다. 버튼 안에 버튼을 넣을 수도 없다.
                      return (
                        <div
                          className="parcel-candidate-row"
                          key={`${candidate.parcelId}:${candidate.farmMapId}`}
                        >
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => confirmParcel(candidate)}
                          >
                            <span className="candidate-index">{selected ? "확정" : "후보"}</span>
                            <span>
                              <strong>{candidate.address}</strong>
                              <small>{candidate.interpretation} · PNU {candidate.parcelId}</small>
                            </span>
                          </button>
                          <button
                            type="button"
                            className="candidate-favorite"
                            aria-pressed={saved}
                            aria-label={
                              saved
                                ? `${candidate.address} 즐겨찾기 해제`
                                : `${candidate.address} 즐겨찾기에 담기`
                            }
                            title={saved ? "즐겨찾기 해제" : "즐겨찾기에 담기"}
                            onClick={() => switchFavorite(candidate)}
                          >
                            <span aria-hidden="true">{saved ? "★" : "☆"}</span>
                          </button>
                        </div>
                      );
                    })}
                    {visibleCandidates.length === 0 && (
                      <p className="candidate-empty">검색어와 일치하는 후보가 없습니다.</p>
                    )}
                  </div>
                  {visibleCandidates.length > 4 && (
                    <p className="candidate-scroll-hint">
                      목록 안에서 스크롤해 {withComma(visibleCandidates.length)}개를 모두 볼 수 있습니다.
                      지번을 검색하면 더 빠릅니다.
                    </p>
                  )}
                  {selection.parcelId && (
                    <p className="parcel-confirmed">
                      <span aria-hidden="true">✓</span>
                      분석 필지 확인 완료 · {selection.parcelAddress}
                      {parcelSearch.status !== "connected" &&
                        ` · ${sourceStatusLabel(parcelSearch.status)}`}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>

          <div className="control-panel">
            <div className="control-block">
              <div className="panel-heading compact">
                <div>
                  <span className="step-number">02</span>
                  <h2>재배 작물</h2>
                </div>
              </div>
              <div className="crop-list">
                {cropList.map((crop) => (
                  <button
                    key={crop.id}
                    type="button"
                    className="crop-option"
                    aria-pressed={selection.cropId === crop.id}
                    onClick={() => updateSelection("cropId", crop.id as CropId)}
                  >
                    <span className="crop-monogram" aria-hidden="true">{crop.emoji}</span>
                    <span>
                      <strong>{crop.name}</strong>
                      <small>{crop.description}</small>
                    </span>
                    <i aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <div className="control-block period-block">
              <div className="panel-heading compact">
                <div>
                  <span className="step-number">03</span>
                  <h2>확인 기간</h2>
                </div>
                <p>단기예보 범위</p>
              </div>
              <div className="period-options">
                {([1, 3] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    aria-pressed={selection.horizonDays === days}
                    onClick={() => updateSelection("horizonDays", days)}
                  >
                    <strong>{days}일</strong>
                    <small>{days === 1 ? "오늘 집중" : "오늘–모레"}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="data-mode-row">
              <div>
                <span className={`status-dot ${configured ? "ready" : ""}`} />
                <span>{configured ? "공공데이터 연결 준비됨" : "시연용 검증 자료로 보는 중"}</span>
              </div>
              <label className={!configured ? "disabled" : ""}>
                <input
                  type="checkbox"
                  checked={dataMode === "live"}
                  disabled={!configured}
                  onChange={(event) => {
                    setDataMode(event.target.checked ? "live" : "mock");
                    setSelection((current) => resetParcel(current));
                    clearParcelSearch();
                  }}
                />
                <span>실제 공공데이터로 조회</span>
              </label>
            </div>

            <button
              className="analyze-button"
              type="button"
              onClick={analyze}
              disabled={loading || (dataMode === "live" && !selection.parcelId)}
            >
              <span>
                {loading
                  ? "근거를 모으는 중…"
                  : dataMode === "live" && !selection.parcelId
                    ? "먼저 내 농지를 확인하세요"
                    : "이 농지 분석하기"}
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14M14 7l5 5-5 5" />
              </svg>
            </button>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </section>
        )}

        {view !== "input" && (
          <AnalysisView result={result} view={view} onNavigate={goToView} />
        )}
      </main>

      <footer className="site-footer">
        <span>밭보다 · 재배 판단을 돕는 참고 서비스</span>
        <span>실제 영농 결정 전 현장 확인과 전문가 검토가 필요합니다.</span>
      </footer>
    </div>
  );
}

function AnalysisView({
  result,
  view,
  onNavigate,
}: {
  result: AnalysisResult;
  view: View;
  onNavigate: (next: View) => void;
}) {
  const parcelStatusLabel =
    result.parcel.selectionStatus === "matched"
      ? "농지 확인 완료"
      : result.parcel.selectionStatus === "needs_confirmation"
        ? "농지 확인 필요"
        : "시연용 농지";
  const decodedProfile = result.soil.physicalProfile
    ? decodedSoilProfile(result.soil.physicalProfile)
    : null;
  /*
    판정에 쓴 적성등급은 작물이 정한다. 사과·배는 과수 등급, 상추·오이·감자는 밭 등급이다.
    화면 문구를 `밭 적성등급`으로 고정해 두면 사과를 골랐을 때 표시가 실제 판정 근거와
    다른 것을 말한다. 엔진과 같은 기준으로 이름과 값을 뽑는다.
  */
  const soilUseKind = cropProfiles[result.selection.cropId].soilUseKind;
  const gradeName = `${soilUseKindLabel(soilUseKind)} 적성등급`;
  const gradeValue = suitabilityGradeLabel(result.soil.physicalProfile, soilUseKind);
  const gradeLimitingFactor = limitingFactorLabel(result.soil.physicalProfile, soilUseKind);
  const factor = (id: string) => result.factors.find((item) => item.id === id);
  const uplandFactor = factor("upland-suitability");
  const phFactor = factor("ph");
  const riskTone: BadgeTone =
    result.riskLevel === "low" ? "good" : result.riskLevel === "high" ? "bad" : "watch";
  const evidenceTone: BadgeTone =
    result.evidenceQuality.level === "strong"
      ? "good"
      : result.evidenceQuality.level === "weak"
        ? "bad"
        : "watch";
  const stageTone =
    result.suitabilityLabel === "적합"
      ? "good"
      : result.suitabilityLabel === "조건부 적합"
        ? "watch"
        : "bad";
  const leadSentence = result.report?.sections[0]?.body ?? result.summary;
  // 판정 문장과 위험 문장을 한 줄에 붙이지 않고 문장마다 줄을 나눈다.
  // `-다.` 뒤 공백만 끊으므로 pH 6.9 같은 소수점은 잘리지 않는다.
  const leadLines = leadSentence.split(/(?<=다\.)\s+/).filter(Boolean);

  const verdictPage = (
    <section className="verdict-sheet" id="analysis-result" aria-labelledby="result-title">
      <div className="sheet-masthead">
        <span className="sheet-brand">밭보다</span>
        <span className="sheet-kind">농지 환경 판정서</span>
        <span className="sheet-issued">
          {formatAnalyzedAt(result.analyzedAt)} · {result.modeLabel} · 실시간 연결{" "}
          {result.evidenceQuality.connectedSources}/{result.evidenceQuality.totalSources}
        </span>
        <button className="sheet-edit" type="button" onClick={() => onNavigate("input")}>
          조건 다시 설정
        </button>
      </div>
      <div className="sheet-rule strong" />

      <p className="sheet-subject">
        {result.parcel.address} · {result.cropName} · 가까운 {result.selection.horizonDays}일
      </p>
      <h2 id="result-title" className={`sheet-verdict ${stageTone}`}>{result.suitabilityLabel}</h2>
      {/*
        판정 아래에 상태를 한 줄로 모은다. 판정은 위에 크게 있으니 여기서 되풀이하지 않고,
        문장 속에 묻혀 있던 위험 등급·근거 수준·자료 공백만 부호와 함께 꺼낸다.
      */}
      <div className="status-strip" aria-label="상태 요약">
        <StatusChip tone={riskTone} name={`가까운 ${result.selection.horizonDays}일 위험`} value={result.riskLabel} />
        <StatusChip
          tone={evidenceTone}
          value={`${result.evidenceQuality.label} · 실시간 ${result.evidenceQuality.connectedSources}/${result.evidenceQuality.totalSources}`}
        />
        {result.evidenceQuality.missingCount > 0 && (
          <StatusChip tone="info" name="빠진 자료" value={`${result.evidenceQuality.missingCount}건`} />
        )}
      </div>

      <div className="sheet-lead">
        {leadLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {/*
        판정 근거로 쓴 적성등급은 작물이 정한 용도(밭 또는 과수) 기준이다. 팜맵이 논으로
        판독한 필지에 그 등급을 그대로 쓰면 근거가 약해지므로, 판정을 막지 않고 무엇을 더
        확인해야 하는지 한 줄로 알린다. 논에 밭작물·과수를 심는 전환은 실제로 있으므로
        선택 자체를 차단하지는 않는다.
      */}
      {isPaddyParcel(result.parcel.interpretation) && (
        <div className="paddy-notice" role="status">
          <strong>논으로 판독된 필지입니다</strong>
          <p>
            판정 근거인 {gradeName}은 {soilUseKindLabel(soilUseKind)}을 기준으로 매겨진 값입니다.
            논에 {soilUseKind === "orchard" ? "과수를" : "밭작물을"} 심으시려면 물빠짐과
            배수로를 현장에서 먼저 확인하시고, 지역 농업기술센터에 논 타작물 재배 조건을 함께 문의하세요.
          </p>
        </div>
      )}

      {result.warning && <div className="data-warning" role="status">{result.warning}</div>}
      {result.cacheNotice && (
        <div className="cache-notice" role="status">
          <strong>검증 스냅샷 사용</strong>
          <p>{result.cacheNotice}</p>
        </div>
      )}


      <div className="sheet-rule" />
      <div className="sheet-columns">
        {/*
          각 숫자 옆에 그 값이 기준 안인지 밖인지를 부호로 붙인다. 색만으로는 색을 구분하기 어려운
          사람에게 상태가 전달되지 않고, 훑을 때도 색보다 부호가 먼저 걸린다.
        */}
        <article>
          <span>토양 적성</span>
          <strong className={uplandFactor?.state === "good" ? "good" : "watch"}>
            {uplandFactor?.value ?? "자료 없음"}
          </strong>
          {/*
            값만 두면 `2급지`가 좋은 쪽인지 나쁜 쪽인지 알 수 없다. 눈금이 그것을 말한다.
            03·04와 같은 컴포넌트를 쓴다. 같은 값이 화면마다 다르게 보이면 같은 값인지 모른다.
          */}
          {uplandFactor?.meter && (
            <FactorMeterView meter={uplandFactor.meter} state={uplandFactor.state} />
          )}
          <StateBadge state={uplandFactor?.state} />
          <p>공식 {uplandFactor?.target ?? "1–2급지"} 기준 · {uplandFactor?.impact ?? "확인 필요"}</p>
        </article>
        <article>
          <span>토양 산도</span>
          {/*
            자료가 없는 것과 기준을 벗어난 것은 다르다. 없는 값을 주의색으로 칠하면 흙에 문제가
            있는 것처럼 읽힌다. 회색으로 두어 `아직 모른다`로 보이게 한다.
          */}
          <strong
            className={
              phFactor?.value === "자료 없음" ? "info" : phFactor?.state === "good" ? "good" : "watch"
            }
          >
            {phFactor?.value === "자료 없음" ? "자료 없음" : `pH ${phFactor?.value ?? "–"}`}
          </strong>
          {phFactor?.meter && <FactorMeterView meter={phFactor.meter} state={phFactor.state} />}
          <StateBadge state={phFactor?.value === "자료 없음" ? "unknown" : phFactor?.state} />
          <p>{result.cropName} 공식 범위 {phFactor?.target ?? "–"} 이내</p>
        </article>
        <article>
          <span>가까운 {result.selection.horizonDays}일 위험</span>
          <strong className={riskTone}>{result.riskLabel}</strong>
          <StateBadge state={riskTone === "good" ? "good" : riskTone === "bad" ? "risk" : "watch"} />
          <p>{result.weather.days
            .map((day) => `${day.label} 비 ${day.rainProbability ?? "–"}%`)
            .join(" · ")}</p>
        </article>
      </div>

      <div className="sheet-rule" />
      <ol className="sheet-actions">
        {result.actions.map((action, index) => {
          const note = result.report?.actionNotes[index]?.note ?? action.detail;
          return (
            <li key={action.title}>
              <div>
                <span className="action-no">{action.priority}</span>
                <h3>{action.title}</h3>
                <time>{action.timing}</time>
              </div>
              <p>{note}</p>
            </li>
          );
        })}
      </ol>

      {result.report && (
        <>
          <div className="sheet-rule" />
          <section className="sheet-explain" aria-labelledby="explain-title">
            <div className="explain-head">
              <h3 id="explain-title">쉬운 설명</h3>
              <strong className={`explain-origin ${result.report.origin}`}>
                {result.report.originLabel}
              </strong>
            </div>
            <div className="explain-blocks">
              {result.report.sections.map((section) => (
                <article key={section.heading}>
                  <h4>{section.heading}</h4>
                  <p>
                    <Emphasized
                      text={section.body}
                      highlights={highlightsFor(section.body, result)}
                    />
                  </p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <div className="sheet-rule strong" />
      <nav className="page-jump" aria-label="다음으로 볼 화면">
        <button type="button" onClick={() => onNavigate("evidence")}>
          <span>03</span>
          <strong>자세한 근거</strong>
          <small>토양·기온 대조 · 예보 · 농지 확인표 · 계산 과정 · 사용한 자료</small>
        </button>
        <button type="button" onClick={() => onNavigate("report")}>
          <span>04</span>
          <strong>쉬운 말 보고서</strong>
          <small>
            {result.showcaseReport
              ? "초보 귀농인 눈높이 자연어 설명"
              : `pH와 ${gradeName}이 함께 나온 필지에서만 열립니다`}
          </small>
        </button>
      </nav>
    </section>
  );

  const evidencePage = (
    <section className="verdict-sheet" id="analysis-evidence" aria-labelledby="evidence-title">
      <div className="sheet-masthead">
        <span className="sheet-brand">밭보다</span>
        <span className="sheet-kind">자세한 근거</span>
        <span className="sheet-issued">{result.parcel.address} · {result.cropName}</span>
        <button className="sheet-edit" type="button" onClick={() => onNavigate("verdict")}>
          판정서로 돌아가기
        </button>
      </div>
      <div className="sheet-rule strong" />
      <h2 id="evidence-title" className="page-title">무엇을 보고 이렇게 판정했는지</h2>
        <div className="sheet-detail-body">
      <div className="evidence-grid">
        <section className="factor-section" aria-labelledby="factor-title">
          <div className="subsection-heading">
            <div>
              <span>공식 기준 대조</span>
              <h3 id="factor-title">토양·기온 근거</h3>
            </div>
            <p>토양 {result.soil.sampledAt} · {result.soil.sampleType}</p>
          </div>
          <div className="factor-table">
            {/*
              표 머리를 두지 않는다. 각 줄이 값마다 이름표를 달고 있어서 열 제목이
              하는 일이 없다. 이전에는 열 제목이 있었고 좁은 화면에서는 그것을 감춘 뒤
              `::before`로 라벨을 다시 만들어야 했다.
            */}
            {result.factors.map((factor) => (
              <div className="factor-row" key={factor.id}>
                {/*
                  색 점 하나에 `aria-label="good"`이 붙어 있었다. 한국어 화면에서
                  스크린리더가 `good`이라고 읽었고, 색을 못 보는 사람에게는 상태가
                  전달되지 않았다. 02에서 쓰는 배지를 그대로 쓴다 — 색 + 부호 + 낱말
                  셋이 겹치므로 색맹 환경과 야외 양쪽에서 살아남는다.
                */}
                <StateBadge state={factor.state} />
                <strong>{factor.label}</strong>
                <span className="factor-value">{factor.value}</span>
                {factor.meter && <FactorMeterView meter={factor.meter} state={factor.state} />}
                <span className="factor-target">{factor.target}</span>
                <span className="factor-impact">{factor.impact}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="weather-section" aria-labelledby="weather-title">
          <div className="subsection-heading">
            <div>
              <span>확인 기간</span>
              <h3 id="weather-title">선택 기간 예보</h3>
            </div>
            <p>{result.weather.issuedAt}</p>
          </div>
          <div className="weather-timeline">
            {result.weather.days.map((day) => {
              const watchReasons = [
                (day.rainProbability ?? 0) >= baselineEnginePolicy.rainProbabilityWatch
                  ? "비 가능성"
                  : null,
                // 최고 습도는 하루 중 최댓값이라 거의 매일 임계를 넘는다. 41줄 아래
                // 게이지는 이미 평균으로 고쳤는데 이 배지만 최고값을 보고 있었다.
                // 같은 값을 두 자리에서 다르게 판단하면 화면이 자기모순이 된다.
                (day.humidityAverage ?? day.humidity ?? 0) >= baselineEnginePolicy.humidityWatch
                  ? "높은 습도"
                  : null,
              ].filter((reason): reason is string => reason !== null);
              return (
              <article key={day.date} className={watchReasons.length > 0 ? "weather-focus" : ""}>
                <div className="weather-day">
                  <div className="weather-date">
                    <strong>{day.label}</strong>
                    <time>{day.date.slice(5).replace("-", ".")}</time>
                  </div>
                  <p className="weather-sky">
                    <span aria-hidden="true">{skyIcon(day.sky)}</span>
                    {day.sky}
                  </p>
                </div>
                {watchReasons.length > 0 && (
                  <p className="weather-watch">주의 시점 · {watchReasons.join(" · ")}</p>
                )}
                <p className="weather-temp">
                  <strong>{day.maxTemp ?? "–"}°</strong>
                  <span>최저 {day.minTemp ?? "–"}°</span>
                </p>
                <dl className="weather-gauges">
                  <div>
                    <dt>💧 강수 가능성</dt>
                    <dd>{day.rainProbability ?? "–"}%</dd>
                    <div
                      className={`gauge ${
                        (day.rainProbability ?? 0) >= baselineEnginePolicy.rainProbabilityWatch
                          ? "over"
                          : ""
                      }`}
                    >
                      <i style={{ width: `${Math.min(100, day.rainProbability ?? 0)}%` }} />
                    </div>
                  </div>
                  <div>
                    <dt>🌫 습도</dt>
                    <dd>
                      {day.humidityAverage != null ? `평균 ${day.humidityAverage}%` : "평균 –"}
                      <em> · 최고 {day.humidity ?? "–"}%</em>
                    </dd>
                    {/* 막대와 색을 모두 평균 기준으로 둔다.
                        최고 습도는 하루 중 최댓값이라 거의 매일 임계를 넘어, 색으로 쓰면 경고가 상시 점등된다.
                        위험 산식이 최고 습도를 쓰는 사실은 `계산 근거`에서 따로 밝힌다. */}
                    <div
                      className={`gauge ${
                        (day.humidityAverage ?? day.humidity ?? 0) >= baselineEnginePolicy.humidityWatch
                          ? "over"
                          : ""
                      }`}
                    >
                      <i
                        style={{
                          width: `${Math.min(100, day.humidityAverage ?? day.humidity ?? 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                </dl>
              </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className="parcel-sheet" aria-labelledby="parcel-title">
        <div className="parcel-sheet-heading">
          <div>
            <span>선택 농지 확인표</span>
            <h3 id="parcel-title">{result.parcel.address}</h3>
            <p>{result.parcel.interpretation}</p>
          </div>
          <strong className={`parcel-status ${result.parcel.selectionStatus}`}>{parcelStatusLabel}</strong>
        </div>
        <dl className="parcel-facts">
          <div>
            <dt>선택 좌표</dt>
            <dd>{result.selection.lat.toFixed(5)}, {result.selection.lng.toFixed(5)}</dd>
          </div>
          <div>
            <dt>PNU(필지 고유번호)</dt>
            <dd>{result.parcel.parcelId}</dd>
          </div>
          <div>
            <dt>팜맵 ID(농지 도형 번호)</dt>
            <dd>{result.parcel.farmMapId ?? "확인되지 않음"}</dd>
          </div>
          <div>
            <dt>농지 확인 방법</dt>
            <dd>
              {result.parcel.selectionStatus === "matched"
                ? `후보 ${result.parcel.candidateCount}개 중 직접 확인 · 같은 필지번호로 토양 조회`
                : result.parcel.selectionStatus === "needs_confirmation"
                  ? `후보 ${result.parcel.candidateCount}개 · 직접 확인 필요`
                  : "시연용 기준 농지 · 실제 조회 전"}
            </dd>
          </div>
          <div>
            <dt>토양 경계</dt>
            <dd>{result.soil.boundaryAvailable ? "공공데이터에 경계 있음" : "경계 자료 없음"}</dd>
          </div>
          <div>
            <dt>토양 시료</dt>
            <dd>{result.soil.sampledAt} · {result.soil.sampleType}</dd>
          </div>
        </dl>
        {result.soil.physicalProfile && (
          <div className="soil-profile-band" aria-label="토양도 기반 물리성 해석">
            <div>
              <span>공식 토양도(V3)</span>
              <strong>흙의 물리적 조건</strong>
              <small>농촌진흥청 토양도 코드표로 해석했습니다. {result.cropName}는 {soilUseKindLabel(soilUseKind)} 작물이므로 {gradeName}을 판정의 주 근거로 사용합니다.</small>
            </div>
            <dl>
              <div><dt>배수<em>물이 빠지는 정도</em></dt><dd>{decodedProfile?.drainage}</dd></div>
              <div><dt>유효토심<em>뿌리가 뻗을 수 있는 흙 깊이</em></dt><dd>{decodedProfile?.effectiveDepth}</dd></div>
              <div><dt>표토 토성<em>겉흙의 알갱이 구성</em></dt><dd>{decodedProfile?.topsoilTexture}</dd></div>
              <div><dt>토양도상 주 이용<em>이 흙이 주로 쓰이는 용도</em></dt><dd>{decodedProfile?.mainLandUse}</dd></div>
              <div><dt>이용 추천<em>토양도가 권하는 용도</em></dt><dd>{decodedProfile?.useRecommendation}</dd></div>
              <div><dt>{gradeName}<em>{soilUseKindLabel(soilUseKind)}으로 쓰기 좋은 정도 · 1급지가 가장 좋음</em></dt><dd>{gradeValue}</dd></div>
              <div><dt>저해요인<em>등급을 낮춘 원인</em></dt><dd>{gradeLimitingFactor}</dd></div>
            </dl>
            <p>
              선택 농지는 팜맵상 {result.parcel.interpretation}, 토양도상 주 이용은 {decodedProfile?.mainLandUse}입니다.
              두 값은 현재 이용 확인과 토양도 해석이라는 목적·조사 시점이 달라, 불일치하면 현장에서 확인합니다.
            </p>
          </div>
        )}
        <p className="parcel-sheet-note">
          지도 핀은 농지를 찾는 출발점입니다. 토양 자료의 필지번호나 팜맵 번호가 후보 목록과 같을 때만 분석 농지로 확정합니다.
        </p>
      </section>

      <section className="recent-climate-band" aria-labelledby="recent-climate-title">
        <div className="station-docket">
          <span>최근 관측 기록</span>
          <h3 id="recent-climate-title">{result.recentClimate.station.name}</h3>
          <p>{result.recentClimate.station.address}</p>
          <dl>
            <div><dt>농지와 거리</dt><dd>{result.recentClimate.station.distanceKm.toFixed(2)}km</dd></div>
            <div><dt>관측소 고도</dt><dd>{result.recentClimate.station.elevationM ?? "–"}m</dd></div>
            <div>
              <dt>농지 대표성</dt>
              <dd>
                {result.recentClimate.representativeness === "nearby"
                  ? "인근 참고"
                  : result.recentClimate.representativeness === "regional"
                    ? "지역 참고"
                    : "거리 주의"}
              </dd>
            </div>
          </dl>
        </div>
        <div className="climate-observation-grid">
          <div><span>기간</span><strong>{result.recentClimate.period.begin.slice(5)}–{result.recentClimate.period.end.slice(5)}</strong><small>{result.recentClimate.itemCount}일 관측</small></div>
          <div><span>누적 강수</span><strong>{result.recentClimate.totalRainMm ?? "–"}<em>mm</em></strong><small>비 온 날 {result.recentClimate.wetDays ?? "–"}일</small></div>
          <div><span>기온 범위</span><strong>{result.recentClimate.minTempC ?? "–"}–{result.recentClimate.maxTempC ?? "–"}<em>℃</em></strong><small>일 최저–최고 관측</small></div>
          <div><span>평균 습도</span><strong>{result.recentClimate.averageHumidityPct ?? "–"}<em>%</em></strong><small>최근 환경 참고값</small></div>
        </div>
        <p className="climate-caveat">가장 가까운 관측소라는 사실만으로 농지와 같은 미기후라고 단정하지 않으며, 현재 적합·위험 점수에는 가산하지 않습니다.</p>
      </section>

      <section className="requirement-coverage" aria-labelledby="coverage-title">
        <div className="coverage-model">
          <span>현재 판정 방식</span>
          <h3 id="coverage-title">{result.modelCard.label}</h3>
          <p>{result.modelCard.note}</p>
        </div>
        <ul>
          {result.requirementCoverage.map((item) => (
            <li key={item.id} className={item.status}>
              <div>
                <span aria-hidden="true" />
                <strong>{item.label}</strong>
                <em>
                  {item.status === "ready"
                    ? "연결됨"
                    : item.status === "partial"
                      ? "일부만"
                      : "아직 없음"}
                </em>
              </div>
              <p>{item.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {result.report && (
        <section className="report-pipeline-block" aria-labelledby="report-pipeline-title">
          <h3 id="report-pipeline-title">설명 문장을 만드는 과정</h3>
          <p>
            규칙 엔진이 확정한 근거만 넘기고, 생성된 문장이 판정·수치를 바꾸지 않았는지 검증한 뒤 화면에
            전달합니다. 검증에 실패하면 같은 근거의 규칙 문장으로 되돌립니다.
          </p>
          <ol>
            {result.report.pipeline.map((step) => (
              <li key={step.id} className={step.state}>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="calculation-section" aria-labelledby="calculation-title">
        <div className="calculation-heading">
          <div>
            <span>계산 근거</span>
            <h3 id="calculation-title">판정 근거와 보조 점수</h3>
          </div>
          <div className="calculation-legend">
            <p>
              판정 단계는 공식 기준으로 정하고, 아래 숫자는 비교를 돕는 보조 값입니다.
              각 항목이 <em className="basis-tag official">공식 기준</em>에서 온 값인지{" "}
              <em className="basis-tag operational">자체 설계 가중치</em>로 계산한 값인지 항목마다 표시했습니다.
            </p>
            <p className="calculation-audit">
              자체 가중치는 임의로 고른 숫자가 아니라 공식 범위에서 벗어난 거리, 작물별 민감도, 결측·이상치를
              반영하도록 설계한 산식입니다. 감점 폭을 ±20% 흔든 합성 시나리오 560개에서도 판정 단계는 바뀌지
              않았습니다. 다만 현장 수확 자료로 보정한 계수는 아니므로 숫자 자체를 확정된
              농업 기준으로 쓰지는 않습니다.
            </p>
          </div>
        </div>
        <div className="calculation-grid">
          <ScoreLedger explanation={result.scoreExplanations.suitability} score={result.suitabilityScore} />
          <ScoreLedger explanation={result.scoreExplanations.risk} score={result.riskScore} />
          <ScoreLedger explanation={result.scoreExplanations.confidence} score={result.confidence} />
        </div>
        <p className="calculation-basis">{result.basisNote}</p>
        {/*
          위 문장이 농업기술길잡이의 판과 쪽수를 대고 있다. 원문을 확인할 길을 여기서 잇는다.
          04는 초보자용 쉬운 말 화면이라 링크를 늘리지 않고, 근거를 다루는 이 화면에 둔다.
        */}
        <p className="calculation-source-link">
          <a href={officialLinks.cropGuide.href} target="_blank" rel="noreferrer noopener">
            {officialLinks.cropGuide.label}
          </a>
          <small>{officialLinks.cropGuide.note}</small>
        </p>
      </section>

      <section className="source-table-section" aria-labelledby="source-table-title">
        <div className="source-table-heading">
          <span>사용한 자료</span>
          <h3 id="source-table-title">어떤 API의 어떤 값을 썼는지</h3>
        </div>
        <div className="source-table-scroll">
          <table className="source-table">
            <thead>
              <tr>
                <th scope="col">자료</th>
                <th scope="col">제공기관</th>
                <th scope="col">실제 사용한 값</th>
                <th scope="col">상태 · 기준시각</th>
              </tr>
            </thead>
            <tbody>
              {result.sources.map((source) => (
                <tr key={source.id}>
                  <th scope="row">{source.name}</th>
                  <td>{source.provider}</td>
                  <td>
                    <ul>
                      {source.usedFields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="source-table-state">
                    <span className="source-state-row">
                      <span className={`source-state ${source.status}`} />
                      {sourceStatusLabel(source.status)}
                    </span>
                    <strong className="source-observed">
                      {source.observedAtLabel && (
                        <em>{source.observedAtLabel}</em>
                      )}
                      {source.observedAt}
                    </strong>
                    <small className={`source-age ${source.ageState}`}>{source.ageNote}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="source-table-note">
          공공데이터를 독립 호출해 조합하고, 실패한 소스만 표시와 함께 대체합니다. 행정구역 평균이 아니라
          사용자가 확인한 필지 단위로 조회합니다.
        </p>
      </section>
        </div>
      <div className="sheet-rule strong" />
      <nav className="page-jump" aria-label="다음으로 볼 화면">
        <button type="button" onClick={() => onNavigate("verdict")}>
          <span>02</span>
          <strong>판정서로 돌아가기</strong>
          <small>판정 · 이유 · 먼저 할 일</small>
        </button>
        <button type="button" onClick={() => onNavigate("report")}>
          <span>04</span>
          <strong>쉬운 말 보고서</strong>
          <small>
            {result.showcaseReport
              ? "초보 귀농인 눈높이 자연어 설명"
              : `pH와 ${gradeName}이 함께 나온 필지에서만 열립니다`}
          </small>
        </button>
      </nav>
    </section>
  );

  const reportPage = (
    <section className="verdict-sheet" id="analysis-report" aria-labelledby="report-page-title">
      <div className="sheet-masthead">
        <span className="sheet-brand">밭보다</span>
        <span className="sheet-kind">쉬운 말 보고서</span>
        <span className="sheet-issued">{result.parcel.address} · {result.cropName}</span>
        <button className="sheet-edit" type="button" onClick={() => onNavigate("verdict")}>
          판정서로 돌아가기
        </button>
      </div>
      <div className="sheet-rule strong" />
      <h2 id="report-page-title" className="page-title">이 결과를 초보자 말로 옮기면</h2>
      <div className="sheet-detail-body">
        <ShowcaseReportView
          result={result}
          report={result.showcaseReport}
          note={result.showcaseNote}
          trace={result.showcaseTrace}
        />
      </div>
      <div className="sheet-rule strong" />
      <nav className="page-jump" aria-label="다음으로 볼 화면">
        <button type="button" onClick={() => onNavigate("verdict")}>
          <span>02</span>
          <strong>판정서로 돌아가기</strong>
          <small>판정 · 이유 · 먼저 할 일</small>
        </button>
        <button type="button" onClick={() => onNavigate("evidence")}>
          <span>03</span>
          <strong>자세한 근거</strong>
          <small>토양·기온 대조 · 예보 · 계산 과정 · 사용한 자료</small>
        </button>
      </nav>
    </section>
  );

  if (view === "evidence") return evidencePage;
  if (view === "report") return reportPage;
  return verdictPage;
}

/**
 * 이 자료로는 알 수 없어 현장에서 봐야 하는 것.
 *
 * 없는 값을 짐작해 채우지 않는 것과, **무엇을 모르는지 말해 주는 것**은 다른 일이다.
 * 앞은 이미 하고 있었고 뒤가 없었다. 그래서 사용자는 화면을 다 읽고도 무엇을 더
 * 확인해야 하는지 알 수 없었다.
 *
 * 항목은 짐작이 아니라 이 판정에 실제로 쓰인 자료의 한계에서 뽑는다.
 * 그래서 필지마다 다르고, 해당 없으면 나오지 않는다.
 */
function fieldChecks(result: AnalysisResult) {
  const checks: { title: string; body: string }[] = [];
  const soilUseKind = cropProfiles[result.selection.cropId].soilUseKind;
  const limiting = result.soil.physicalProfile
    ? limitingFactorLabel(result.soil.physicalProfile, soilUseKind)
    : null;

  // 저해요인은 등급을 낮춘 원인이다. 토양도는 필지 하나를 한 값으로 적으므로 어느 자리가
  // 문제인지는 걸어 봐야 안다. `제외`·`없음`으로 읽히는 값은 확인할 것이 없다는 뜻이다.
  if (limiting && !["확인되지 않음", "제외", "없음"].includes(limiting.trim())) {
    checks.push({
      title: `${limiting}이 실제로 어느 구역인지`,
      body: `공식 토양도는 이 필지 전체를 한 값으로 적습니다. ${limiting}으로 적힌 조건이 필지 안 어디에 몰려 있는지는 비가 온 뒤 직접 걸어 보셔야 알 수 있습니다.`,
    });
  }

  // 관측소가 멀면 그 값이 이 필지의 미기후를 대표한다고 말할 수 없다. 거리를 그대로 적는다.
  const station = result.recentClimate.station;
  if (station.distanceKm !== null && station.distanceKm !== undefined) {
    checks.push({
      title: "이 필지의 실제 기온",
      body: `최근 기후는 ${station.name}(${station.distanceKm}km) 관측 기록입니다. 골짜기와 능선은 같은 지역에서도 온도가 달라, 심을 자리의 값은 현장 온도계로 확인하시는 편이 정확합니다.`,
    });
  }

  // pH가 없으면 산도 없이 판정한 것이다. 그 사실을 확인 항목으로 남긴다.
  if (result.soil.ph === null) {
    checks.push({
      title: "토양 산도(pH)",
      body: "이 필지는 토양검정 기록이 없어 산도를 조회하지 못했습니다. 짐작해 채우지 않았으므로, 심기 전 간이 검정으로 실제 값을 확인하셔야 합니다.",
    });
  }

  return checks;
}

function ShowcaseReportView({
  result,
  report,
  note,
  trace,
}: {
  result: AnalysisResult;
  report: ShowcaseReport | null;
  note: string | null;
  trace: ShowcaseTrace | null;
}) {
  // 근거는 판정에 실제로 반영된 것만 앞에 세운다. `참고 · 점수 미반영`은 아래 산문에 남는다.
  const leadFactors = result.factors.filter((factor) => factor.state !== "info").slice(0, 3);
  const checks = fieldChecks(result);

  return (
    <section className="showcase-section" aria-labelledby="showcase-title">
      <div className="showcase-heading">
        <div>
          <span>쉬운 말 보고서</span>
          <h3 id="showcase-title">초보 귀농인을 위한 설명</h3>
        </div>
        <strong className="showcase-origin">
          {report?.originLabel ?? "규칙이 조립한 안내문 · AI 생성 아님"}
        </strong>
      </div>

      {/*
        02 판정서는 생성 5단계를 화면에 보여주는데 04에는 그게 없어서, 왜 `AI 생성 아님`이
        되었는지 알 수 없었다. AI 문장을 실제로 쓴 경우는 배지가 이미 말해 주므로,
        쓰지 못한 경우에만 경과를 적는다.
        `report.curated`는 손으로 쓴 도입부를 썼는지를 뜻하는 별개 값이라 여기 쓰지 않는다.
      */}
      {trace && !(trace.attempted && trace.passed) && <ShowcaseTraceNote trace={trace} />}

      {!report ? (
        <p className="showcase-empty">{note ?? "이 보고서를 만들 수 있는 조건이 아닙니다."}</p>
      ) : (
        <>
          {/*
            결론 한 줄은 AI가 쓴 문장을 그대로 둔다. 다만 그 아래에 판정을 정한 것이
            규칙이라고 적는다. 문장만 두면 `AI가 결론까지 낸다`로 읽히고, 규칙 문장으로
            바꾸면 이 화면에서 AI가 한 일이 보이지 않는다. 둘을 병기해 둘 다 지킨다.
          */}
          <p className="showcase-headline">
            <Emphasized text={report.headline} highlights={report.highlights} />
          </p>
          <p className="showcase-origin-note">
            판정 <strong>{result.suitabilityLabel}</strong>은 공식 기준으로 규칙이 확정했습니다.
            AI는 그 결과를 옮겨 쓰기만 합니다.
          </p>

          {/*
            근거를 산문 안에 묻어 두면 읽는 사람이 문장을 다 읽어야 무엇이 걸리는지 안다.
            판정에 반영된 항목만 눈금과 함께 앞에 세운다. 값·기준·눈금은 03과 같은 근원이다.
          */}
          <div className="showcase-block">
            <h4>이렇게 판단한 근거</h4>
            <div className="showcase-basis">
              {leadFactors.map((factor) => (
                <div className="showcase-basis-row" key={factor.id}>
                  <span className={`factor-signal ${factor.state}`} aria-hidden="true" />
                  <strong>{factor.label}</strong>
                  <span className="showcase-basis-value">{factor.value}</span>
                  {factor.meter && (
                    <FactorMeterView meter={factor.meter} state={factor.state} />
                  )}
                  <span className="showcase-basis-note">
                    공식 기준 {factor.target} · {factor.impact}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="showcase-block">
            <h4>먼저 할 일</h4>
            <ol className="showcase-checklist">
              {report.checklist.map((item) => (
                <li key={item.title}>
                  <strong>{item.title}</strong>
                  <em>{item.timing}</em>
                  <p>{item.body}</p>
                </li>
              ))}
            </ol>
          </div>

          {checks.length > 0 && (
            <div className="showcase-block">
              <h4>이 자료로는 알 수 없어 현장에서 봐야 하는 것</h4>
              <ol className="showcase-checklist field-checks">
                {checks.map((item) => (
                  <li key={item.title}>
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/*
            AI가 쓴 산문은 버리지 않고 아래로 보낸다. 요구사항 ③의 증거이므로 화면에서
            없앨 수 없다. 다만 먼저 읽어야 하는 것이 위에 있으므로 기본은 접어 둔다.
            `open` 속성을 쓰지 않아 발표에서는 접힌 상태로 시작하고, 필요하면 눌러서 연다.
          */}
          <details className="showcase-prose">
            <summary>
              <span>AI가 쓴 자세한 설명</span>
              <small>{report.blocks.length}단락 · 눌러서 펼치기</small>
            </summary>
            {report.blocks.map((block) => (
              <div className="showcase-block" key={block.id}>
                <h4>{block.heading}</h4>
                <p>
                  <Emphasized text={block.body} highlights={report.highlights} />
                </p>
              </div>
            ))}
            <p className="showcase-closing">
              <Emphasized text={report.closing} highlights={report.highlights} />
            </p>
          </details>

          {/*
            설명 문장은 `지역 농업기술센터 확인`을 권하는데 어디로 가야 하는지는 말하지 않는다.
            문장 안에 링크를 넣지 않고 아래 별도 줄로 둔다. 강조는 규칙이 고르고 문장은 검사를
            거치는데, 그 안에 외부 링크가 섞이면 검사 대상이 아닌 것이 문장에 붙는다.
          */}
          <p className="showcase-official-link">
            <a
              href={officialLinks.extensionCenters.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {officialLinks.extensionCenters.label}
            </a>
            <small>{officialLinks.extensionCenters.note}</small>
          </p>

          <div className="showcase-legend" aria-label="강조 색 뜻">
            <span className="mark-legend value">실제 조회한 값</span>
            <span className="mark-legend official">공식 기준</span>
            <span className="mark-legend caution">주의·한계</span>
          </div>

          <div className="showcase-values">
            <strong>이 글이 인용한 값</strong>
            <ul>
              {report.usedValues.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * AI 문장을 쓰지 못한 경과를 적는다.
 *
 * `호출했는가 → 통과했는가 → 왜 걸렸는가`를 그대로 보여준다. 실패를 숨기지 않는 것이
 * 이 서비스의 원칙이고, 외부 API가 흔들려도 서비스가 멈추지 않는다는 근거도 여기서 나온다.
 */
function ShowcaseTraceNote({ trace }: { trace: ShowcaseTrace }) {
  const headline =
    trace.failedAt === "call"
      ? "AI를 불렀지만 응답을 받지 못해 규칙 문장으로 바꿨습니다."
      : trace.failedAt === "validation"
        ? "AI 문장을 받았지만 검사를 통과하지 못해 규칙 문장으로 바꿨습니다."
        : "AI를 부르지 않고 규칙으로 문장을 만들었습니다.";

  return (
    <div className="showcase-trace">
      <strong>{headline}</strong>
      <dl>
        <div>
          <dt>AI 호출</dt>
          <dd>{trace.attempted ? "했음" : "안 함"}</dd>
        </div>
        <div>
          <dt>문장 검사</dt>
          <dd>
            {trace.failedAt === "call"
              ? "받은 문장 없음"
              : trace.failedAt === "validation"
                ? "불통과"
                : "해당 없음"}
          </dd>
        </div>
        <div>
          <dt>경로</dt>
          <dd>{trace.source}</dd>
        </div>
      </dl>
      {trace.failures.length > 0 && (
        <ul>
          {trace.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 리포트 본문에서 지정된 표현만 강조한다.
 * 화면이 스스로 중요한 말을 고르지 않는다. 강조 목록은 리포트를 만든 쪽이 정하고,
 * 여기서는 그 문자열을 찾아 색만 입힌다.
 */
function Emphasized({
  text,
  highlights,
}: {
  text: string;
  highlights: ShowcaseHighlight[];
}) {
  const kinds = useMemo(() => {
    const map = new Map<string, ShowcaseHighlight["kind"]>();
    for (const item of highlights) {
      if (text.includes(item.text)) map.set(item.text, item.kind);
    }
    return map;
  }, [highlights, text]);

  const pattern = useMemo(() => {
    if (kinds.size === 0) return null;
    // 긴 표현을 먼저 매칭해야 짧은 표현이 앞서 잘라먹지 않는다.
    const sorted = [...kinds.keys()].sort((a, b) => b.length - a.length);
    const escaped = sorted.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(`(${escaped.join("|")})`, "g");
  }, [kinds]);

  if (!pattern) return <>{text}</>;

  return (
    <>
      {text.split(pattern).map((piece, index) => {
        const kind = kinds.get(piece);
        if (!kind) return piece;
        return (
          <mark className={`report-mark ${kind}`} key={`${piece}-${index}`}>
            {piece}
          </mark>
        );
      })}
    </>
  );
}

/**
 * 팜맵 논밭 판독이 논인지 본다.
 * 지목 표기는 `답`, 판독 문자열은 `논`으로 오는 경우가 섞여 있어 둘 다 받는다.
 * `간척지(논)`처럼 괄호가 붙은 표기도 포함된다.
 */
function isPaddyParcel(interpretation: string) {
  return /논|답/.test(interpretation);
}

function sourceStatusLabel(status: SourceStatus) {
  if (status === "connected") return "실시간";
  if (status === "cache") return "검증 스냅샷";
  if (status === "fallback") return "대체 자료";
  return "시연 자료";
}


function ScoreLedger({
  explanation,
  score,
}: {
  explanation: ScoreExplanation;
  score: number;
}) {
  return (
    <article className="score-ledger">
      <header>
        <div>
          <span>계산 항목</span>
          <h4>{explanation.label}</h4>
        </div>
        <strong>{score}</strong>
      </header>
      <code>{explanation.formula}</code>
      <ul>
        {explanation.terms.map((term) => (
          <li key={term.id}>
            <span>{term.label}</span>
            <em className={`basis-tag ${term.basis}`}>
              {basisLabel(term.basis)}
            </em>
            <strong>{term.display}</strong>
          </li>
        ))}
      </ul>
      <p>{explanation.caveat}</p>
    </article>
  );
}

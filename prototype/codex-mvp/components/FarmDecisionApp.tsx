"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { cropList } from "@/lib/analysis/cropProfiles";
import { baselineEnginePolicy } from "@/lib/analysis/modelPolicy";
import { decodedSoilProfile } from "@/lib/analysis/soilCodes";
import { highlightsFor } from "@/lib/report/highlight";
import type {
  AnalysisResult,
  AnalysisSelection,
  AnalyzeResponse,
  CropId,
  ParcelCandidate,
  ParcelSearch,
  ScoreExplanation,
  ShowcaseHighlight,
  ShowcaseReport,
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
  const [candidateQuery, setCandidateQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("input");
  const [analyzed, setAnalyzed] = useState(false);

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
                onChange={(lat, lng) =>
                  {
                    setSelection((current) => resetParcel({ ...current, lat, lng }));
                    clearParcelSearch();
                  }
                }
              />
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
            <div className="place-shortcuts" aria-label="대표 시연 농지">
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
                  </p>
                  <div className="parcel-candidate-list">
                    {visibleCandidates.map((candidate) => {
                      const selected = selection.parcelId === candidate.parcelId &&
                        selection.farmMapId === candidate.farmMapId;
                      return (
                        <button
                          type="button"
                          key={`${candidate.parcelId}:${candidate.farmMapId}`}
                          aria-pressed={selected}
                          onClick={() => confirmParcel(candidate)}
                        >
                          <span className="candidate-index">{selected ? "확정" : "후보"}</span>
                          <span>
                            <strong>{candidate.address}</strong>
                            <small>{candidate.interpretation} · PNU {candidate.parcelId}</small>
                          </span>
                        </button>
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
  const factor = (id: string) => result.factors.find((item) => item.id === id);
  const uplandFactor = factor("upland-suitability");
  const phFactor = factor("ph");
  const riskTone =
    result.riskLevel === "low" ? "good" : result.riskLevel === "high" ? "bad" : "watch";
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
      <div className="sheet-lead">
        {leadLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>

      {result.warning && <div className="data-warning" role="status">{result.warning}</div>}
      {result.cacheNotice && (
        <div className="cache-notice" role="status">
          <strong>검증 스냅샷 사용</strong>
          <p>{result.cacheNotice}</p>
        </div>
      )}


      <div className="sheet-rule" />
      <div className="sheet-columns">
        <article>
          <span>토양 적성</span>
          <strong className={uplandFactor?.state === "good" ? "good" : "watch"}>
            {uplandFactor?.value ?? "자료 없음"}
          </strong>
          <p>공식 {uplandFactor?.target ?? "1–2급지"} 기준 · {uplandFactor?.impact ?? "확인 필요"}</p>
        </article>
        <article>
          <span>토양 산도</span>
          <strong className={phFactor?.state === "good" ? "good" : "watch"}>
            {phFactor?.value === "자료 없음" ? "자료 없음" : `pH ${phFactor?.value ?? "–"}`}
          </strong>
          <p>{result.cropName} 공식 범위 {phFactor?.target ?? "–"} 기준</p>
        </article>
        <article>
          <span>가까운 {result.selection.horizonDays}일 위험</span>
          <strong className={riskTone}>{result.riskLabel}</strong>
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
              : "pH와 밭 적성등급이 함께 나온 필지에서만 열립니다"}
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
            <div className="factor-row head" aria-hidden="true">
              <span />
              <strong>항목</strong>
              <span className="factor-value">내 농지 값</span>
              <span className="factor-target">공식 기준</span>
              <span className="factor-impact">판단</span>
            </div>
            {result.factors.map((factor) => (
              <div className="factor-row" key={factor.id}>
                <span className={`factor-signal ${factor.state}`} aria-label={factor.state} />
                <strong>{factor.label}</strong>
                <span className="factor-value">{factor.value}</span>
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
                (day.humidity ?? 0) >= baselineEnginePolicy.humidityWatch ? "높은 습도" : null,
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
              <small>농촌진흥청 토양도 코드표로 해석했습니다. 밭 적성등급을 판정의 주 근거로 사용합니다.</small>
            </div>
            <dl>
              <div><dt>배수<em>물이 빠지는 정도</em></dt><dd>{decodedProfile?.drainage}</dd></div>
              <div><dt>유효토심<em>뿌리가 뻗을 수 있는 흙 깊이</em></dt><dd>{decodedProfile?.effectiveDepth}</dd></div>
              <div><dt>표토 토성<em>겉흙의 알갱이 구성</em></dt><dd>{decodedProfile?.topsoilTexture}</dd></div>
              <div><dt>토양도상 주 이용<em>이 흙이 주로 쓰이는 용도</em></dt><dd>{decodedProfile?.mainLandUse}</dd></div>
              <div><dt>이용 추천<em>토양도가 권하는 용도</em></dt><dd>{decodedProfile?.useRecommendation}</dd></div>
              <div><dt>밭 적성등급<em>밭으로 쓰기 좋은 정도 · 1급지가 가장 좋음</em></dt><dd>{decodedProfile?.uplandGrade}</dd></div>
              <div><dt>저해요인<em>등급을 낮춘 원인</em></dt><dd>{decodedProfile?.uplandLimitingFactor}</dd></div>
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
              : "pH와 밭 적성등급이 함께 나온 필지에서만 열립니다"}
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
        <ShowcaseReportView report={result.showcaseReport} note={result.showcaseNote} />
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

function ShowcaseReportView({
  report,
  note,
}: {
  report: ShowcaseReport | null;
  note: string | null;
}) {
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

      {!report ? (
        <p className="showcase-empty">{note ?? "이 보고서를 만들 수 있는 조건이 아닙니다."}</p>
      ) : (
        <>
          <p className="showcase-headline">
            <Emphasized text={report.headline} highlights={report.highlights} />
          </p>

          {report.blocks.map((block) => (
            <div className="showcase-block" key={block.id}>
              <h4>{block.heading}</h4>
              <p>
                <Emphasized text={block.body} highlights={report.highlights} />
              </p>
            </div>
          ))}

          <div className="showcase-block">
            <h4>심기 전에 확인할 일</h4>
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

          <p className="showcase-closing">
            <Emphasized text={report.closing} highlights={report.highlights} />
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

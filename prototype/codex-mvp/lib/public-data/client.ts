import "server-only";
import { XMLParser } from "fast-xml-parser";
import {
  fromFarmMapCoordinates,
  toFarmMapCoordinates,
  toKmaGrid,
} from "@/lib/public-data/geo";
import { drainageCategoryFromProfile } from "@/lib/analysis/soilCodes";
import type {
  AnalysisSelection,
  ParcelBoundary,
  ParcelCandidate,
  ParcelSearch,
  RecentClimateData,
  SoilData,
  SoilPhysicalProfile,
  WeatherData,
  WeatherDay,
} from "@/types/domain";

const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const DATA_BASE = "https://apis.data.go.kr";

type LooseObject = Record<string, unknown>;

/**
 * data.go.kr은 같은 키를 Decoding·Encoding 두 형태로 준다.
 * 요청을 만들 때 `URLSearchParams`가 한 번 인코딩하므로 코드에는 Decoding 형태가 필요하다.
 * Encoding 형태를 넣으면 이중 인코딩이 되어 `등록되지 않은 서비스키(403)`로 조용히 실패한다.
 *
 * Base64 문자에는 `%`가 없으므로 `%`가 있으면 Encoding 형태로 보고 한 번 되돌린다.
 * 어느 쪽을 붙여넣어도 동작하게 해, 다른 PC에서 설정할 때 같은 실수를 반복하지 않게 한다.
 */
function serviceKey() {
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!key) throw new Error("공공데이터 서비스 키가 설정되지 않았습니다.");
  if (!key.includes("%")) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    // 디코딩할 수 없는 형태면 원본을 그대로 쓰고 호출 결과로 판단하게 둔다.
    return key;
  }
}

function isObject(value: unknown): value is LooseObject {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): LooseObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? [value] : [];
}

function text(value: unknown, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function numeric(value: unknown): number | null {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nested(source: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isObject(current)) return undefined;
    return current[key];
  }, source);
}

function apiItems(payload: unknown) {
  const response =
    nested(payload, ["response"]) ?? nested(payload, ["Response"]) ?? payload;
  const body = nested(response, ["body"]) ?? response;
  const header = nested(response, ["header"]);
  const resultCode =
    nested(header, ["resultCode"]) ??
    nested(header, ["result_Code"]) ??
    nested(header, ["Result_Code"]) ??
    nested(response, ["resultCode"]) ??
    nested(response, ["result_Code"]) ??
    nested(response, ["Result_Code"]);
  const resultMessage =
    nested(header, ["resultMsg"]) ??
    nested(header, ["result_Msg"]) ??
    nested(header, ["Result_Msg"]) ??
    nested(response, ["resultMsg"]) ??
    nested(response, ["result_Msg"]) ??
    nested(response, ["Result_Msg"]);

  if (resultCode !== undefined && !["00", "0", "200", "NORMAL_SERVICE"].includes(text(resultCode))) {
    throw new Error(`공공데이터 응답 오류: ${text(resultMessage, text(resultCode))}`);
  }

  const candidates = [
    nested(body, ["items", "item"]),
    nested(body, ["items"]),
    nested(body, ["item"]),
  ];
  for (const candidate of candidates) {
    const items = asArray(candidate);
    if (items.length > 0) return items;
  }
  return [];
}

async function request(path: string, params: Record<string, string | number>) {
  const query = new URLSearchParams({
    serviceKey: serviceKey(),
    type: "json",
    _type: "json",
    dataType: "JSON",
    numOfRows: "1000",
    pageNo: "1",
  });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));

  const response = await fetch(`${DATA_BASE}${path}?${query.toString()}`, {
    headers: { Accept: "application/json, application/xml;q=0.9" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    // 상태 코드만으로는 거부 이유를 알 수 없다. 공공데이터포털은 본문에 사유를 적어 보내므로
    // 앞부분을 함께 실어 화면의 실패 이유에서 바로 확인할 수 있게 한다.
    // 본문에 인증키가 들어갈 일은 없지만, 혹시 섞여도 노출되지 않게 키 문자열은 가린다.
    const detail = (await response.text().catch(() => ""))
      .replace(/\s+/g, " ")
      .replace(serviceKey(), "[키 가림]")
      .trim()
      .slice(0, 300);
    throw new Error(`공공데이터 HTTP ${response.status}${detail ? ` — ${detail}` : ""}`);
  }
  const raw = await response.text();
  if (!raw.trim()) throw new Error("공공데이터 응답이 비어 있습니다.");

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return xmlParser.parse(raw) as unknown;
  }
}

export function hasPublicDataKey() {
  return Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim());
}

export async function fetchFarmMapCandidates(
  selection: AnalysisSelection,
): Promise<ParcelSearch> {
  const { x, y } = toFarmMapCoordinates(selection.lat, selection.lng);
  // 좌표는 필지 중심점이 아닐 수 있어 1km 안의 후보를 한 번에 가져오고,
  // 클라이언트에서 지번 검색으로 실제 농지를 확인한다.
  const radii = [1000] as const;

  for (const radiusM of radii) {
    const payload = await request(
      "/B552895/getFarmmapService/getAreaBasedFarmmapInfo",
      { positionX: x, positionY: y, radius: radiusM },
    );
    const items = apiItems(payload);
    if (items.length === 0) continue;

    const unique = new Map<string, ParcelCandidate>();
    for (const item of items) {
      const addressParts = [item.lglSidoNm, item.lglSggNm, item.lglEmdNm, item.lnm]
        .map((value) => text(value))
        .filter(Boolean);
      const candidate: ParcelCandidate = {
        address: addressParts.join(" ") || "주소 미확인 농지",
        parcelId: text(item.pnuLnmCd, "식별자 없음"),
        farmMapId: text(item.fmapInnb, "팜맵 ID 없음"),
        interpretation: text(item.intprNm ?? item.farmTypeNm, "농지 유형 미확인"),
        observedAt: text(item.vdptYr ?? item.itpinpDe, "조회 시점 기준"),
      };
      unique.set(`${candidate.parcelId}:${candidate.farmMapId}`, candidate);
    }
    const candidates = [...unique.values()];
    return {
      candidates,
      candidateCount: candidates.length,
      radiusM,
      requiresRefinement: candidates.length > 12,
      status: "connected",
      source: "농림축산식품부 팜맵 · 실시간 조회",
      liveFailure: null,
    };
  }

  throw new Error("선택 좌표 반경 1km 안에서 팜맵 필지를 찾지 못했습니다.");
}

/**
 * 확정한 필지의 경계를 팜맵 PNU 기반 상세조회로 가져온다.
 *
 * 요청 파라미터 이름은 `pnuCode`이고, 응답의 `fmapBdcrd`는 EPSG:5179 좌표계의
 * GeoJSON MultiPolygon이다. 둘 다 공식 문서의 항목표에는 없지만 실제 응답에 있다(2026-08-04 실측).
 *
 * 같은 요청에 인접 필지가 함께 오므로 **요청한 PNU와 문자열이 정확히 같은 항목만** 채택한다.
 * PNU는 19자리이고 앞자리에 0이 올 수 있어 숫자로 바꾸지 않는다.
 * 좌표계가 다르거나 형식이 어긋나면 경계를 만들지 않고 null을 돌려준다. 임의로 그리지 않기 위해서다.
 */
export async function fetchParcelBoundary(parcelId: string): Promise<ParcelBoundary | null> {
  const wanted = parcelId.trim();
  if (!wanted) return null;

  const payload = await request("/B552895/getFarmmapService/getPnuBasedFarmmapInfo", {
    pnuCode: wanted,
  });
  const match = apiItems(payload).find((item) => text(item.pnuLnmCd).trim() === wanted);
  if (!match) return null;

  const raw = match.fmapBdcrd;
  let geometry: LooseObject | null = null;
  if (isObject(raw)) geometry = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      geometry = JSON.parse(raw) as LooseObject;
    } catch {
      return null;
    }
  }
  if (!geometry) return null;

  const crs = text(nested(geometry, ["crs", "properties", "name"]));
  if (crs !== "EPSG:5179") return null;

  const type = text(geometry.type);
  if (type !== "MultiPolygon" && type !== "Polygon") return null;

  // Polygon은 링 배열, MultiPolygon은 링 배열의 배열이라 한 겹을 맞춘다.
  const polygons = type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons)) return null;

  const rings: [number, number][][] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) continue;
    for (const ring of polygon) {
      if (!Array.isArray(ring)) continue;
      const points: [number, number][] = [];
      for (const point of ring) {
        if (!Array.isArray(point) || point.length < 2) continue;
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push(fromFarmMapCoordinates(x, y));
      }
      // 점이 셋 미만이면 면이 되지 않는다.
      if (points.length >= 3) rings.push(points);
    }
  }
  if (rings.length === 0) return null;

  return {
    rings,
    parcelId: wanted,
    farmMapId: text(match.fmapInnb) || null,
    sourceCrs: crs,
    observedAt: text(match.vdptYr ?? match.itpinpDe, "판독 시점 미확인"),
  };
}

function drainageFrom(value: unknown): SoilData["drainage"] {
  const raw = text(value).toLowerCase();
  if (["양호", "좋음", "good"].some((token) => raw.includes(token))) return "good";
  if (["보통", "moderate"].some((token) => raw.includes(token))) return "moderate";
  if (["불량", "나쁨", "poor"].some((token) => raw.includes(token))) return "poor";
  return "unknown";
}

function dateLabel(value: unknown) {
  const raw = text(value);
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw || "시점 미확인";
}

export async function fetchSoil(selection: AnalysisSelection): Promise<SoilData> {
  const { x, y } = toFarmMapCoordinates(selection.lat, selection.lng);
  const currentYear = Number(kstParts(new Date()).year);
  const years = [currentYear - 1, currentYear - 2, currentYear - 3];
  let item: LooseObject | undefined;
  let lastError: unknown;

  for (const year of years) {
    try {
      const payload = await request(
        "/B552895/rest/farmmap/getFarmmapSoilAnalysisService/getCoordinateBasedSoilAnalsInfo",
        { positionX: x, positionY: y, years: year },
      );
      item = apiItems(payload)[0];
      if (item) break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!item) {
    const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
    throw new Error(`최근 3개년에서 선택 좌표의 토양분석 값을 찾지 못했습니다.${detail}`);
  }

  const sampledAt = dateLabel(item.stDe ?? item.pickYr ?? item.stdrYear);

  return {
    ph: numeric(item.acidity ?? item.ph ?? item.soilPh),
    organicMatter: numeric(item.ormtCont ?? item.organicMatter ?? item.om),
    electricalConductivity: numeric(item.ecd),
    electricalConductivityUnit: "dS/m",
    electricalConductivityUnitStatus: "official-cross-reference",
    drainage: drainageFrom(item.drainage ?? item.drainageClass),
    year: text(item.pickYr ?? item.stdrYear, "연도 미확인"),
    sampledAt,
    sampleType: text(item.splTynm, "시료 유형 미확인"),
    parcelId: text(item.pnuLnmCd) || null,
    farmMapId: text(item.fmapInnb) || null,
    boundaryAvailable: Boolean(text(item.fmapBdcrd)),
    physicalProfile: null,
    status: "connected",
    source: "농림축산식품부 농경지 토양분석",
    observedAt: sampledAt,
  };
}

/**
 * 토양특성 V3 응답의 용도별 적성등급을 그대로 읽어 담는다.
 *
 * 응답에는 밭·논·과수 등급이 각각 들어 있다(2026-08-04 실측 확인). 어느 등급을 판정에 쓸지는
 * 작물 종류가 정하므로 여기서는 고르지 않고 세 항목을 모두 보관한다.
 */
function physicalProfileFrom(item: LooseObject | undefined): SoilPhysicalProfile | null {
  if (!item) return null;
  const code = (key: string) => text(item[key]) || null;
  return {
    drainageCode: code("Soildra_Cd"),
    effectiveDepthCode: code("Vldsoildep_Cd"),
    erosionCode: code("Erosion_Cd"),
    topsoilTextureCode: code("Surtture_Cd"),
    mainLandUseCode: code("Main_Landuse_Cd"),
    useRecommendationCode: code("Soil_Use_Rec_Cd"),
    uplandGradeCode: code("Pfld_Grd_Cd"),
    uplandLimitingFactorCode: code("Upland_Factor_Cd"),
    orchardGradeCode: code("Fruit_Grd_Cd"),
    orchardLimitingFactorCode: code("Fruit_Factor_Cd"),
    // 논 등급은 지금 판정에 쓰지 않는다. 값만 읽어 두고 화면에서 쓸 때 판단한다.
    paddyGradeCode: code("Rfld_Grd_Cd"),
    paddyLimitingFactorCode: code("Paddy_Factor_Cd"),
  };
}

/** 응답 항목 해석을 테스트에서 직접 대조하기 위한 공개 창구. 네트워크를 타지 않는다. */
export const parseSoilPhysicalProfile = physicalProfileFrom;

/** 한 소스의 실패가 다른 소스를 끌어내리지 않도록 항목 추출을 개별로 감싼다. */
function settledItems(result: PromiseSettledResult<unknown>) {
  if (result.status === "rejected") {
    return {
      items: [] as LooseObject[],
      error: result.reason instanceof Error ? result.reason.message : "알 수 없는 연결 오류",
    };
  }
  try {
    return { items: apiItems(result.value), error: null as string | null };
  } catch (error) {
    return {
      items: [] as LooseObject[],
      error: error instanceof Error ? error.message : "알 수 없는 응답 오류",
    };
  }
}

export async function fetchSoilByParcel(parcelId: string): Promise<SoilData> {
  if (!/^\d{19}$/.test(parcelId)) {
    throw new Error("필지 토양 조회에는 19자리 PNU가 필요합니다.");
  }

  const [chemicalResult, physicalResult] = await Promise.allSettled([
    request("/1390802/SoilEnviron/SoilExam/V2/getSoilExam", { PNU_CD: parcelId }),
    request("/1390802/SoilEnviron/SoilCharac/V3/getSoilCharacter", { PNU_CD: parcelId }),
  ]);
  // 두 API는 서로 독립이다. 한쪽이 `요청 데이터 없음`이어도 다른 쪽 값은 살린다.
  // apiItems는 결과코드가 정상이 아니면 throw하므로 호출마다 따로 감싼다.
  const chemicalItems = settledItems(chemicalResult);
  const physicalItems = settledItems(physicalResult);
  const chemical = chemicalItems.items[0];
  const physical = physicalProfileFrom(physicalItems.items[0]);

  if (!chemical && !physical) {
    const reasons = [chemicalItems.error, physicalItems.error].filter(Boolean);
    throw new Error(`선택 필지의 토양 자료를 찾지 못했습니다.${reasons.length ? ` (${reasons.join(" / ")})` : ""}`);
  }

  const sampledAt = chemical
    ? dateLabel(chemical.Exam_Day ?? chemical.exam_Day)
    : "화학성 시료 없음";
  const sourceParts = [
    chemical ? "토양검정 화학성 V2" : null,
    physical ? "토양특성 V3" : null,
  ].filter(Boolean);

  return {
    ph: chemical ? numeric(chemical.ACID ?? chemical.acid) : null,
    organicMatter: chemical ? numeric(chemical.OM ?? chemical.om) : null,
    electricalConductivity: chemical ? numeric(chemical.ELCD ?? chemical.elcd) : null,
    electricalConductivityUnit: "dS/m",
    electricalConductivityUnitStatus: "official-cross-reference",
    drainage: drainageCategoryFromProfile(physical),
    year: chemical ? text(chemical.Any_Year ?? chemical.any_Year, "연도 미확인") : "화학성 시료 없음",
    sampledAt,
    // 검정유형 코드는 공식 코드표를 확인하지 못해 숫자를 화면에 노출하지 않는다.
    sampleType: chemical
      ? "토양검정 기록"
      : "화학성 시료 없음",
    parcelId,
    farmMapId: null,
    boundaryAvailable: false,
    physicalProfile: physical,
    status: "connected",
    source: `농촌진흥청 ${sourceParts.join(" + ")}`,
    observedAt: sampledAt,
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (degree: number) => (degree * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let stationCache: Promise<LooseObject[]> | null = null;

async function weatherStations() {
  stationCache ??= request("/1390802/AgriWeather/getObsrSpotList", {
    Page_No: 1,
    Page_Size: 1000,
  }).then(apiItems).catch((error) => {
    stationCache = null;
    throw error;
  });
  return stationCache;
}

function isoDateKst(date: Date) {
  const parts = kstParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export async function fetchRecentClimate(
  selection: AnalysisSelection,
): Promise<RecentClimateData> {
  const stations = (await weatherStations()).flatMap((item) => {
    const lat = numeric(item.Instl_La ?? item.instl_La);
    const lng = numeric(item.Instl_Lo ?? item.instl_Lo);
    const code = text(item.Obsr_Spot_Code ?? item.obsr_Spot_Cd);
    if (lat === null || lng === null || !code) return [];
    return [{
      item,
      code,
      distanceKm: haversineKm(selection.lat, selection.lng, lat, lng),
    }];
  }).sort((a, b) => a.distanceKm - b.distanceKm);
  const nearest = stations[0];
  if (!nearest) throw new Error("좌표가 있는 농업기상 관측지점을 찾지 못했습니다.");

  const endDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const beginDate = new Date(endDate.getTime() - 6 * 24 * 60 * 60 * 1000);
  const period = { begin: isoDateKst(beginDate), end: isoDateKst(endDate) };
  const payload = await request(
    "/1390802/AgriWeather/WeatherObsrInfo/V3/GnrlWeather/getWeatherTermDayList3",
    {
      Page_No: 1,
      Page_Size: 20,
      begin_Date: period.begin,
      end_Date: period.end,
      obsr_Spot_Cd: nearest.code,
    },
  );
  const items = apiItems(payload);
  if (items.length === 0) throw new Error("최근 7일 농업기상 관측값이 비어 있습니다.");
  const values = (key: string) => items.flatMap((item) => {
    const value = numeric(item[key]);
    return value === null ? [] : [value];
  });
  const rain = values("rn");
  const humidity = values("hum");
  const minimums = values("lowst_Artmp");
  const maximums = values("hghst_Artmp");
  const rounded = (value: number) => Number(value.toFixed(1));
  const representativeness = nearest.distanceKm <= 10
    ? "nearby"
    : nearest.distanceKm <= 25
      ? "regional"
      : "weak";

  return {
    station: {
      code: nearest.code,
      name: text(nearest.item.Obsr_Spot_Nm ?? nearest.item.obsr_Spot_Nm, "관측소명 미확인"),
      distanceKm: Number(nearest.distanceKm.toFixed(2)),
      elevationM: numeric(nearest.item.Instl_Al ?? nearest.item.instl_Al),
      address: text(nearest.item.Instl_Adres ?? nearest.item.instl_Adres, "주소 미확인"),
      observedSince: text(nearest.item.Obsr_Begin_Datetm ?? nearest.item.obsr_Begin_Datetm, "관측 시작일 미확인"),
    },
    period,
    itemCount: items.length,
    totalRainMm: rain.length ? rounded(rain.reduce((sum, value) => sum + value, 0)) : null,
    wetDays: rain.length ? rain.filter((value) => value > 0).length : null,
    minTempC: minimums.length ? Math.min(...minimums) : null,
    maxTempC: maximums.length ? Math.max(...maximums) : null,
    averageHumidityPct: humidity.length
      ? rounded(humidity.reduce((sum, value) => sum + value, 0) / humidity.length)
      : null,
    representativeness,
    status: "connected",
    source: "농촌진흥청 농업기상 기본 관측데이터",
    observedAt: `${period.begin}–${period.end}`,
  };
}

function kstParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function latestKmaBase(now = new Date()) {
  const safeNow = new Date(now.getTime() - 20 * 60 * 1000);
  const parts = kstParts(safeNow);
  const hour = Number(parts.hour);
  const releases = [2, 5, 8, 11, 14, 17, 20, 23];
  let release = [...releases].reverse().find((value) => value <= hour);
  let date = `${parts.year}${parts.month}${parts.day}`;
  if (release === undefined) {
    const previous = new Date(safeNow.getTime() - 24 * 60 * 60 * 1000);
    const previousParts = kstParts(previous);
    date = `${previousParts.year}${previousParts.month}${previousParts.day}`;
    release = 23;
  }
  return { baseDate: date, baseTime: `${String(release).padStart(2, "0")}00` };
}

function parsePrecipitation(value: unknown) {
  const raw = text(value);
  if (!raw || raw.includes("강수없음")) return 0;
  return numeric(raw);
}

function skyLabel(value: unknown) {
  const code = text(value);
  if (code === "1") return "맑음";
  if (code === "3") return "구름 많음";
  if (code === "4") return "흐림";
  return "미확인";
}

function precipitationTypeLabel(value: unknown) {
  const code = text(value);
  if (code === "0") return "없음";
  if (code === "1") return "비";
  if (code === "2") return "비/눈";
  if (code === "3") return "눈";
  if (code === "4") return "소나기";
  return "미확인";
}

export async function fetchWeather(selection: AnalysisSelection): Promise<WeatherData> {
  const { nx, ny } = toKmaGrid(selection.lat, selection.lng);
  const { baseDate, baseTime } = latestKmaBase();
  const payload = await request(
    "/1360000/VilageFcstInfoService_2.0/getVilageFcst",
    { base_date: baseDate, base_time: baseTime, nx, ny },
  );
  const items = apiItems(payload);
  if (items.length === 0) throw new Error("기상청 단기예보 값이 비어 있습니다.");

  const byDate = new Map<string, Map<string, number[] | string[]>>();
  for (const item of items) {
    const date = text(item.fcstDate);
    const category = text(item.category);
    const value = item.fcstValue;
    if (!date || !category) continue;
    if (!byDate.has(date)) byDate.set(date, new Map());
    const daily = byDate.get(date)!;
    const existing = daily.get(category) ?? [];
    if (["TMP", "TMN", "TMX", "POP", "REH", "WSD"].includes(category)) {
      const number = numeric(value);
      if (number !== null) daily.set(category, [...existing, number] as number[]);
    } else {
      daily.set(category, [...existing, text(value)] as string[]);
    }
  }

  const dates = [...byDate.keys()].sort().slice(0, selection.horizonDays);
  const labels = ["오늘", "내일", "모레"];
  const days: WeatherDay[] = dates.map((date, index) => {
    const daily = byDate.get(date)!;
    const values = (key: string) => (daily.get(key) ?? []) as number[];
    const strings = (key: string) => (daily.get(key) ?? []) as string[];
    const temperatures = values("TMP");
    const minValues = values("TMN");
    const maxValues = values("TMX");
    const rain = values("POP");
    const humidity = values("REH");
    const windSpeed = values("WSD");
    const precipitation = strings("PCP").map(parsePrecipitation).filter((v): v is number => v !== null);
    const precipitationTypes = strings("PTY");
    return {
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      label: labels[index] ?? `${index + 1}일차`,
      minTemp: minValues[0] ?? (temperatures.length ? Math.min(...temperatures) : null),
      maxTemp: maxValues[0] ?? (temperatures.length ? Math.max(...temperatures) : null),
      rainProbability: rain.length ? Math.max(...rain) : null,
      precipitation: precipitation.length ? Math.max(...precipitation) : null,
      precipitationType: precipitationTypeLabel(precipitationTypes.find((value) => value !== "0") ?? precipitationTypes[0]),
      humidity: humidity.length ? Math.max(...humidity) : null,
      // 최고 습도만 보여주면 늘 90~100%로 찍혀 값이 무의미해진다. 평균을 함께 넘긴다.
      humidityAverage: humidity.length
        ? Math.round(humidity.reduce((sum, value) => sum + value, 0) / humidity.length)
        : null,
      maxWindSpeed: windSpeed.length ? Math.max(...windSpeed) : null,
      sky: skyLabel(strings("SKY")[0]),
    };
  });

  return {
    issuedAt: `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6, 8)} ${baseTime.slice(0, 2)}:${baseTime.slice(2)} KST`,
    status: "connected",
    source: "기상청 단기예보",
    days,
  };
}

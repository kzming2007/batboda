import { XMLParser } from "fast-xml-parser";
import proj4 from "proj4";

// Encoding 형태 키를 넣어도 동작하게 한 번 되돌린다. 앱의 serviceKey()와 같은 규칙이다.
const RAW_SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
const SERVICE_KEY = RAW_SERVICE_KEY?.includes("%")
  ? (() => { try { return decodeURIComponent(RAW_SERVICE_KEY); } catch { return RAW_SERVICE_KEY; } })()
  : RAW_SERVICE_KEY;
if (!SERVICE_KEY) {
  throw new Error("DATA_GO_KR_SERVICE_KEY is not configured.");
}

const DATA_BASE = "https://apis.data.go.kr";
const DEMO = {
  lat: 37.675,
  lng: 128.718,
  addressNeedle: "279-15",
};

const xmlParser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
const sourceCrs = "+proj=longlat +datum=WGS84 +no_defs";
const farmMapCrs =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? [value] : [];
}

function nested(source, path) {
  return path.reduce((current, key) => {
    if (!isObject(current)) return undefined;
    return current[key];
  }, source);
}

function text(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function numeric(value) {
  const parsed = Number(text(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function maskPnu(value) {
  const raw = text(value);
  return raw.length >= 8 ? `${raw.slice(0, 8)}…${raw.slice(-4)}` : raw || null;
}

function responseParts(payload) {
  const response = nested(payload, ["response"]) ?? nested(payload, ["Response"]) ?? payload;
  const header = nested(response, ["header"]) ?? {};
  const body = nested(response, ["body"]) ?? response;
  const resultCode =
    nested(header, ["resultCode"]) ??
    nested(header, ["result_Code"]) ??
    nested(header, ["Result_Code"]) ??
    nested(response, ["resultCode"]) ??
    nested(response, ["Result_Code"]);
  const resultMessage =
    nested(header, ["resultMsg"]) ??
    nested(header, ["result_Msg"]) ??
    nested(header, ["Result_Msg"]) ??
    nested(response, ["resultMsg"]) ??
    nested(response, ["Result_Msg"]);

  if (
    resultCode !== undefined &&
    !["00", "0", "200", "NORMAL_SERVICE"].includes(text(resultCode))
  ) {
    throw new Error(`공공데이터 응답 오류 ${text(resultCode)}: ${text(resultMessage, "메시지 없음")}`);
  }

  const itemCandidates = [
    nested(body, ["items", "item"]),
    nested(body, ["items"]),
    nested(body, ["item"]),
  ];
  const items = itemCandidates.map(asArray).find((value) => value.length > 0) ?? [];
  const totalCount =
    numeric(nested(body, ["totalCount"])) ??
    numeric(nested(body, ["total_Count"])) ??
    numeric(nested(body, ["Total_Count"])) ??
    items.length;

  return {
    resultCode: resultCode === undefined ? null : text(resultCode),
    resultMessage: resultMessage === undefined ? null : text(resultMessage),
    totalCount,
    items,
  };
}

async function request(path, params) {
  const query = new URLSearchParams({
    serviceKey: SERVICE_KEY,
    type: "json",
    _type: "json",
    dataType: "JSON",
    numOfRows: "1000",
    pageNo: "1",
  });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const response = await fetch(`${DATA_BASE}${path}?${query.toString()}`, {
    headers: { Accept: "application/xml, application/json;q=0.8" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`공공데이터 HTTP ${response.status}`);
  const raw = await response.text();
  if (!raw.trim()) throw new Error("공공데이터 응답이 비어 있습니다.");
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = xmlParser.parse(raw);
  }
  return responseParts(payload);
}

function toFarmPoint(lat, lng) {
  const [x, y] = proj4(sourceCrs, farmMapCrs, [lng, lat]);
  return { x: Math.round(x), y: Math.round(y) };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const radians = (degree) => (degree * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isoDateKst(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function recentObservedPeriod(now = new Date()) {
  const end = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const begin = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  return { begin: isoDateKst(begin), end: isoDateKst(end) };
}

function selectFields(item, names) {
  return Object.fromEntries(names.map((name) => [name, item?.[name] ?? null]));
}

const farmPoint = toFarmPoint(DEMO.lat, DEMO.lng);
const farm = await request("/B552895/getFarmmapService/getAreaBasedFarmmapInfo", {
  positionX: farmPoint.x,
  positionY: farmPoint.y,
  radius: 1000,
});
const target = farm.items.find((item) => text(item.lnm).includes(DEMO.addressNeedle));
if (!target) {
  throw new Error(`반경 1km 후보에서 ${DEMO.addressNeedle} 농지를 찾지 못했습니다.`);
}

const targetPnu = text(target.pnuLnmCd);
if (!/^\d{19}$/.test(targetPnu)) {
  throw new Error("대표 농지의 19자리 PNU를 확인하지 못했습니다.");
}

const [soilV3, stationList] = await Promise.all([
  request("/1390802/SoilEnviron/SoilCharac/V3/getSoilCharacter", {
    PNU_CD: targetPnu,
  }),
  request("/1390802/AgriWeather/getObsrSpotList", {
    Page_No: 1,
    Page_Size: 1000,
  }),
]);

const stations = stationList.items
  .map((item) => {
    const lat = numeric(item.Instl_La ?? item.instl_La);
    const lng = numeric(item.Instl_Lo ?? item.instl_Lo);
    if (lat === null || lng === null) return null;
    return {
      raw: item,
      lat,
      lng,
      distanceKm: haversineKm(DEMO.lat, DEMO.lng, lat, lng),
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.distanceKm - b.distanceKm);

const nearest = stations[0];
if (!nearest) throw new Error("좌표가 있는 농업기상 관측지점을 찾지 못했습니다.");
const stationCode = text(nearest.raw.Obsr_Spot_Code ?? nearest.raw.obsr_Spot_Cd);
if (!stationCode) throw new Error("최근접 농업기상 관측지점 코드를 찾지 못했습니다.");

const period = recentObservedPeriod();
const recentWeather = await request(
  "/1390802/AgriWeather/WeatherObsrInfo/V3/GnrlWeather/getWeatherTermDayList3",
  {
    Page_No: 1,
    Page_Size: 20,
    begin_Date: period.begin,
    end_Date: period.end,
    obsr_Spot_Cd: stationCode,
  },
);

const rainValues = recentWeather.items.map((item) => numeric(item.rn)).filter((v) => v !== null);
const humidityValues = recentWeather.items.map((item) => numeric(item.hum)).filter((v) => v !== null);
const minValues = recentWeather.items.map((item) => numeric(item.lowst_Artmp)).filter((v) => v !== null);
const maxValues = recentWeather.items.map((item) => numeric(item.hghst_Artmp)).filter((v) => v !== null);

const soilSample = soilV3.items[0] ?? {};
const recentSample = recentWeather.items[0] ?? {};

console.log(JSON.stringify({
  auditedAt: new Date().toISOString(),
  demo: { lat: DEMO.lat, lng: DEMO.lng, address: text(target.lnm), pnu: maskPnu(targetPnu) },
  farm: {
    resultCode: farm.resultCode,
    candidateCount: farm.totalCount,
    selectedFarmMapId: text(target.fmapInnb) || null,
  },
  soilV3: {
    resultCode: soilV3.resultCode,
    itemCount: soilV3.items.length,
    fields: selectFields(soilSample, [
      "Soildra_Cd",
      "Vldsoildep_Cd",
      "Erosion_Cd",
      "Surtture_Cd",
      "Main_Landuse_Cd",
      "Soil_Use_Rec_Cd",
      "Pfld_Grd_Cd",
      "Upland_Factor_Cd",
      "Fruit_Grd_Cd",
      "Fruit_Factor_Cd",
    ]),
  },
  station: {
    resultCode: stationList.resultCode,
    returned: stationList.items.length,
    totalCount: stationList.totalCount,
    nearest: {
      name: text(nearest.raw.Obsr_Spot_Nm ?? nearest.raw.obsr_Spot_Nm),
      code: stationCode,
      distanceKm: Number(nearest.distanceKm.toFixed(2)),
      elevationM: numeric(nearest.raw.Instl_Al ?? nearest.raw.instl_Al),
      address: text(nearest.raw.Instl_Adres ?? nearest.raw.instl_Adres),
      observedSince: text(nearest.raw.Obsr_Begin_Datetm ?? nearest.raw.obsr_Begin_Datetm),
    },
  },
  recentWeather: {
    resultCode: recentWeather.resultCode,
    period,
    itemCount: recentWeather.items.length,
    fieldNames: Object.keys(recentSample).sort(),
    summary: {
      totalRainMm: rainValues.length ? Number(rainValues.reduce((sum, value) => sum + value, 0).toFixed(1)) : null,
      wetDays: rainValues.filter((value) => value > 0).length,
      minTempC: minValues.length ? Math.min(...minValues) : null,
      maxTempC: maxValues.length ? Math.max(...maxValues) : null,
      averageHumidityPct: humidityValues.length
        ? Number((humidityValues.reduce((sum, value) => sum + value, 0) / humidityValues.length).toFixed(1))
        : null,
    },
  },
}, null, 2));

import { XMLParser } from "fast-xml-parser";
import proj4 from "proj4";

const SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
if (!SERVICE_KEY) {
  throw new Error("DATA_GO_KR_SERVICE_KEY is not configured.");
}

const TEST_POINT = { name: "평창 대관령 시연 좌표", lat: 37.675, lng: 128.718 };
const parser = new XMLParser({ ignoreAttributes: false });
const EPSG_5179 =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
proj4.defs("EPSG:5179", EPSG_5179);

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function nested(source, path) {
  return path.reduce((current, key) => (isObject(current) ? current[key] : undefined), source);
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? [value] : [];
}

function parsePayload(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return parser.parse(raw);
  }
}

function extract(payload) {
  const header =
    nested(payload, ["response", "header"]) ??
    nested(payload, ["Response", "header"]) ??
    {};
  const body =
    nested(payload, ["response", "body"]) ??
    nested(payload, ["Response", "body"]) ??
    nested(payload, ["body"]) ??
    {};
  const candidates = [
    nested(body, ["items", "item"]),
    nested(body, ["items"]),
    nested(body, ["item"]),
  ];
  const items = candidates.map(asArray).find((value) => value.length > 0) ?? [];
  return { header, body, items };
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
  const response = await fetch(`https://apis.data.go.kr${path}?${query.toString()}`, {
    headers: { Accept: "application/json, application/xml;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  if (!raw.trim()) throw new Error(`Empty response (HTTP ${response.status})`);
  const payload = parsePayload(raw);
  const extracted = extract(payload);
  return { httpStatus: response.status, ...extracted };
}

function maskPnu(value) {
  const raw = String(value ?? "");
  if (raw.length < 12) return raw || null;
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

function select(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function toFarmPoint(lat, lng) {
  const [x, y] = proj4("EPSG:4326", "EPSG:5179", [lng, lat]);
  return { x: Math.round(x), y: Math.round(y) };
}

function toKmaGrid(lat, lng) {
  const RE = 6371.00877;
  const GRID = 5.0;
  const DEGRAD = Math.PI / 180.0;
  const re = RE / GRID;
  const slat1 = 30.0 * DEGRAD;
  const slat2 = 60.0 * DEGRAD;
  const olon = 126.0 * DEGRAD;
  const olat = 38.0 * DEGRAD;
  let sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5));
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * DEGRAD * 0.5);
  ra = (re * sf) / Math.pow(ra, sn);
  let theta = lng * DEGRAD - olon;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5),
  };
}

function kstParts(date) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
}

function latestKmaBase(now = new Date()) {
  const safe = new Date(now.getTime() - 20 * 60 * 1000);
  const parts = kstParts(safe);
  const releases = [2, 5, 8, 11, 14, 17, 20, 23];
  let release = [...releases].reverse().find((value) => value <= Number(parts.hour));
  let date = `${parts.year}${parts.month}${parts.day}`;
  if (release === undefined) {
    const previous = kstParts(new Date(safe.getTime() - 24 * 60 * 60 * 1000));
    date = `${previous.year}${previous.month}${previous.day}`;
    release = 23;
  }
  return { base_date: date, base_time: `${String(release).padStart(2, "0")}00` };
}

function tilePoint(lat, lng, zoom) {
  const scale = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * scale);
  const radians = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
  );
  return { x, y, zoom };
}

async function auditTileHost(host) {
  const tile = tilePoint(TEST_POINT.lat, TEST_POINT.lng, 13);
  const response = await fetch(`https://${host}/${tile.zoom}/${tile.x}/${tile.y}.png`, {
    headers: { "User-Agent": "Batboda-MVP-Hackathon-Prototype/0.1" },
    signal: AbortSignal.timeout(10_000),
  });
  return {
    host,
    httpStatus: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
  };
}

const farmPoint = toFarmPoint(TEST_POINT.lat, TEST_POINT.lng);
const currentKstYear = Number(kstParts(new Date()).year);
const soilAuditYear = Number(process.env.SOIL_AUDIT_YEAR ?? currentKstYear - 1);
const farm = await request("/B552895/getFarmmapService/getAreaBasedFarmmapInfo", {
  positionX: farmPoint.x,
  positionY: farmPoint.y,
  radius: 250,
});
const farmSample = farm.items[0] ?? {};

const soil = await request(
  "/B552895/rest/farmmap/getFarmmapSoilAnalysisService/getCoordinateBasedSoilAnalsInfo",
  { positionX: farmPoint.x, positionY: farmPoint.y, years: soilAuditYear },
);
const soilSample = soil.items[0] ?? {};

const grid = toKmaGrid(TEST_POINT.lat, TEST_POINT.lng);
const weatherBase = latestKmaBase();
const weather = await request("/1360000/VilageFcstInfoService_2.0/getVilageFcst", {
  ...weatherBase,
  ...grid,
});
const categories = [...new Set(weather.items.map((item) => String(item.category ?? "")).filter(Boolean))].sort();
const forecastDates = weather.items.map((item) => String(item.fcstDate ?? "")).filter(Boolean).sort();

const tileAudits = [];
for (const host of ["tile.openstreetmap.org", "a.tile.openstreetmap.org"]) {
  try {
    tileAudits.push(await auditTileHost(host));
  } catch (error) {
    tileAudits.push({ host, error: error instanceof Error ? error.message : String(error) });
  }
}

const report = {
  auditedAt: new Date().toISOString(),
  testPoint: TEST_POINT,
  keyExposed: false,
  farmMap: {
    httpStatus: farm.httpStatus,
    resultCode: farm.header.resultCode ?? null,
    resultMessage: farm.header.resultMsg ?? null,
    itemCount: farm.items.length,
    fieldNames: Object.keys(farmSample).sort(),
    sample: {
      ...select(farmSample, [
        "fmapInnb",
        "vdptYr",
        "lglEmdCd",
        "lglEmdNm",
        "chgCfnm",
        "lnm",
        "intprCd",
        "intprNm",
        "invdCfnm",
        "itpinpDe",
        "rnhstNm",
        "mapdmcNo",
      ]),
      pnuLnmCd: maskPnu(farmSample.pnuLnmCd),
    },
  },
  soil: {
    requestedYear: soilAuditYear,
    httpStatus: soil.httpStatus,
    resultCode: soil.header.resultCode ?? null,
    resultMessage: soil.header.resultMsg ?? null,
    itemCount: soil.items.length,
    fieldNames: Object.keys(soilSample).sort(),
    sample: {
      ...select(soilSample, [
        "pickYr",
        "stDe",
        "intprNm",
        "splTynm",
        "acidity",
        "ormtCont",
        "vdphdy",
        "vdsidy",
        "ecd",
        "lreq",
        "nntcy",
        "nh3ntcy",
        "bsbcy",
        "rlfzKlusq",
        "rlfzLmusq",
        "rlfzMgusq",
      ]),
      pnuLnmCd: maskPnu(soilSample.pnuLnmCd),
    },
  },
  weather: {
    httpStatus: weather.httpStatus,
    resultCode: weather.header.resultCode ?? null,
    resultMessage: weather.header.resultMsg ?? null,
    itemCount: weather.items.length,
    grid,
    base: weatherBase,
    categories,
    forecastDateRange:
      forecastDates.length > 0
        ? { from: forecastDates[0], to: forecastDates[forecastDates.length - 1] }
        : null,
    fieldNames: Object.keys(weather.items[0] ?? {}).sort(),
  },
  mapTiles: tileAudits,
};

console.log(JSON.stringify(report, null, 2));

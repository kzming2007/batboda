import { XMLParser } from "fast-xml-parser";
import proj4 from "proj4";

const SERVICE_KEY = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
if (!SERVICE_KEY) {
  throw new Error("DATA_GO_KR_SERVICE_KEY is not configured.");
}

const CANDIDATES = [
  { name: "평창 대관령", crop: "감자", lat: 37.675, lng: 128.718 },
  { name: "경북 영주", crop: "사과", lat: 36.872, lng: 128.74 },
  { name: "경기 이천", crop: "상추", lat: 37.265, lng: 127.198 },
];

const parser = new XMLParser({ ignoreAttributes: false });
const EPSG_5179 =
  "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
proj4.defs("EPSG:5179", EPSG_5179);

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function nested(source, path) {
  return path.reduce(
    (current, key) => (isObject(current) ? current[key] : undefined),
    source,
  );
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
  return { header, items };
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
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }

  const response = await fetch(`https://apis.data.go.kr${path}?${query.toString()}`, {
    headers: { Accept: "application/json, application/xml;q=0.9" },
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!raw.trim()) throw new Error(`Empty response (HTTP ${response.status})`);
  return { httpStatus: response.status, ...extract(parsePayload(raw)) };
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
  let sn =
    Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(
      Math.tan(Math.PI * 0.25 + slat2 * 0.5) /
        Math.tan(Math.PI * 0.25 + slat1 * 0.5),
    );
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
  let release = [...releases]
    .reverse()
    .find((value) => value <= Number(parts.hour));
  let date = `${parts.year}${parts.month}${parts.day}`;
  if (release === undefined) {
    const previous = kstParts(new Date(safe.getTime() - 24 * 60 * 60 * 1000));
    date = `${previous.year}${previous.month}${previous.day}`;
    release = 23;
  }
  return { base_date: date, base_time: `${String(release).padStart(2, "0")}00` };
}

function maskPnu(value) {
  const raw = String(value ?? "");
  if (raw.length < 12) return raw || null;
  return `${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

function safeError(error) {
  if (!(error instanceof Error)) return String(error);
  return error.message.replace(/serviceKey=[^&\s]+/gi, "serviceKey=[redacted]");
}

async function auditCandidate(candidate) {
  const point = toFarmPoint(candidate.lat, candidate.lng);
  const grid = toKmaGrid(candidate.lat, candidate.lng);
  const weatherBase = latestKmaBase();
  const requests = await Promise.allSettled([
    request("/B552895/getFarmmapService/getAreaBasedFarmmapInfo", {
      positionX: point.x,
      positionY: point.y,
      radius: 250,
    }),
    request(
      "/B552895/rest/farmmap/getFarmmapSoilAnalysisService/getCoordinateBasedSoilAnalsInfo",
      { positionX: point.x, positionY: point.y },
    ),
    request("/1360000/VilageFcstInfoService_2.0/getVilageFcst", {
      ...weatherBase,
      ...grid,
    }),
  ]);

  const [farmResult, soilResult, weatherResult] = requests;
  const farm = farmResult.status === "fulfilled" ? farmResult.value : null;
  const soil = soilResult.status === "fulfilled" ? soilResult.value : null;
  const weather = weatherResult.status === "fulfilled" ? weatherResult.value : null;
  const soilSample = soil?.items[0] ?? {};
  const soilPnu = String(soilSample.pnuLnmCd ?? "");
  const soilFarmMapId = String(soilSample.fmapInnb ?? soilSample.mapdmcNo ?? "");
  const matchedFarm = farm?.items.find((item) => {
    const pnuMatch = soilPnu && String(item.pnuLnmCd ?? "") === soilPnu;
    const farmMapMatch =
      soilFarmMapId &&
      [item.fmapInnb, item.mapdmcNo]
        .filter((value) => value !== undefined)
        .some((value) => String(value) === soilFarmMapId);
    return pnuMatch || farmMapMatch;
  });
  const forecastDates =
    weather?.items
      .map((item) => String(item.fcstDate ?? ""))
      .filter(Boolean)
      .sort() ?? [];

  return {
    ...candidate,
    keyExposed: false,
    farmMap: farm
      ? {
          ok: true,
          itemCount: farm.items.length,
          resultCode: farm.header.resultCode ?? null,
          matchedBySoilIdentity: Boolean(matchedFarm),
          matchedParcel: matchedFarm
            ? {
                address: [matchedFarm.lglEmdNm, matchedFarm.lnm]
                  .filter(Boolean)
                  .join(" "),
                landType: matchedFarm.invdCfnm ?? matchedFarm.intprNm ?? null,
                pnu: maskPnu(matchedFarm.pnuLnmCd),
              }
            : null,
        }
      : { ok: false, error: safeError(farmResult.reason) },
    soil: soil
      ? {
          ok: true,
          itemCount: soil.items.length,
          resultCode: soil.header.resultCode ?? null,
          sample: {
            pnu: maskPnu(soilSample.pnuLnmCd),
            year: soilSample.pickYr ?? null,
            sampledAt: soilSample.stDe ?? null,
            landUse: soilSample.intprNm ?? null,
            sampleType: soilSample.splTynm ?? null,
            ph: soilSample.acidity ?? null,
            organicMatter: soilSample.ormtCont ?? null,
            hasBoundary: Boolean(
              soilSample.fmapBdcrd ??
                soilSample.bndryGml ??
                soilSample.gml ??
                soilSample.geometry,
            ),
          },
        }
      : { ok: false, error: safeError(soilResult.reason) },
    weather: weather
      ? {
          ok: true,
          itemCount: weather.items.length,
          resultCode: weather.header.resultCode ?? null,
          grid,
          base: weatherBase,
          categories: [
            ...new Set(
              weather.items
                .map((item) => String(item.category ?? ""))
                .filter(Boolean),
            ),
          ].sort(),
          forecastDateRange:
            forecastDates.length > 0
              ? { from: forecastDates[0], to: forecastDates.at(-1) }
              : null,
        }
      : { ok: false, error: safeError(weatherResult.reason) },
  };
}

const candidates = [];
for (const candidate of CANDIDATES) {
  candidates.push(await auditCandidate(candidate));
}

console.log(
  JSON.stringify(
    {
      auditedAt: new Date().toISOString(),
      keyExposed: false,
      candidates,
    },
    null,
    2,
  ),
);

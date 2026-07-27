import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  fetchFarmMapCandidates,
  fetchRecentClimate,
  fetchSoilByParcel,
  fetchWeather,
  hasPublicDataKey,
} from "@/lib/public-data/client";
import { selectionFromSearch } from "@/lib/public-data/request";

/**
 * 검증 스냅샷 수집용 개발 전용 경로다.
 * 실시간 응답을 그대로 `lib/cache/snapshots/verified.json`에 저장하고 수집시각을 함께 기록한다.
 * 값을 사람이 손으로 만들지 않기 위한 경로이므로 운영 빌드에서는 동작하지 않는다.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "검증 스냅샷 수집은 개발 환경에서만 실행합니다." },
      { status: 403 },
    );
  }
  if (!hasPublicDataKey()) {
    return NextResponse.json(
      { ok: false, error: "공공데이터 인증키가 설정되지 않았습니다." },
      { status: 400 },
    );
  }

  try {
    const params = new URL(request.url).searchParams;
    const selection = selectionFromSearch(params);
    const parcelId = params.get("parcelId");
    if (!parcelId || !/^\d{19}$/.test(parcelId)) {
      return NextResponse.json(
        { ok: false, error: "19자리 PNU를 parcelId로 전달해야 합니다." },
        { status: 400 },
      );
    }

    const [farm, soil, weather, recentClimate] = await Promise.all([
      fetchFarmMapCandidates(selection),
      fetchSoilByParcel(parcelId),
      fetchWeather(selection),
      fetchRecentClimate(selection),
    ]);

    const confirmed = farm.candidates.find((candidate) => candidate.parcelId === parcelId);
    if (!confirmed) {
      return NextResponse.json(
        {
          ok: false,
          error: `요청한 PNU가 후보 ${farm.candidateCount}개에 없습니다. 좌표나 PNU를 확인하세요.`,
        },
        { status: 409 },
      );
    }

    const collectedAt = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());

    const snapshot = {
      id: `capture-${parcelId}`,
      label: `${confirmed.address} 검증 스냅샷`,
      match: { lat: selection.lat, lng: selection.lng, toleranceDeg: 0.002 },
      provenance: {
        collectedAt,
        collectedBy: "capture-route",
        reproduce: `/api/cache/capture?lat=${selection.lat}&lng=${selection.lng}&parcelId=${parcelId}&horizonDays=${selection.horizonDays}`,
        verificationDocs: ["docs/20260724_추가_공공데이터_실호출_감사.md"],
      },
      parcel: {
        address: confirmed.address,
        parcelId: confirmed.parcelId,
        farmMapId: confirmed.farmMapId,
        interpretation: confirmed.interpretation,
        candidateCount: farm.candidateCount,
        observedAt: confirmed.observedAt,
      },
      soil: {
        ph: soil.ph,
        organicMatter: soil.organicMatter,
        electricalConductivity: soil.electricalConductivity,
        electricalConductivityUnit: soil.electricalConductivityUnit,
        electricalConductivityUnitStatus: soil.electricalConductivityUnitStatus,
        drainage: soil.drainage,
        year: soil.year,
        sampledAt: soil.sampledAt,
        sampleType: soil.sampleType,
        boundaryAvailable: soil.boundaryAvailable,
        physicalProfile: soil.physicalProfile,
        observedAt: soil.observedAt,
      },
      recentClimate: {
        station: recentClimate.station,
        period: recentClimate.period,
        itemCount: recentClimate.itemCount,
        totalRainMm: recentClimate.totalRainMm,
        wetDays: recentClimate.wetDays,
        minTempC: recentClimate.minTempC,
        maxTempC: recentClimate.maxTempC,
        averageHumidityPct: recentClimate.averageHumidityPct,
        representativeness: recentClimate.representativeness,
        observedAt: recentClimate.observedAt,
      },
      weather: { issuedAt: weather.issuedAt, days: weather.days },
    };

    const target = path.join(process.cwd(), "lib", "cache", "snapshots", "verified.json");
    await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    return NextResponse.json({
      ok: true,
      savedTo: "lib/cache/snapshots/verified.json",
      collectedAt,
      summary: {
        parcel: confirmed.address,
        candidateCount: farm.candidateCount,
        soilPh: soil.ph,
        forecastDays: weather.days.length,
        stationName: recentClimate.station.name,
        stationDistanceKm: recentClimate.station.distanceKm,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "검증 스냅샷 수집에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

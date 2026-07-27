import { describe, expect, it } from "vitest";
import { analyzeFarm } from "@/lib/analysis/engine";
import {
  snapshotNotice,
  snapshotProvenance,
  verifiedParcel,
  verifiedRecentClimate,
  verifiedSoil,
} from "@/lib/cache/verifiedSnapshot";
import { createMockWeather } from "@/lib/mock/data";
import type { AnalysisSelection } from "@/types/domain";

const pyeongchang: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

const elsewhere: AnalysisSelection = { ...pyeongchang, lat: 35.1, lng: 129.0 };

describe("검증 스냅샷", () => {
  it("스냅샷에는 출처·수집시각·재현 절차가 있다", () => {
    const provenance = snapshotProvenance();

    expect(provenance.collectedAt).not.toBe("");
    expect(provenance.reproduce).toContain("/api/cache/capture");
    expect(provenance.verificationDocs.length).toBeGreaterThan(0);
  });

  it("대표 좌표에서는 실제 확인된 값을 cache 상태로 돌려준다", () => {
    const parcel = verifiedParcel(pyeongchang);
    const soil = verifiedSoil(pyeongchang);
    const climate = verifiedRecentClimate(pyeongchang);

    expect(parcel?.status).toBe("cache");
    expect(parcel?.parcelId).toMatch(/^\d{19}$/);
    expect(parcel?.selectionStatus).toBe("matched");
    expect(soil?.status).toBe("cache");
    // 스냅샷은 시연 조합(대관령면 85-61전)으로 갱신했다. 값이 바뀌면 이 기대값도 함께 고친다.
    expect(soil?.ph).toBe(6.9);
    expect(soil?.parcelId).toBe(parcel?.parcelId);
    expect(climate?.status).toBe("cache");
    expect(soil?.source).toContain("검증 스냅샷");
  });

  it("스냅샷이 없는 좌표에는 캐시를 쓰지 않는다", () => {
    expect(verifiedParcel(elsewhere)).toBeNull();
    expect(verifiedSoil(elsewhere)).toBeNull();
    expect(verifiedRecentClimate(elsewhere)).toBeNull();
  });

  it("캐시로 대체한 소스만 안내 문장에 넣는다", () => {
    expect(snapshotNotice([])).toBeNull();
    expect(snapshotNotice(["토양 자료"])).toContain("토양 자료");
    expect(snapshotNotice(["토양 자료"])).toContain("실시간 조회가 실패해");
  });

  it("캐시 소스는 실시간 연결로 세지 않고 화면 표시를 구분한다", () => {
    const parcel = verifiedParcel(pyeongchang)!;
    const soil = verifiedSoil(pyeongchang)!;
    const climate = verifiedRecentClimate(pyeongchang)!;
    const result = analyzeFarm({
      mode: "fallback",
      cacheNotice: snapshotNotice(["농지 정보", "토양 자료", "최근 관측"]),
      selection: pyeongchang,
      parcel,
      soil,
      weather: createMockWeather(pyeongchang, undefined, "fallback"),
      recentClimate: climate,
      analyzedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(result.evidenceQuality.connectedSources).toBe(0);
    expect(result.evidenceQuality.note).toContain("검증 스냅샷 3건");
    expect(result.modeLabel).toBe("검증 스냅샷");
    expect(result.cacheNotice).toContain("검증 스냅샷");
  });
});

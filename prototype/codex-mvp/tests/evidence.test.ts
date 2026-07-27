import { describe, expect, it } from "vitest";
import { reconcileParcel } from "@/lib/analysis/evidence";
import { createMockSoil } from "@/lib/mock/data";
import type { AnalysisSelection, ParcelCandidate } from "@/types/domain";

const selection: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

const candidates: ParcelCandidate[] = [
  {
    address: "대관령면 첫 후보",
    parcelId: "PNU-111",
    farmMapId: "FARM-111",
    interpretation: "밭",
    observedAt: "2022-12-30",
  },
  {
    address: "대관령면 토양 일치 후보",
    parcelId: "PNU-015",
    farmMapId: "FARM-015",
    interpretation: "밭",
    observedAt: "2022-12-30",
  },
];

describe("reconcileParcel", () => {
  it("첫 후보가 아니라 토양 PNU와 일치하는 후보를 선택한다", () => {
    const soil = createMockSoil(selection);
    soil.parcelId = "PNU-015";
    const warnings: string[] = [];

    const parcel = reconcileParcel(candidates, soil, warnings);

    expect(parcel.address).toContain("토양 일치 후보");
    expect(parcel.candidateCount).toBe(2);
    expect(parcel.selectionStatus).toBe("matched");
    expect(warnings).toHaveLength(0);
  });

  it("여러 후보가 정합되지 않으면 첫 후보를 임의 확정하지 않는다", () => {
    const soil = createMockSoil(selection);
    soil.parcelId = "PNU-NOT-FOUND";
    const warnings: string[] = [];

    const parcel = reconcileParcel(candidates, soil, warnings);

    expect(parcel.parcelId).toBe("농지 미확정");
    expect(parcel.selectionStatus).toBe("needs_confirmation");
    expect(warnings[0]).toContain("같은 땅인지 확인하지 못했습니다");
  });

  it("후보가 하나뿐이면 그 필지를 선택한다", () => {
    const warnings: string[] = [];

    const parcel = reconcileParcel([candidates[0]], null, warnings);

    expect(parcel.parcelId).toBe("PNU-111");
    expect(parcel.selectionStatus).toBe("matched");
    expect(warnings).toHaveLength(0);
  });
});

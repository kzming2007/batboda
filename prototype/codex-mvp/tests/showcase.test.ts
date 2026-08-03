import { describe, expect, it } from "vitest";
import { analyzeFarm } from "@/lib/analysis/engine";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import { buildShowcaseReport } from "@/lib/report/showcase";
import type { AnalysisSelection } from "@/types/domain";

const selection: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "lettuce",
  horizonDays: 3,
};

function resultWith(soilPatch: Partial<ReturnType<typeof createMockSoil>>) {
  return analyzeFarm({
    mode: "mock",
    selection,
    parcel: createMockParcel(selection),
    soil: { ...createMockSoil(selection), ...soilPatch },
    weather: createMockWeather(selection),
    analyzedAt: "2026-08-03T00:00:00.000Z",
  });
}

/**
 * 토양검정 이력은 필지의 7.0%에만 있다(대관령 반경 1km 258필지 중 18건).
 * pH가 없다고 리포트를 통째로 비우면 검정 이력이 없는 지역에서는 화면이 안내문만 남는다.
 * 등급이 있으면 판정은 이미 나오므로 리포트도 만들고, 산도만 없다고 밝힌다.
 */
describe("쉬운 말 리포트 — 산도가 없는 필지", () => {
  it("pH가 없어도 밭 적성등급이 있으면 리포트를 만든다", () => {
    const { report, note } = buildShowcaseReport(resultWith({ ph: null }));

    expect(note).toBeNull();
    expect(report).not.toBeNull();
  });

  it("없는 산도를 숫자로 채우지 않고 조회되지 않았다고 적는다", () => {
    const { report } = buildShowcaseReport(resultWith({ ph: null }));
    const soil = report?.blocks.find((block) => block.id === "soil");

    expect(soil?.body).toContain("pH를 조회하지 못했습니다");
    expect(soil?.body).toContain("없는 값을 짐작해 채우지 않았습니다");
    expect(report?.usedValues).toContain("pH 조회 안 됨");
  });

  it("공식 권장 범위는 그대로 인용하고 값 없음을 주의로 강조한다", () => {
    const { report } = buildShowcaseReport(resultWith({ ph: null }));

    expect(report?.highlights).toEqual(
      expect.arrayContaining([{ text: "pH를 조회하지 못했습니다", kind: "caution" }]),
    );
    // pH 수치를 강조 목록에 넣지 않는다. 없는 값이므로 본문에도 없다.
    expect(report?.highlights.some((item) => /^pH \d/.test(item.text))).toBe(false);
  });

  it("마무리 문장은 산도 확인을 첫 순서로 안내한다", () => {
    const { report } = buildShowcaseReport(resultWith({ ph: null }));

    expect(report?.closing).toContain("산도는 아직 모르는 상태");
    expect(report?.closing).toContain("토양 검정");
  });

  it("검정 시점을 인용하지 않는다", () => {
    const { report } = buildShowcaseReport(resultWith({ ph: null }));
    const limits = report?.blocks.find((block) => block.id === "limits");

    expect(limits?.body).not.toContain("시료 유형은");
    expect(limits?.body).toContain("검정 이력이 있는 필지에서만 조회됩니다");
  });

  it("산도가 있어도 밭 적성등급이 없으면 리포트를 만들지 않는다", () => {
    const { report, note } = buildShowcaseReport(resultWith({ physicalProfile: null }));

    expect(report).toBeNull();
    expect(note).toContain("밭 적성등급을 조회하지 못했습니다");
    expect(note).toContain("등급이 판정의 주 근거");
  });

  it("둘 다 없으면 둘 다 없다고 적는다", () => {
    const { report, note } = buildShowcaseReport(
      resultWith({ ph: null, physicalProfile: null }),
    );

    expect(report).toBeNull();
    expect(note).toContain("모두 조회되지 않아");
  });

  it("산도가 있으면 기존 문장을 그대로 쓴다", () => {
    const { report } = buildShowcaseReport(resultWith({}));
    const soil = report?.blocks.find((block) => block.id === "soil");

    expect(soil?.body).toContain("이 땅의 pH는");
    expect(soil?.body).not.toContain("조회하지 못했습니다");
  });
});

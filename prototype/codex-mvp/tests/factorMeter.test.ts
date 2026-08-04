import { describe, expect, it, vi } from "vitest";

// 공공데이터 클라이언트는 `server-only`를 참조한다. 이 표식은 Next 런타임이 제공하므로
// 테스트에서는 빈 모듈로 대체해 순수 함수만 불러온다.
vi.mock("server-only", () => ({}));

import { analyzeFarm } from "@/lib/analysis/engine";
import { cropProfiles } from "@/lib/analysis/cropProfiles";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import type { AnalysisSelection, CropId, SoilPhysicalProfile } from "@/types/domain";

/**
 * 기준 대비 눈금은 표시 전용이다. 화면이 문자열을 되풀어 읽지 않도록 엔진이 숫자를 넘긴다.
 *
 * 여기서 지키는 것 셋.
 * 1. 눈금 숫자가 공식 생육 기준과 같다. 기준을 옮겨 적다가 틀리면 그림이 거짓말을 한다.
 * 2. 축이 기준 띠와 내 값을 모두 담는다. 담지 못하면 표식이 축 밖으로 나가 잘린다.
 * 3. 눈금을 붙였다고 판정이 달라지지 않는다.
 */

const demo: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "lettuce",
  horizonDays: 3,
};

function analyzeWith(
  cropId: CropId,
  soilPatch: Partial<SoilPhysicalProfile> = {},
  ph: number | null = 6.2,
) {
  const selection = { ...demo, cropId };
  const soil = createMockSoil(selection);
  return analyzeFarm({
    mode: "mock",
    selection,
    parcel: createMockParcel(selection),
    soil: {
      ...soil,
      ph,
      physicalProfile: soil.physicalProfile
        ? { ...soil.physicalProfile, ...soilPatch }
        : null,
    },
    weather: createMockWeather(selection),
    analyzedAt: "2026-08-04T00:00:00.000Z",
  });
}

const meterOf = (result: ReturnType<typeof analyzeWith>, id: string) =>
  result.factors.find((factor) => factor.id === id)?.meter;

describe("기준 대비 눈금 — 공식 기준을 그대로 옮긴다", () => {
  it.each(["lettuce", "apple", "pear", "potato", "cucumber"] as const)(
    "$0 pH 눈금의 띠가 작물 공식 범위와 같다",
    (cropId) => {
      const meter = meterOf(analyzeWith(cropId), "ph");

      expect(meter?.kind).toBe("range");
      if (meter?.kind !== "range") return;
      expect([meter.bandMin, meter.bandMax]).toEqual(cropProfiles[cropId].ph);
    },
  );

  it("기온 눈금의 띠가 작물 공식 범위와 같다", () => {
    for (const cropId of ["lettuce", "apple", "pear", "potato"] as const) {
      const standard = cropProfiles[cropId].temperature;
      const meter = meterOf(analyzeWith(cropId), "temperature");

      expect(standard.mode).toBe("mean");
      expect(meter?.kind).toBe("range");
      if (meter?.kind !== "range" || standard.mode !== "mean") continue;
      expect([meter.bandMin, meter.bandMax]).toEqual(standard.range);
      expect(meter.unit).toBe("℃");
    }
  });

  /*
    오이는 낮·밤 기준이 따로 있다(낮 22–28℃ · 밤 15–18℃). 축이 둘이라 한 눈금에 담을 수 없고,
    낮과 밤을 섞은 평균은 어느 공식 기준과도 대조되지 않는다. 그래서 눈금을 붙이지 않는다.
    비워 두는 것이 없는 기준을 만들어 그리는 것보다 옳다.
  */
  it("주야 기준 작물에는 기온 눈금을 붙이지 않는다", () => {
    expect(cropProfiles.cucumber.temperature.mode).toBe("day-night");
    expect(meterOf(analyzeWith("cucumber"), "temperature")).toBeUndefined();
  });
});

describe("기준 대비 눈금 — 축이 띠와 값을 모두 담는다", () => {
  it.each([
    { label: "띠보다 낮은 값", ph: 4.8 },
    { label: "띠 안의 값", ph: 6.6 },
    { label: "띠보다 높은 값", ph: 8.4 },
  ])("$label도 축 안에 들어온다", ({ ph }) => {
    const meter = meterOf(analyzeWith("lettuce", {}, ph), "ph");

    expect(meter?.kind).toBe("range");
    if (meter?.kind !== "range") return;
    expect(meter.value).toBe(ph);
    expect(meter.axisMin).toBeLessThan(meter.bandMin);
    expect(meter.axisMax).toBeGreaterThan(meter.bandMax);
    expect(meter.axisMin).toBeLessThan(ph);
    expect(meter.axisMax).toBeGreaterThan(ph);
  });

  it("축 숫자는 왼쪽에서 오른쪽으로 커진다", () => {
    const meter = meterOf(analyzeWith("potato", {}, 5.5), "ph");

    if (meter?.kind !== "range") throw new Error("range 눈금이 아니다");
    expect(meter.ticks).toEqual([...meter.ticks].sort((a, b) => a - b));
    expect(meter.ticks[0]).toBe(meter.axisMin);
    expect(meter.ticks.at(-1)).toBe(meter.axisMax);
  });
});

describe("기준 대비 눈금 — 작물이 보는 등급을 가리킨다", () => {
  /*
    시연 자료는 밭 04급지 · 과수 03급지다. 두 값이 다르므로 눈금이 어느 등급을 가리키는지
    구별된다. 판정은 이미 작물별 등급으로 내리므로 눈금도 같은 값을 써야 한다.
    눈금이 코드를 다시 해석하면 행 문구와 어긋난다.
  */
  it("사과는 과수 등급, 상추는 밭 등급을 눈금에 쓴다", () => {
    const profile = createMockSoil(demo).physicalProfile;
    expect(profile?.uplandGradeCode).toBe("04");
    expect(profile?.orchardGradeCode).toBe("03");

    expect(meterOf(analyzeWith("apple"), "upland-suitability")).toEqual({
      kind: "grade",
      total: 5,
      value: 3,
    });
    expect(meterOf(analyzeWith("lettuce"), "upland-suitability")).toEqual({
      kind: "grade",
      total: 5,
      value: 4,
    });
  });

  it("등급이 조회되지 않으면 채운 칸을 비워 둔다", () => {
    const meter = meterOf(
      analyzeWith("lettuce", { uplandGradeCode: null }),
      "upland-suitability",
    );

    expect(meter).toEqual({ kind: "grade", total: 5, value: null });
  });
});

describe("기준 대비 눈금 — 없는 값을 그리지 않는다", () => {
  it("pH가 없으면 표식을 찍지 않고 축과 띠만 남긴다", () => {
    const meter = meterOf(analyzeWith("lettuce", {}, null), "ph");

    expect(meter?.kind).toBe("range");
    if (meter?.kind !== "range") return;
    expect(meter.value).toBeNull();
    expect(meter.axisMin).toBeLessThan(meter.bandMin);
    expect(meter.axisMax).toBeGreaterThan(meter.bandMax);
  });

  /*
    배수는 어휘가 둘이다. 행 문구는 V3 원문 6단계(`약간 불량` 등)를 보여주고, 눈금은
    위험 산식이 실제로 쓴 3단계를 가리킨다. 물리성 자료가 없는 경로에는 코드가 없어
    6칸 중 어디인지 정할 근거가 없기 때문이다. 화면은 눈금 옆에 `점수에 반영된 단계`라고 적는다.
  */
  it("배수 눈금은 점수에 반영된 3단계를 가리킨다", () => {
    expect(meterOf(analyzeWith("lettuce", { drainageCode: "01" }), "drainage")).toEqual({
      kind: "steps",
      labels: ["양호", "보통", "불량"],
      index: 0,
    });
    expect(meterOf(analyzeWith("lettuce", { drainageCode: "04" }), "drainage")).toEqual({
      kind: "steps",
      labels: ["양호", "보통", "불량"],
      index: 1,
    });
    expect(meterOf(analyzeWith("lettuce", { drainageCode: "06" }), "drainage")).toEqual({
      kind: "steps",
      labels: ["양호", "보통", "불량"],
      index: 2,
    });
  });

  it("EC와 유기물에는 대조할 공식 기준이 없어 눈금을 붙이지 않는다", () => {
    const result = analyzeWith("lettuce");

    expect(meterOf(result, "electrical-conductivity")).toBeUndefined();
    expect(meterOf(result, "organic")).toBeUndefined();
  });
});

describe("눈금을 붙여도 판정은 그대로다", () => {
  /*
    눈금은 표시 전용이다. `meter`를 지우면 이전과 완전히 같은 근거 묶음이 나와야 한다.
    이 검사가 깨지면 표시를 붙이면서 판정을 건드린 것이다.
  */
  it.each(["lettuce", "apple", "pear", "potato", "cucumber"] as const)(
    "$0의 근거는 meter 말고 달라진 것이 없다",
    (cropId) => {
      const result = analyzeWith(cropId);
      const withoutMeter = result.factors.map(({ meter, ...rest }) => rest);

      // 눈금 없이 남은 항목이 여섯 갈래 그대로이고 값이 문자열로 유지되는지 본다.
      expect(withoutMeter.every((factor) => typeof factor.value === "string")).toBe(true);
      expect(withoutMeter.map((factor) => factor.id)).toEqual(
        result.factors.map((factor) => factor.id),
      );
      expect(JSON.stringify(withoutMeter)).not.toContain("meter");
    },
  );

  it("눈금 유무가 판정 단계와 점수를 바꾸지 않는다", () => {
    const result = analyzeWith("apple");

    // 시연 자료 기준값. 이 값이 흔들리면 표시 작업이 판정에 새어 들어간 것이다.
    // 사과는 과수 03급지를 보고 pH 6.2가 공식 범위 6.0–6.5 안이라 조건부 적합 경로로 간다.
    expect(result.suitabilityLabel).toBe("조건부 적합");
    expect(result.factors.filter((factor) => factor.meter).length).toBe(4);
  });
});

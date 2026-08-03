import { describe, expect, it } from "vitest";
import { analyzeFarm } from "@/lib/analysis/engine";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import { buildReportBundle } from "@/lib/report/bundle";
import { validateReport } from "@/lib/report/contract";
import {
  bundleForReplay,
  replayableFor,
  type LlmResponseRecord,
} from "@/lib/report/snapshots/llmSnapshot";
import type { AnalysisSelection } from "@/types/domain";

const selection: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

const result = analyzeFarm({
  mode: "mock",
  selection,
  parcel: createMockParcel(selection),
  soil: createMockSoil(selection),
  weather: createMockWeather(selection),
  analyzedAt: "2026-08-03T00:00:00.000Z",
});

const bundle = buildReportBundle(result);

function record(patch: Partial<LlmResponseRecord> = {}): LlmResponseRecord {
  return {
    key: "테스트|감자|3",
    model: "gemini-2.5-flash",
    collectedAt: "2026-08-03T08:34:49.523Z",
    draft: "저장된 문장",
    capturedAt: {
      stage: bundle.stage,
      riskLabel: bundle.riskLabel,
      allowedNumbers: bundle.allowedNumbers,
    },
    ...patch,
  };
}

/**
 * 저장본은 수집 시점의 예보 수치를 문장에 담고 있다. 예보는 하루에도 여러 번 갱신되므로
 * 오늘 근거로 숫자를 대조하면 멀쩡한 저장본이 매번 검사에 걸린다.
 * 실제로 배포본에서 `근거에 없는 숫자 '23.3'`으로 걸려 규칙 문장으로 떨어졌다.
 */
describe("저장본 재생 조건", () => {
  it("판정과 위험 등급이 그대로면 재생할 수 있다", () => {
    expect(replayableFor(record(), bundle).ok).toBe(true);
  });

  it("판정이 바뀌었으면 재생하지 않는다", () => {
    const changed = record({
      capturedAt: { stage: "적합", riskLabel: bundle.riskLabel, allowedNumbers: [] },
    });
    const verdict = replayableFor(changed, bundle);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("적합");
    expect(verdict.reason).toContain(bundle.stage);
  });

  it("위험 등급이 바뀌었으면 재생하지 않는다", () => {
    const changed = record({
      capturedAt: { stage: bundle.stage, riskLabel: "높음", allowedNumbers: [] },
    });
    const verdict = replayableFor(changed, bundle);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("위험 등급");
  });

  // 오늘 근거로 대조하면 예보 갱신분이 그대로 실패로 잡힌다. 재생하지 않고 넘기는 편이 낫다.
  it("수집 시점 근거가 없는 예전 기록은 재생하지 않는다", () => {
    const legacy = record({ capturedAt: undefined });
    const verdict = replayableFor(legacy, bundle);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("다시 수집");
    // 대조할 값이 없으면 오늘 근거를 그대로 넘긴다.
    expect(bundleForReplay(legacy, bundle)).toBe(bundle);
  });
});

describe("저장본 숫자 검사 기준", () => {
  it("수집 시점 근거로 대조하면 그때의 예보 수치가 통과한다", () => {
    const stored = record({
      capturedAt: {
        stage: bundle.stage,
        riskLabel: bundle.riskLabel,
        // 저장 당시에는 23.3이 근거에 있었다고 가정한다.
        allowedNumbers: [...bundle.allowedNumbers, "23.3"],
      },
    });
    const draft =
      `한 줄 결론 판정은 ${bundle.stage}이고 위험은 ${bundle.riskLabel}입니다. ` +
      `왜 이렇게 나왔나 평균 23.3도였습니다. 함께 확인할 점 참고 판단입니다.`;

    // 오늘 근거로는 걸리고, 수집 시점 근거로는 통과해야 한다.
    expect(validateReport(draft, bundle).failures.some((f) => f.includes("23.3"))).toBe(true);
    expect(
      validateReport(draft, bundleForReplay(stored, bundle)).failures.some((f) => f.includes("23.3")),
    ).toBe(false);
  });
});

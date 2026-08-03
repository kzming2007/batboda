import { describe, expect, it } from "vitest";
import { analyzeFarm } from "@/lib/analysis/engine";
import { createMockParcel, createMockSoil, createMockWeather } from "@/lib/mock/data";
import { buildReportBundle } from "@/lib/report/bundle";
import { stripMarkdown, validateReport } from "@/lib/report/contract";
import { createFarmReport, ruleBasedSections } from "@/lib/report";
import { registerReportProvider } from "@/lib/report/provider";
import { registerCuratedProvider } from "@/lib/report/providers/curated";
import { registerTamperedProvider } from "@/lib/report/providers/tampered";
import type { AnalysisSelection } from "@/types/domain";

const selection: AnalysisSelection = {
  lat: 37.675,
  lng: 128.718,
  cropId: "potato",
  horizonDays: 3,
};

const baseResult = analyzeFarm({
  mode: "mock",
  selection,
  parcel: createMockParcel(selection),
  soil: createMockSoil(selection),
  weather: createMockWeather(selection),
  analyzedAt: "2026-07-25T00:00:00.000Z",
});

describe("마크다운 제거", () => {
  // 실제 Gemini 출력이 `**조건부 적합**`처럼 강조를 넣어 화면에 별표가 그대로 보인 사례가 있다.
  it("강조·제목 기호를 지우고 글자는 남긴다", () => {
    expect(stripMarkdown("**조건부 적합**하며, **주의** 등급입니다."))
      .toBe("조건부 적합하며, 주의 등급입니다.");
    expect(stripMarkdown("__굵게__ 와 `코드` 와 *기울임* 을 지운다."))
      .toBe("굵게 와 코드 와 기울임 을 지운다.");
    expect(stripMarkdown("## 한 줄 결론\n> 인용문")).toBe("한 줄 결론\n인용문");
  });

  it("숫자 범위와 단위의 하이픈은 건드리지 않는다", () => {
    const text = "상추 공식 범위 6.5–7.0, 적온 15-20℃, 유효토심 50-100cm";
    expect(stripMarkdown(text)).toBe(text);
  });

  it("짝이 맞지 않는 별표도 남기지 않는다", () => {
    expect(stripMarkdown("**조건부 적합 인데 닫히지 않았다")).toBe("조건부 적합 인데 닫히지 않았다");
  });
});

describe("설명 리포트 계약", () => {
  it("근거 묶음에는 규칙 결과와 한계만 담는다", () => {
    const bundle = buildReportBundle(baseResult);

    expect(bundle.stage).toBe(baseResult.suitabilityLabel);
    expect(bundle.riskLabel).toBe(baseResult.riskLabel);
    expect(bundle.actions.length).toBe(baseResult.actions.length);
    expect(bundle.limits.some((limit) => limit.includes("성공 가능성"))).toBe(true);
    expect(bundle.allowedNumbers).toContain(String(baseResult.riskScore));
  });

  it("제공자가 없으면 규칙 기반 설명을 만들고 생성·검증 단계를 건너뛴 것으로 표시한다", async () => {
    const report = await createFarmReport(baseResult);

    expect(report.origin).toBe("rule");
    expect(report.originLabel).toBe("규칙 기반 설명");
    expect(report.sections.map((section) => section.heading)).toEqual([
      "한 줄 결론",
      "왜 이렇게 나왔나",
      "함께 확인할 점",
    ]);
    expect(report.actionNotes).toHaveLength(baseResult.actions.length);
    expect(report.actionNotes[0].note).toContain(baseResult.actions[0].detail);
    expect(report.text).toContain(baseResult.suitabilityLabel);
    expect(report.pipeline.find((step) => step.id === "generate")?.state).toBe("skipped");
    expect(report.pipeline.find((step) => step.id === "deliver")?.state).toBe("done");
  });

  it("규칙 기반 설명 자체가 검증 규칙을 통과한다", () => {
    const bundle = buildReportBundle(baseResult);
    const text = ruleBasedSections(bundle)
      .map((section) => `${section.heading}\n${section.body}`)
      .join("\n\n");

    expect(validateReport(text, bundle).failures).toEqual([]);
  });

  it("판정을 바꾸거나 없는 숫자를 만든 설명은 검증에서 막는다", () => {
    const bundle = buildReportBundle(baseResult);

    const changedStage = validateReport(
      "결론 이 농지는 적합합니다. 근거 좋습니다. 먼저 할 일 없음. 주의 없음.",
      bundle,
    );
    const inventedNumber = validateReport(
      `결론 판정은 ${bundle.stage}입니다. 근거 성공률이 87.3입니다. 먼저 할 일 배수 점검. 주의 참고용입니다.`,
      bundle,
    );

    expect(changedStage.ok).toBe(false);
    expect(inventedNumber.ok).toBe(false);
    expect(inventedNumber.failures.some((failure) => failure.includes("87.3"))).toBe(true);
  });

  it("금지 표현이 있으면 검증에서 막는다", () => {
    const bundle = buildReportBundle(baseResult);
    const validation = validateReport(
      `결론 판정은 ${bundle.stage}입니다. 근거 발병 확률이 낮고 수확을 보장합니다. 먼저 할 일 배수 점검. 주의 참고용입니다.`,
      bundle,
    );

    expect(validation.ok).toBe(false);
    expect(validation.failures.some((failure) => failure.includes("발병 확률"))).toBe(true);
    expect(validation.failures.some((failure) => failure.includes("보장"))).toBe(true);
  });
});

describe("설명 생성 제공자 경로", () => {
  it("예시 문안 제공자의 문장은 실제 검증을 통과한다", async () => {
    registerCuratedProvider();
    const report = await createFarmReport(baseResult);

    expect(report.origin).toBe("llm");
    expect(report.originLabel).toContain("예시 문안");
    expect(report.originLabel).toContain("AI 미연결");
    expect(report.validation?.ok).toBe(true);
    expect(report.text).toContain(baseResult.suitabilityLabel);
    expect(report.pipeline.find((step) => step.id === "generate")?.state).toBe("done");
    expect(report.pipeline.find((step) => step.id === "validate")?.state).toBe("done");
  });

  it("규칙을 어긴 문장은 검증에서 막히고 규칙 기반 설명으로 대체된다", async () => {
    registerTamperedProvider();
    const report = await createFarmReport(baseResult);

    expect(report.origin).toBe("rule");
    expect(report.originLabel).toContain("검사에 걸려");
    expect(report.validation?.ok).toBe(false);
    const failures = report.validation?.failures.join(" ") ?? "";
    expect(failures).toContain("근거에 없는 숫자");
    expect(failures).toContain("쓰면 안 되는 표현");
    expect(report.text).not.toContain("987");
    expect(report.text).toContain(baseResult.suitabilityLabel);
  });

  it("생성 호출이 실패하면 같은 근거의 규칙 기반 설명으로 대체한다", async () => {
    registerReportProvider({
      name: "실패 확인용",
      async generate() {
        throw new Error("연결 실패");
      },
    });
    const report = await createFarmReport(baseResult);

    expect(report.origin).toBe("rule");
    expect(report.originLabel).toContain("AI 호출이 안 되어");
    expect(report.providerNote).toContain("연결 실패");
  });
});

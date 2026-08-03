import { buildReportBundle, type ReportBundle } from "@/lib/report/bundle";
import {
  REPORT_SECTIONS,
  reportSystemPrompt,
  reportUserPrompt,
  stripMarkdown,
  validateReport,
} from "@/lib/report/contract";
import { resolveReportProvider } from "@/lib/report/provider";
import type {
  AnalysisResult,
  FarmReport,
  ReportActionNote,
  ReportPipelineStep,
  ReportSection,
} from "@/types/domain";

/** 규칙 결과를 그대로 문장화한다. LLM이 없을 때도 항상 같은 근거로 같은 설명을 만든다. */
export function ruleBasedSections(bundle: ReportBundle): ReportSection[] {
  const outOfRange = bundle.keyFactors.filter((factor) => factor.state === "기준 밖");
  const watch = bundle.keyFactors.filter((factor) => factor.state === "주의");
  const unknown = bundle.keyFactors.filter((factor) => factor.state === "확인 필요");

  const conclusion =
    `${bundle.parcel.address}에서 ${bundle.crop}를 재배하는 조건은 지금 자료로 ${bundle.stage}입니다. ` +
    `가까운 ${bundle.horizonDays}일 사이 위험은 ${bundle.riskLabel} 수준입니다.`;

  const groundSentences: string[] = [];
  if (outOfRange.length > 0) {
    groundSentences.push(
      `공식 기준을 벗어난 항목은 ${outOfRange
        .map((factor) => `${factor.label} ${factor.value}(기준 ${factor.target})`)
        .join(", ")}입니다.`,
    );
  }
  if (watch.length > 0) {
    groundSentences.push(
      `주의로 본 항목은 ${watch.map((factor) => `${factor.label} ${factor.value}`).join(", ")}입니다.`,
    );
  }
  if (unknown.length > 0) {
    groundSentences.push(
      `${unknown.map((factor) => factor.label).join(", ")}는 자료가 없어 판단에서 낙관하지 않았습니다.`,
    );
  }
  if (groundSentences.length === 0) {
    groundSentences.push("확인한 항목이 모두 공식 기준 안에 있었습니다.");
  }
  groundSentences.push(`자료 상태는 ${bundle.dataStatus.label}이고, ${bundle.dataStatus.note}입니다.`);

  return [
    { heading: "한 줄 결론", body: conclusion },
    { heading: "왜 이렇게 나왔나", body: groundSentences.join(" ") },
    { heading: "함께 확인할 점", body: bundle.limits.join(" ") },
  ];
}

/** 행동 항목 옆에 붙는 설명. 규칙이 만든 행동 근거를 그대로 문장으로 쓴다. */
export function ruleBasedActionNotes(bundle: ReportBundle): ReportActionNote[] {
  // 시각(timing)은 화면에서 제목 옆에 따로 표시하므로 설명 문장에 다시 붙이지 않는다.
  return bundle.actions.map((action) => ({
    title: action.title,
    note: action.detail,
  }));
}

const sectionsToText = (sections: ReportSection[]) =>
  sections.map((section) => `${section.heading}\n${section.body}`).join("\n\n");

/**
 * 검증을 통과한 초안을 화면과 같은 세 블록으로 나눈다.
 * 구성이 예상과 다르면 나누지 않고 원문 한 덩어리로 보여준다. 내용은 바꾸지 않는다.
 */
function parseDraftSections(draft: string): ReportSection[] {
  const parsed: ReportSection[] = [];
  for (let index = 0; index < REPORT_SECTIONS.length; index += 1) {
    const heading = REPORT_SECTIONS[index];
    const start = draft.indexOf(heading);
    if (start === -1) return [{ heading: "AI 설명", body: draft }];

    const nextHeading = REPORT_SECTIONS[index + 1];
    const end = nextHeading ? draft.indexOf(nextHeading, start) : draft.length;
    const body = draft.slice(start + heading.length, end === -1 ? draft.length : end).trim();
    if (!body) return [{ heading: "AI 설명", body: draft }];
    parsed.push({ heading, body });
  }
  return parsed;
}

export async function createFarmReport(result: AnalysisResult): Promise<FarmReport> {
  const bundle = buildReportBundle(result);
  const system = reportSystemPrompt();
  const user = reportUserPrompt(bundle);
  const resolution = resolveReportProvider();

  const pipeline: ReportPipelineStep[] = [
    {
      id: "bundle",
      label: "판정 결과 정리",
      detail: `규칙이 확정한 판정과 근거만 모았습니다. 근거 항목 ${bundle.keyFactors.length}개, 예방 행동 ${bundle.actions.length}개.`,
      state: "done",
    },
    {
      id: "prompt",
      label: "설명 규칙 적용",
      detail: "AI가 새 수치나 판정을 만들지 못하게 하고, 확률·처방 표현을 금지했습니다.",
      state: "done",
    },
  ];

  if (!resolution.provider) {
    const sections = ruleBasedSections(bundle);
    pipeline.push(
      {
        id: "generate",
        label: "설명 생성",
        detail: resolution.reason,
        state: "skipped",
      },
      {
        id: "validate",
        label: "문장 검사",
        detail: "생성 단계를 건너뛰어 검사할 문장이 없습니다.",
        state: "skipped",
      },
      {
        id: "deliver",
        label: "화면 전달",
        detail: "같은 근거로 만든 규칙 문장을 화면에 내보냈습니다.",
        state: "done",
      },
    );
    return {
      origin: "rule",
      originLabel: "규칙 기반 설명",
      sections,
      actionNotes: ruleBasedActionNotes(bundle),
      text: sectionsToText(sections),
      pipeline,
      validation: null,
      providerNote: resolution.reason,
    };
  }

  try {
    // 검증 앞에서 마크다운을 지운다. 화면은 평문을 그대로 출력하므로 별표가 사용자에게 보인다.
    const draft = stripMarkdown(await resolution.provider.generate({ system, user, bundle }));
    // 저장된 응답을 재생한 경우에는 수집 시점 근거로 숫자를 대조한다.
    const validationBundle =
      resolution.provider.resolveValidationBundle?.({ system, user, bundle }) ?? bundle;
    const validation = validateReport(draft, validationBundle);
    pipeline.push({
      id: "generate",
      label: "설명 생성",
      detail: `${resolution.provider.name}이 정리된 근거만 받아 설명을 작성했습니다.`,
      state: "done",
    });

    if (!validation.ok) {
      const sections = ruleBasedSections(bundle);
      pipeline.push(
        {
          id: "validate",
          label: "문장 검사",
          detail: `검사에서 걸렸습니다 — ${validation.failures.join(" / ")}`,
          state: "done",
        },
        {
          id: "deliver",
          label: "화면 전달",
          detail: "검사를 통과하지 못해 같은 근거로 만든 규칙 문장으로 바꿔 내보냈습니다.",
          state: "done",
        },
      );
      return {
        origin: "rule",
        originLabel: "AI 문장이 검사에 걸려 규칙 문장을 표시",
        sections,
        actionNotes: ruleBasedActionNotes(bundle),
        text: sectionsToText(sections),
        pipeline,
        validation,
        providerNote: null,
      };
    }

    pipeline.push(
      {
        id: "validate",
        label: "문장 검사",
        detail: `${validation.checked.join(", ")} 항목을 모두 통과했습니다.`,
        state: "done",
      },
      { id: "deliver", label: "화면 전달", detail: "검사를 통과한 설명을 화면에 내보냈습니다.", state: "done" },
    );
    return {
      origin: "llm",
      originLabel:
        resolution.provider.resolveSuccessLabel?.({ system, user, bundle }) ??
        resolution.provider.successLabel ??
        `AI 설명 · ${resolution.provider.name} · 검사 통과`,
      sections: parseDraftSections(draft),
      actionNotes: ruleBasedActionNotes(bundle),
      text: draft,
      pipeline,
      validation,
      providerNote: null,
    };
  } catch (error) {
    const sections = ruleBasedSections(bundle);
    const message = error instanceof Error ? error.message : "설명 생성 호출이 실패했습니다.";
    pipeline.push(
      { id: "generate", label: "설명 생성", detail: message, state: "skipped" },
      {
        id: "validate",
        label: "문장 검사",
        detail: "작성된 문장이 없어 검사하지 않았습니다.",
        state: "skipped",
      },
      {
        id: "deliver",
        label: "화면 전달",
        detail: "규칙 문장으로 바꿔 내보냈습니다.",
        state: "done",
      },
    );
    return {
      origin: "rule",
      originLabel: "AI 호출이 안 되어 규칙 문장을 표시",
      sections,
      actionNotes: ruleBasedActionNotes(bundle),
      text: sectionsToText(sections),
      pipeline,
      validation: null,
      providerNote: message,
    };
  }
}

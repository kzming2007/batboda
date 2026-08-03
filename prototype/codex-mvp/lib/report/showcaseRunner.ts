import { buildReportBundle } from "@/lib/report/bundle";
import { stripMarkdown } from "@/lib/report/contract";
import { buildShowcaseReport } from "@/lib/report/showcase";
import {
  parseShowcaseDraft,
  showcaseSystemPrompt,
  showcaseUserPrompt,
  validateShowcaseDraft,
} from "@/lib/report/showcaseAi";
import { geminiGenerate, GEMINI_MODEL } from "@/lib/report/providers/gemini";
import {
  findShowcaseResponse,
  readableDate,
  readableModelName,
} from "@/lib/report/snapshots/llmSnapshot";
import type { AnalysisResult, ShowcaseReport } from "@/types/domain";

/**
 * 04 쉬운 말 리포트를 만드는 경로를 고른다.
 *
 * `LLM_PROVIDER` 값에 따라 실시간 생성 또는 저장해 둔 실호출 응답 재생을 시도하고,
 * 어느 쪽이든 **검사를 통과하지 못하면 사람이 써 둔 문안으로 되돌린다.**
 * 되돌아간 경우 화면 배지가 `규칙이 조립한 안내문`으로 남아 사실이 드러난다.
 */

export type ShowcaseOutcome = {
  report: ShowcaseReport | null;
  note: string | null;
  /** 화면 `설명 만드는 과정`과 문서에 남길 기록 */
  trace: { attempted: boolean; passed: boolean; failures: string[]; source: string };
};

const CURATED_LABEL = "규칙이 조립한 안내문 · AI 생성 아님";

function curatedOutcome(result: AnalysisResult, trace: ShowcaseOutcome["trace"]): ShowcaseOutcome {
  const curated = buildShowcaseReport(result);
  return {
    report: curated.report
      ? { ...curated.report, originLabel: CURATED_LABEL }
      : null,
    note: curated.note,
    trace,
  };
}

export async function buildShowcaseOutcome(result: AnalysisResult): Promise<ShowcaseOutcome> {
  const provider = process.env.LLM_PROVIDER;
  const bundle = buildReportBundle(result);

  // pH·밭 적성등급이 모두 없으면 사람이 쓴 경로도 문장을 만들지 않는다. 그 조건을 그대로 따른다.
  const curatedProbe = buildShowcaseReport(result);
  if (!curatedProbe.report) {
    return {
      report: null,
      note: curatedProbe.note,
      trace: { attempted: false, passed: false, failures: [], source: "조건 미충족" },
    };
  }

  if (provider !== "gemini" && provider !== "replay" && provider !== "replay-live") {
    return curatedOutcome(result, {
      attempted: false,
      passed: false,
      failures: [],
      source: "AI 미연결",
    });
  }

  try {
    let draft: string;
    let originLabel: string;

    // 저장본을 먼저 본다. `replay`는 없으면 여기서 멈추고, `replay-live`는 실시간으로 넘어간다.
    const record = provider === "gemini" ? null : findShowcaseResponse(bundle);

    if (record) {
      draft = record.draft;
      originLabel =
        `AI 설명 · ${readableModelName(record.model)} · ` +
        `${readableDate(record.collectedAt.slice(0, 10))} 작성 · 검사 통과`;
    } else if (provider === "replay") {
      return curatedOutcome(result, {
        attempted: false,
        passed: false,
        failures: [],
        source: "저장된 AI 리포트 없음",
      });
    } else {
      draft = await geminiGenerate({
        system: showcaseSystemPrompt(),
        user: showcaseUserPrompt(bundle),
      });
      originLabel =
        `AI 설명 · ${readableModelName(GEMINI_MODEL)}` +
        `${provider === "replay-live" ? " · 실시간 생성" : ""} · 검사 통과`;
    }

    // 저장된 응답에도 마크다운이 섞여 있을 수 있어 재생·실시간 양쪽 모두 지운다.
    draft = stripMarkdown(draft);

    const validation = validateShowcaseDraft(draft, bundle);
    if (!validation.ok) {
      return curatedOutcome(result, {
        attempted: true,
        passed: false,
        failures: validation.failures,
        source: provider,
      });
    }

    const report = parseShowcaseDraft(draft, bundle, {
      caseLabel: `${bundle.parcel.address} · ${bundle.crop}`,
      originLabel,
    });
    // 파싱 결과가 비어 있으면 화면이 깨지므로 되돌린다.
    if (!report.headline || report.blocks.some((block) => !block.body) || !report.closing) {
      return curatedOutcome(result, {
        attempted: true,
        passed: false,
        failures: ["형식을 지키지 않아 화면 구조로 옮기지 못했습니다."],
        source: provider,
      });
    }

    return {
      report,
      note: null,
      trace: { attempted: true, passed: true, failures: [], source: provider },
    };
  } catch (error) {
    return curatedOutcome(result, {
      attempted: true,
      passed: false,
      failures: [error instanceof Error ? error.message : "생성 호출이 실패했습니다."],
      source: provider,
    });
  }
}

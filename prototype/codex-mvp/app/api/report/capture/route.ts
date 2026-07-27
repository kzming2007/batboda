import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { runAnalysis } from "@/lib/analysis/service";
import { buildReportBundle } from "@/lib/report/bundle";
import {
  reportSystemPrompt,
  reportUserPrompt,
  validateReport,
} from "@/lib/report/contract";
import { geminiGenerate, GEMINI_MODEL } from "@/lib/report/providers/gemini";
import {
  bundleKey,
  showcaseKey,
  type LlmResponseRecord,
} from "@/lib/report/snapshots/llmSnapshot";
import {
  showcaseSystemPrompt,
  showcaseUserPrompt,
  validateShowcaseDraft,
} from "@/lib/report/showcaseAi";
import { selectionFromSearch } from "@/lib/public-data/request";

/**
 * 실호출 응답 수집용 개발 전용 경로.
 *
 * 실제 제공자를 한 번 호출해 받은 응답을 그대로 `lib/report/snapshots/llmResponses.json`에 저장한다.
 * 검증 결과도 함께 돌려주므로, 저장한 응답이 화면에 나갈 수 있는 문장인지 여기서 확인한다.
 * 사람이 문장을 손으로 넣지 않기 위한 경로이므로 운영 빌드에서는 동작하지 않는다.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "실호출 응답 수집은 개발 환경에서만 실행합니다." },
      { status: 403 },
    );
  }
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "GEMINI_API_KEY가 설정되지 않았습니다." },
      { status: 400 },
    );
  }

  try {
    const params = new URL(request.url).searchParams;
    const selection = selectionFromSearch(params);
    const mode = params.get("mode") === "mock" ? "mock" : "live";

    const result = await runAnalysis(selection, mode);
    const bundle = buildReportBundle(result);
    const system = reportSystemPrompt();
    const user = reportUserPrompt(bundle);

    const draft = await geminiGenerate({ system, user });
    const validation = validateReport(draft, bundle);

    // 04 쉬운 말 리포트도 같은 호출 경로로 함께 수집한다.
    const showcaseDraft = await geminiGenerate({
      system: showcaseSystemPrompt(),
      user: showcaseUserPrompt(bundle),
    });
    const showcaseValidation = validateShowcaseDraft(showcaseDraft, bundle);

    const file = path.join(process.cwd(), "lib", "report", "snapshots", "llmResponses.json");
    const current = JSON.parse(await readFile(file, "utf8")) as {
      note?: string;
      records: LlmResponseRecord[];
    };

    const record: LlmResponseRecord = {
      key: bundleKey(bundle),
      model: GEMINI_MODEL,
      collectedAt: new Date().toISOString(),
      draft,
    };
    const showcaseRecord: LlmResponseRecord = {
      key: showcaseKey(bundle),
      model: GEMINI_MODEL,
      collectedAt: new Date().toISOString(),
      draft: showcaseDraft,
    };
    const records = [
      ...current.records.filter(
        (item) => item.key !== record.key && item.key !== showcaseRecord.key,
      ),
      record,
      showcaseRecord,
    ];
    await writeFile(file, `${JSON.stringify({ ...current, records }, null, 2)}\n`, "utf8");

    return NextResponse.json({
      ok: true,
      saved: record.key,
      model: record.model,
      collectedAt: record.collectedAt,
      mode: result.mode,
      stage: result.suitabilityLabel,
      validation,
      draft,
      showcase: {
        validation: showcaseValidation,
        draft: showcaseDraft,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "수집에 실패했습니다." },
      { status: 500 },
    );
  }
}

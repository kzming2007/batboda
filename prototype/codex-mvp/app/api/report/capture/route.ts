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
import { geminiGenerate } from "@/lib/report/providers/gemini";
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

    // 두 호출이 서로 다른 모델로 끝날 수 있다. 저장본에는 그 문장을 실제로 만든 모델을 적는다.
    const live = await geminiGenerate({ system, user });
    const draft = live.text;
    const validation = validateReport(draft, bundle);

    // 04 쉬운 말 리포트도 같은 호출 경로로 함께 수집한다.
    const showcaseLive = await geminiGenerate({
      system: showcaseSystemPrompt(),
      user: showcaseUserPrompt(bundle),
    });
    const showcaseDraft = showcaseLive.text;
    const showcaseValidation = validateShowcaseDraft(showcaseDraft, bundle);

    const file = path.join(process.cwd(), "lib", "report", "snapshots", "llmResponses.json");
    const current = JSON.parse(await readFile(file, "utf8")) as {
      note?: string;
      records: LlmResponseRecord[];
    };

    // 수집 시점의 근거를 함께 저장한다. 저장본 문장은 이때의 예보 수치를 담고 있어서,
    // 재생할 때 오늘 근거로 숫자를 대조하면 예보가 갱신된 만큼 검사에 걸린다.
    // 판정·위험 등급은 나중에 저장본을 쓸 수 있는지 가리는 데 쓴다.
    const capturedAt = {
      stage: bundle.stage,
      riskLabel: bundle.riskLabel,
      allowedNumbers: bundle.allowedNumbers,
    };
    const collectedAt = new Date().toISOString();

    const record: LlmResponseRecord = {
      key: bundleKey(bundle),
      model: live.model,
      collectedAt,
      draft,
      capturedAt,
    };
    const showcaseRecord: LlmResponseRecord = {
      key: showcaseKey(bundle),
      model: showcaseLive.model,
      collectedAt,
      draft: showcaseDraft,
      capturedAt,
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

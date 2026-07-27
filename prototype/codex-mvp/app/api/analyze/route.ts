import { NextResponse } from "next/server";
// 설명 생성 제공자 등록. LLM_PROVIDER가 없으면 아무 제공자도 등록되지 않는다.
import "@/lib/report/providers";
import { runAnalysis } from "@/lib/analysis/service";
import { parseSelection } from "@/lib/public-data/request";
import type { AnalyzeResponse } from "@/types/domain";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const selection = parseSelection(body);
    const requestedMode = body.mode === "live" ? "live" : "mock";
    const result = await runAnalysis(selection, requestedMode);
    return NextResponse.json<AnalyzeResponse>({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "분석 요청을 처리하지 못했습니다.";
    return NextResponse.json<AnalyzeResponse>({ ok: false, error: message }, { status: 400 });
  }
}

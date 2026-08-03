import { NextResponse } from "next/server";
// 설명 생성 제공자 등록. LLM_PROVIDER가 없으면 아무 제공자도 등록되지 않는다.
import "@/lib/report/providers";
import { runAnalysis } from "@/lib/analysis/service";
import { parseSelection } from "@/lib/public-data/request";
import type { AnalyzeResponse } from "@/types/domain";

/**
 * 공공데이터 네 갈래와 설명 생성을 한 요청에서 처리한다.
 * 로컬 실측은 2.2~2.7초지만 배포 환경에서는 정부 API까지의 왕복이 더 길어질 수 있어
 * 기본 상한(10초)에 걸리지 않게 여유를 둔다. 소스별 실패는 각각 대체되므로 이 값에 닿는 일은 드물다.
 */
export const maxDuration = 60;

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

import { NextResponse } from "next/server";
import { fetchParcelBoundary } from "@/lib/public-data/client";

/**
 * 확정한 필지의 경계 조회.
 *
 * 판정 흐름과 분리해 둔다. 경계가 없거나 실패해도 분석은 그대로 진행되어야 하고,
 * 분석 응답 시간에 이 호출이 얹히지 않게 하려는 것이다.
 *
 * 경계를 만들지 못하면 `boundary: null`과 이유를 돌려준다.
 * 화면은 그 상태를 그대로 표시하고, 없는 경계를 임의로 그리지 않는다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parcelId = (params.get("parcelId") ?? "").trim();

  if (!parcelId) {
    return NextResponse.json(
      { ok: false, error: "필지 고유번호가 없습니다." },
      { status: 400 },
    );
  }
  // 시연 자료에는 실제 경계가 없다. 모양만 그려 실데이터처럼 보이게 하지 않는다.
  if (params.get("mode") !== "live") {
    return NextResponse.json({ ok: true, boundary: null, reason: "시연 자료에는 경계가 없습니다." });
  }

  try {
    const boundary = await fetchParcelBoundary(parcelId);
    return NextResponse.json({
      ok: true,
      boundary,
      reason: boundary ? null : "이 필지의 경계 자료를 찾지 못했습니다.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "경계 조회에 실패했습니다.";
    return NextResponse.json({ ok: true, boundary: null, reason: message });
  }
}

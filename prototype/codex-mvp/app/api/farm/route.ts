import { NextResponse } from "next/server";
import { verifiedParcelSearch } from "@/lib/cache/verifiedSnapshot";
import { createMockParcel } from "@/lib/mock/data";
import { fetchFarmMapCandidates } from "@/lib/public-data/client";
import { selectionFromSearch } from "@/lib/public-data/request";
import type { AnalysisSelection, ParcelSearch } from "@/types/domain";

/**
 * 팜맵 후보 조회.
 *
 * 후보를 만들지 못하면 사용자가 필지를 확정할 수 없고, 그 뒤 토양·기상 단계의 대체 경로에도
 * 도달하지 못한다. 그래서 실시간 조회가 실패하면 검증 스냅샷의 필지를 후보로 내놓아
 * 분석까지 이어지게 한다.
 *
 * 대체를 실시간처럼 보이게 하지 않는다. `status`로 출처를 구분하고 실패 이유를 함께 실어 보내며,
 * 좌표에 맞는 스냅샷이 없으면 실패를 그대로 알린다. 조용히 시연 자료로 넘어가지 않는다.
 */

function mockSearch(selection: AnalysisSelection): ParcelSearch {
  const mock = createMockParcel(selection);
  return {
    candidates: [
      {
        address: mock.address,
        parcelId: mock.parcelId,
        farmMapId: mock.farmMapId ?? "시연용 농지번호",
        interpretation: mock.interpretation,
        observedAt: mock.observedAt,
      },
    ],
    candidateCount: 1,
    radiusM: 250,
    requiresRefinement: false,
    status: "mock",
    source: "시연 자료",
    liveFailure: null,
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const selection = selectionFromSearch(params);

    if (params.get("mode") !== "live") {
      return NextResponse.json({ ok: true, data: mockSearch(selection) });
    }

    try {
      const live = await fetchFarmMapCandidates(selection);
      return NextResponse.json({ ok: true, data: live });
    } catch (liveError) {
      const reason =
        liveError instanceof Error ? liveError.message : "팜맵 실시간 조회에 실패했습니다.";
      const cached = verifiedParcelSearch(selection);
      if (!cached) {
        return NextResponse.json({ ok: false, error: reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true, data: { ...cached, liveFailure: reason } });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "팜맵 조회에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

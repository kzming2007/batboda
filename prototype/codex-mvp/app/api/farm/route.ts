import { NextResponse } from "next/server";
import { createMockParcel } from "@/lib/mock/data";
import { fetchFarmMapCandidates } from "@/lib/public-data/client";
import { selectionFromSearch } from "@/lib/public-data/request";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const selection = selectionFromSearch(params);
    const mock = createMockParcel(selection);
    const data = params.get("mode") === "live"
      ? await fetchFarmMapCandidates(selection)
      : {
          candidates: [{
            address: mock.address,
            parcelId: mock.parcelId,
            farmMapId: mock.farmMapId ?? "시연용 농지번호",
            interpretation: mock.interpretation,
            observedAt: mock.observedAt,
          }],
          candidateCount: 1,
          radiusM: 250,
          requiresRefinement: false,
        };
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "팜맵 조회에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { createMockSoil } from "@/lib/mock/data";
import { fetchSoil } from "@/lib/public-data/client";
import { selectionFromSearch } from "@/lib/public-data/request";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const selection = selectionFromSearch(params);
    const data = params.get("mode") === "live"
      ? await fetchSoil(selection)
      : createMockSoil(selection);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "토양 조회에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

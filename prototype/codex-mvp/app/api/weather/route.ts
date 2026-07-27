import { NextResponse } from "next/server";
import { createMockWeather } from "@/lib/mock/data";
import { fetchWeather } from "@/lib/public-data/client";
import { selectionFromSearch } from "@/lib/public-data/request";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const selection = selectionFromSearch(params);
    const data = params.get("mode") === "live"
      ? await fetchWeather(selection)
      : createMockWeather(selection);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "기상 조회에 실패했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

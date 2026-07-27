import { NextResponse } from "next/server";
import { hasPublicDataKey } from "@/lib/public-data/client";

export async function GET() {
  return NextResponse.json({
    configured: hasPublicDataKey(),
    defaultMode: process.env.PUBLIC_DATA_MODE === "live" ? "live" : "mock",
  });
}

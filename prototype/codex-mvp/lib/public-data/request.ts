import type { AnalysisSelection, CropId } from "@/types/domain";
import { cropProfiles } from "@/lib/analysis/cropProfiles";
import { validateCoordinates } from "@/lib/public-data/geo";

export function parseSelection(value: unknown): AnalysisSelection {
  if (typeof value !== "object" || value === null) {
    throw new Error("분석 입력이 올바르지 않습니다.");
  }
  const source = value as Record<string, unknown>;
  const lat = Number(source.lat);
  const lng = Number(source.lng);
  const cropId = String(source.cropId ?? "") as CropId;
  const horizonDays = Number(source.horizonDays);
  const optionalText = (key: string) => {
    const value = source[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };

  if (!validateCoordinates(lat, lng)) {
    throw new Error("대한민국 범위 안의 농지 위치를 선택해 주세요.");
  }
  if (!(cropId in cropProfiles)) {
    throw new Error("지원하는 작물을 선택해 주세요.");
  }
  if (horizonDays !== 1 && horizonDays !== 3) {
    throw new Error("분석 기간은 1일 또는 3일만 선택할 수 있습니다.");
  }
  return {
    lat,
    lng,
    cropId,
    horizonDays,
    parcelId: optionalText("parcelId"),
    farmMapId: optionalText("farmMapId"),
    parcelAddress: optionalText("parcelAddress"),
    parcelInterpretation: optionalText("parcelInterpretation"),
  };
}

export function selectionFromSearch(params: URLSearchParams): AnalysisSelection {
  // 필지 정보까지 받아야 확정된 필지로 토양을 조회한다. 없으면 좌표만으로 분석한다.
  return parseSelection({
    lat: params.get("lat"),
    lng: params.get("lng"),
    cropId: params.get("cropId") ?? "potato",
    horizonDays: params.get("horizonDays") ?? "3",
    parcelId: params.get("parcelId"),
    farmMapId: params.get("farmMapId"),
    parcelAddress: params.get("parcelAddress"),
    parcelInterpretation: params.get("parcelInterpretation"),
  });
}

import type {
  AnalysisSelection,
  ParcelCandidate,
  ParcelData,
  SoilData,
} from "@/types/domain";

export function reconcileParcel(
  candidates: ParcelCandidate[],
  soil: SoilData | null,
  warnings: string[],
  selection?: AnalysisSelection,
): ParcelData {
  const userConfirmed = selection?.parcelId
    ? candidates.find((candidate) =>
        candidate.parcelId === selection.parcelId &&
        (!selection.farmMapId || candidate.farmMapId === selection.farmMapId),
      )
    : undefined;
  if (selection?.parcelId && !userConfirmed) {
    warnings.push("고른 농지의 필지번호가 지금 좌표의 후보 목록에 없습니다. 농지를 다시 확인해 주세요.");
  }
  const matched = soil
    ? candidates.find((candidate) =>
        (soil.parcelId && candidate.parcelId === soil.parcelId) ||
        (soil.farmMapId && candidate.farmMapId === soil.farmMapId),
      )
    : undefined;
  const selected = userConfirmed ?? matched ?? (candidates.length === 1 ? candidates[0] : undefined);

  if (selected) {
    return {
      ...selected,
      candidateCount: candidates.length,
      selectionStatus: "matched",
      status: "connected",
      source: "농림축산식품부 팜맵",
    };
  }

  warnings.push(
    soil
      ? `토양 자료의 필지와 주변 농지 후보 ${candidates.length}개가 같은 땅인지 확인하지 못했습니다. 농지를 직접 확인해 주세요.`
      : `주변 농지 후보가 ${candidates.length}개여서 자동으로 고르지 않았습니다.`,
  );
  return {
    address: `선택 좌표 반경 1km · 농지 후보 ${candidates.length}개`,
    parcelId: "농지 미확정",
    farmMapId: null,
    interpretation: "농지를 직접 확인해 주세요",
    candidateCount: candidates.length,
    selectionStatus: "needs_confirmation",
    status: "connected",
    source: "농림축산식품부 팜맵",
    observedAt: candidates[0]?.observedAt ?? "조회 시점 기준",
  };
}

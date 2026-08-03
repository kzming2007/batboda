import { registerReportProvider } from "@/lib/report/provider";
import {
  bundleForReplay,
  bundleKey,
  findLlmResponse,
  llmSnapshotSummary,
  readableDate,
  readableModelName,
  replayableFor,
} from "@/lib/report/snapshots/llmSnapshot";

/**
 * 실호출 응답 재생 제공자.
 *
 * 저장된 응답은 실제 모델이 만든 문장이며, 재생할 때도 매번 같은 출력 검증을 거친다.
 * 화면에는 실시간 생성이 아니라 저장된 응답이라는 사실과 수집 시각을 함께 표시한다.
 * 저장된 조합이 없으면 실패로 처리해 규칙 기반 설명으로 내려간다. 없는 응답을 지어내지 않는다.
 */

export function registerReplayProvider() {
  const summary = llmSnapshotSummary();
  if (!summary) return false;

  const modelLabel = summary.models.map(readableModelName).join(", ");

  registerReportProvider({
    name: `${modelLabel}`,
    // 조합에 맞는 응답을 찾지 못한 경우에만 쓰이는 값이다. 이때는 검사 단계까지 가지 않는다.
    successLabel: `AI 설명 · ${modelLabel} · 검사 통과`,
    // 배지에는 이 조합에 실제로 쓴 응답의 모델과 수집 시각을 적는다.
    // 스냅샷 전체의 최신 날짜를 쓰면 7월에 받은 문장에 8월 날짜가 붙는다.
    resolveSuccessLabel({ bundle }) {
      const record = findLlmResponse(bundle);
      if (!record || !replayableFor(record, bundle).ok) return null;
      return (
        `AI 설명 · ${readableModelName(record.model)} · ` +
        `${readableDate(record.collectedAt.slice(0, 10))} 작성 · 검사 통과`
      );
    },
    // 저장본은 수집 시점 근거로 숫자를 대조한다. 오늘 예보로 대조하면 갱신된 만큼 걸린다.
    resolveValidationBundle({ bundle }) {
      const record = findLlmResponse(bundle);
      if (!record || !replayableFor(record, bundle).ok) return null;
      return bundleForReplay(record, bundle);
    },
    async generate({ bundle }) {
      const record = findLlmResponse(bundle);
      if (!record) {
        throw new Error(`이 농지·작물 조합으로 저장해 둔 AI 설명이 없습니다(${bundleKey(bundle)}).`);
      }
      // 판정이 바뀌었으면 옛 문장을 내보내지 않는다. 화면 머리글과 결론이 어긋난다.
      const replayable = replayableFor(record, bundle);
      if (!replayable.ok) {
        throw new Error(`저장본을 쓸 수 없습니다. ${replayable.reason}`);
      }
      return record.draft;
    },
  });
  return true;
}

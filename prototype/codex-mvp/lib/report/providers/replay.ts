import { registerReportProvider } from "@/lib/report/provider";
import {
  bundleKey,
  findLlmResponse,
  llmSnapshotSummary,
  readableDate,
  readableModelName,
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
    successLabel: `AI 설명 · ${modelLabel} · ${readableDate(summary.collectedAt)} 작성 · 검사 통과`,
    async generate({ bundle }) {
      const record = findLlmResponse(bundle);
      if (!record) {
        throw new Error(`이 농지·작물 조합으로 저장해 둔 AI 설명이 없습니다(${bundleKey(bundle)}).`);
      }
      return record.draft;
    },
  });
  return true;
}

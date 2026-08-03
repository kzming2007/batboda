import { registerReportProvider } from "@/lib/report/provider";
import { geminiGenerate, GEMINI_MODEL } from "@/lib/report/providers/gemini";
import {
  bundleForReplay,
  findLlmResponse,
  llmSnapshotSummary,
  readableDate,
  readableModelName,
  replayableFor,
} from "@/lib/report/snapshots/llmSnapshot";

/**
 * 저장본 우선, 없으면 실시간 호출.
 *
 * `replay`는 저장된 조합만 답하고 나머지는 규칙 문장으로 내려간다. `gemini`는 항상 실시간으로
 * 부르는 대신 무료 한도에 걸리면 아무 조합도 답하지 못한다. 시연에서는 두 성질이 모두 필요하다.
 *
 * - 미리 저장해 둔 시연 조합 → 재생. 한도·네트워크와 무관하게 항상 같은 문장이 나온다.
 * - 그 밖의 조합 → 실시간 호출. 심사위원이 다른 농지를 골라도 AI 문장이 나온다.
 * - 한도 초과나 호출 실패 → 규칙 문장으로 내려가고 실패 사유를 화면에 적는다.
 *
 * 저장본도 실시간 응답과 똑같이 다섯 항목 검사를 거친다. 재생이라는 사실과 수집 시각은
 * 배지에 그대로 표시하므로, 실시간 생성처럼 보이게 하지 않는다.
 */

/** 저장본이 있고 지금 판정과도 맞을 때만 돌려준다. 어긋나면 실시간 경로로 넘긴다. */
function usableRecord(bundle: Parameters<typeof findLlmResponse>[0]) {
  const record = findLlmResponse(bundle);
  if (!record) return null;
  return replayableFor(record, bundle).ok ? record : null;
}

export function registerReplayThenLiveProvider() {
  const summary = llmSnapshotSummary();
  const hasKey = Boolean(process.env.GEMINI_API_KEY);

  // 저장본도 없고 키도 없으면 이 제공자로 할 수 있는 일이 없다.
  if (!summary && !hasKey) return false;

  const snapshotLabel = summary ? summary.models.map(readableModelName).join(", ") : null;
  const liveLabel = readableModelName(GEMINI_MODEL);

  registerReportProvider({
    name: snapshotLabel && snapshotLabel !== liveLabel ? `${liveLabel} · 저장본 ${snapshotLabel}` : liveLabel,
    successLabel: `AI 설명 · ${liveLabel} · 검사 통과`,
    resolveSuccessLabel({ bundle }) {
      const record = usableRecord(bundle);
      if (!record) return `AI 설명 · ${liveLabel} · 실시간 생성 · 검사 통과`;
      return (
        `AI 설명 · ${readableModelName(record.model)} · ` +
        `${readableDate(record.collectedAt.slice(0, 10))} 작성 · 검사 통과`
      );
    },
    resolveValidationBundle({ bundle }) {
      const record = usableRecord(bundle);
      return record ? bundleForReplay(record, bundle) : null;
    },
    async generate({ system, user, bundle }) {
      const record = usableRecord(bundle);
      if (record) return record.draft;
      if (!hasKey) {
        const stale = findLlmResponse(bundle);
        const why = stale ? replayableFor(stale, bundle).reason : null;
        throw new Error(
          why
            ? `저장본을 쓸 수 없고 실시간 호출 키도 설정되지 않았습니다. ${why}`
            : "저장해 둔 AI 설명이 없고 실시간 호출 키도 설정되지 않았습니다.",
        );
      }
      return geminiGenerate({ system, user });
    },
  });
  return true;
}

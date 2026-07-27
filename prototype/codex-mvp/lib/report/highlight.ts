import type { AnalysisResult, ShowcaseHighlight } from "@/types/domain";

/**
 * 설명 문장에서 강조할 표현을 규칙으로 고른다.
 *
 * 화면이 스스로 중요한 말을 고르지 않는다. 규칙 엔진이 확정한 값과 공식 기준,
 * 그리고 한계를 알리는 표현만 목록에 넣고, 문장에 실제로 있는 것만 남긴다.
 * 색 의미는 판정서 3열과 같다. 실측값=골드, 공식 기준=딥그린, 주의·한계=클레이 레드.
 */

const CAUTION_PHRASES = [
  "성공 가능성",
  "수확량",
  "참고 판단",
  "농업기술센터",
  "차이가 있을 수 있습니다",
  "낙관하지 않습니다",
  "자료 없음",
  "확인 필요",
];

export function highlightsFor(text: string, result: AnalysisResult): ShowcaseHighlight[] {
  const found: ShowcaseHighlight[] = [];
  const seen = new Set<string>();

  const add = (phrase: string | null | undefined, kind: ShowcaseHighlight["kind"]) => {
    const trimmed = (phrase ?? "").trim();
    if (trimmed.length < 2 || seen.has(trimmed)) return;
    if (!text.includes(trimmed)) return;
    seen.add(trimmed);
    found.push({ text: trimmed, kind });
  };

  // 값이 비어 있음을 알리는 표기는 실측값이 아니라 한계다. 골드로 강조하면 값이 있는 것처럼 보인다.
  const missingMarks = ["자료 없음", "이상치 제외", "확인 필요", "미확인"];
  for (const factor of result.factors) {
    add(factor.value, missingMarks.includes(factor.value.trim()) ? "caution" : "value");
    add(factor.target, "official");
  }
  add(result.suitabilityLabel, "value");
  add(result.riskLabel, "caution");
  for (const phrase of CAUTION_PHRASES) add(phrase, "caution");

  return found;
}

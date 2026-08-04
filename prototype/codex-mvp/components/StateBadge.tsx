import type { FactorState } from "@/types/domain";

/**
 * 상태를 글자 대신 부호로 먼저 읽히게 한다.
 *
 * 이모지를 쓰지 않는다. 운영체제마다 그림이 달라 판정서 인상이 기기마다 바뀌고 크기도 맞추기 어렵다.
 * 기하 부호는 어디서나 같은 모양으로 나오고 색·굵기를 화면 문법에 맞출 수 있다.
 *
 * 색만으로 뜻을 싣지 않는다. 부호와 이름표가 색 없이도 같은 말을 한다.
 * 상태 판단은 규칙 엔진이 준 `state`를 그대로 옮긴다. 화면이 다시 판단하지 않는다.
 */
export type BadgeTone = "good" | "watch" | "bad" | "info";

export const badgeGlyph: Record<BadgeTone, string> = {
  good: "✓",
  watch: "!",
  bad: "▲",
  info: "–",
};

export const factorBadge: Record<FactorState, { tone: BadgeTone; label: string }> = {
  good: { tone: "good", label: "기준 안" },
  watch: { tone: "watch", label: "확인 필요" },
  risk: { tone: "bad", label: "기준 밖" },
  // 값이 없으면 기준과 견줄 수가 없다. `자료 없음`이라고 또 적으면 큰 글자와 같은 말을 두 번 한다.
  unknown: { tone: "info", label: "기준 대조 못 함" },
  info: { tone: "info", label: "참고" },
};

export function toneForState(state: FactorState | undefined): BadgeTone {
  return factorBadge[state ?? "unknown"].tone;
}

export function StateBadge({ state }: { state: FactorState | undefined }) {
  const badge = factorBadge[state ?? "unknown"];
  return (
    <span className={`state-badge ${badge.tone}`}>
      <i aria-hidden="true">{badgeGlyph[badge.tone]}</i>
      {badge.label}
    </span>
  );
}

/**
 * 판정서 머리 아래에 상태를 한 줄로 모아 둔다. 훑기만 해도 무엇이 걸리는지 보이게 한다.
 *
 * 값 자체가 무엇에 대한 것인지 말하고 있으면 이름표를 붙이지 않는다.
 * `근거 · 근거 충분`처럼 같은 말이 두 번 나오면 읽는 눈이 한 번 멈춘다.
 */
export function StatusChip({
  tone,
  name,
  value,
}: {
  tone: BadgeTone;
  name?: string;
  value: string;
}) {
  return (
    <span className={`status-chip ${tone}`}>
      <i aria-hidden="true">{badgeGlyph[tone]}</i>
      {name && <span>{name}</span>}
      <strong>{value}</strong>
    </span>
  );
}

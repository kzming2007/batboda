import { registerReportProvider } from "@/lib/report/provider";
import { REPORT_SECTIONS } from "@/lib/report/contract";
import type { ReportBundle } from "@/lib/report/bundle";

/**
 * 예시 문안 제공자.
 *
 * 실제 LLM이 아니다. 제공자를 연결했을 때 어떤 문장이 이 자리에 들어오는지 보여주고,
 * 그 문장이 실제 검증(판정 인용·금지 표현·근거 밖 숫자·구성·길이)을 통과하는지 확인하기 위한 경로다.
 * 화면에는 `예시 문안`임을 그대로 표시한다.
 *
 * 문장에 쓰는 값은 모두 근거 묶음에서만 가져온다. 새 수치나 기준을 만들지 않는다.
 */

function curatedDraft(bundle: ReportBundle) {
  const outOfRange = bundle.keyFactors.filter((factor) => factor.state === "기준 밖");
  const watch = bundle.keyFactors.filter((factor) => factor.state === "주의");
  const highlight = [...outOfRange, ...watch].slice(0, 2);

  const conclusion =
    `${bundle.parcel.address}에 ${bundle.crop}를 심는 조건은 지금 조회한 자료로 ${bundle.stage}입니다. ` +
    `가까운 ${bundle.horizonDays}일 사이 위험은 ${bundle.riskLabel} 수준입니다.`;

  const ground =
    highlight.length > 0
      ? highlight
          .map(
            (factor) =>
              `${factor.label}은 ${factor.value}이고 공식 기준은 ${factor.target}입니다. ${factor.impact}.`,
          )
          .join(" ")
      : "확인한 항목이 모두 공식 기준 안에 있었습니다.";

  const limits = bundle.limits.slice(0, 2).join(" ");

  return [
    `${REPORT_SECTIONS[0]}`,
    conclusion,
    "",
    `${REPORT_SECTIONS[1]}`,
    `${ground} 자료 상태는 ${bundle.dataStatus.label}입니다.`,
    "",
    `${REPORT_SECTIONS[2]}`,
    limits,
  ].join("\n");
}

export function registerCuratedProvider() {
  registerReportProvider({
    name: "예시 문안",
    successLabel: "예시 문안 · 사람이 작성 · AI 미연결 · 검사 통과",
    async generate({ bundle }) {
      return curatedDraft(bundle);
    },
  });
  return true;
}

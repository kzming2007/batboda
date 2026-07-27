import { registerReportProvider } from "@/lib/report/provider";
import { REPORT_SECTIONS } from "@/lib/report/contract";

/**
 * 검증 차단 확인용 제공자.
 *
 * 규칙을 일부러 어긴 문장을 넣는다. 근거 묶음에 없는 점수, 금지된 수확량·확률 표현,
 * 규칙 엔진이 정하지 않은 판정 단계를 포함한다.
 * 이 문장은 화면에 나가지 못하고 규칙 기반 문장으로 대체되어야 하며, 실패 사유가 화면에 표시된다.
 * 시연과 회귀 확인 용도이며 배포 기본값이 아니다.
 */

const TAMPERED_DRAFT = [
  REPORT_SECTIONS[0],
  "이 농지의 적합도는 987점으로 재배에 아주 적합합니다. 올해는 성공 확률이 높습니다.",
  "",
  REPORT_SECTIONS[1],
  "수확량은 평년 대비 크게 늘어날 것으로 보이며, 병해는 예방 약제 처방으로 막을 수 있습니다.",
  "",
  REPORT_SECTIONS[2],
  "특별히 확인할 점은 없습니다.",
].join("\n");

export function registerTamperedProvider() {
  registerReportProvider({
    name: "검증 차단 확인용 문장",
    async generate() {
      return TAMPERED_DRAFT;
    },
  });
  return true;
}

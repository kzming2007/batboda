import type { ReportBundle } from "@/lib/report/bundle";

/**
 * 설명 생성 제공자 자리.
 *
 * 현재는 어떤 LLM도 연결하지 않았다. 제공자·키·비용을 팀이 확정하면
 * `registerReportProvider()`로 어댑터 하나만 등록하면 되고, 계약·검증·대체 경로는 그대로 쓴다.
 * 제공자가 없으면 `resolveReportProvider()`가 이유와 함께 null을 돌려주고
 * 화면은 같은 근거의 규칙 기반 설명을 그대로 보여준다.
 */
export type ReportProviderInput = {
  system: string;
  user: string;
  /** 규칙 엔진이 확정한 근거 묶음. 실제 LLM 제공자는 프롬프트만 쓰고 이 값은 무시한다. */
  bundle: ReportBundle;
};

export type ReportProvider = {
  name: string;
  /**
   * 화면 배지 문구. 실시간 생성이 아닌 제공자는 그 사실이 드러나는 문구를 직접 지정한다.
   * 지정하지 않으면 `AI 설명(<name> · 검증 통과)`으로 표시한다.
   */
  successLabel?: string;
  /** 프롬프트를 받아 설명 초안 문자열만 돌려준다. 판정·수치 변경 여부는 이후 검증에서 확인한다. */
  generate: (input: ReportProviderInput) => Promise<string>;
};

let provider: ReportProvider | null = null;

export function registerReportProvider(next: ReportProvider) {
  provider = next;
}

export type ProviderResolution =
  | { provider: ReportProvider; reason: null }
  | { provider: null; reason: string };

export function resolveReportProvider(): ProviderResolution {
  if (provider) return { provider, reason: null };

  const configuredName = process.env.LLM_PROVIDER;
  if (!configuredName || configuredName === "none") {
    return {
      provider: null,
      reason: "설명을 만들 AI를 연결하지 않아, 규칙이 만든 문장을 그대로 씁니다.",
    };
  }
  return {
    provider: null,
    reason: `설정된 AI '${configuredName}'를 불러오지 못해, 규칙이 만든 문장을 그대로 씁니다.`,
  };
}

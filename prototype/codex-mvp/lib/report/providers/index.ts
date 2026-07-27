import { registerAnthropicProvider } from "@/lib/report/providers/anthropic";
import { registerCuratedProvider } from "@/lib/report/providers/curated";
import { registerGeminiProvider } from "@/lib/report/providers/gemini";
import { registerReplayProvider } from "@/lib/report/providers/replay";
import { registerTamperedProvider } from "@/lib/report/providers/tampered";

/**
 * 설명 생성 제공자 선택.
 *
 * `LLM_PROVIDER` 환경변수로 고르고, 값이 없거나 `none`이면 아무 제공자도 등록하지 않는다.
 * 그 경우 화면은 규칙 기반 설명을 그대로 쓴다.
 *
 * - `anthropic` : Claude 실시간 호출. 인증키가 있을 때만 등록된다.
 * - `gemini`    : Gemini 실시간 호출. 인증키가 있을 때만 등록된다.
 * - `replay`    : 저장해 둔 실호출 응답 재생. 저장된 조합이 없으면 규칙 기반으로 내려간다.
 * - `curated`   : 예시 문안. 실제 LLM이 아니며 화면에 그대로 표시한다.
 * - `tampered`  : 규칙 위반 문장. 검증이 막는지 확인하는 용도다.
 */

let initialized = false;

export function setupReportProvider() {
  if (initialized) return;
  initialized = true;

  switch (process.env.LLM_PROVIDER) {
    case "anthropic":
      registerAnthropicProvider();
      break;
    case "gemini":
      registerGeminiProvider();
      break;
    case "replay":
      registerReplayProvider();
      break;
    case "curated":
      registerCuratedProvider();
      break;
    case "tampered":
      registerTamperedProvider();
      break;
    default:
      break;
  }
}

setupReportProvider();

import { registerReportProvider } from "@/lib/report/provider";
import { readableModelName } from "@/lib/report/snapshots/llmSnapshot";

/**
 * Google Gemini 제공자.
 *
 * 무료 사용 한도가 있는 AI Studio 키로 실제 생성을 붙이기 위한 어댑터다.
 * 키가 없으면 등록하지 않는다. 의존성을 늘리지 않으려고 SDK 대신 fetch로 호출한다.
 * 키는 서버 환경변수로만 읽고 클라이언트로 내려보내지 않는다.
 *
 * 생성 결과는 다른 제공자와 똑같이 출력 검증을 거친다.
 * 판정·수치를 바꾸거나 근거 밖 숫자를 쓰면 규칙 기반 문장으로 대체된다.
 */

// gemini-2.5-flash는 2026-08-04부터 신규 프로젝트에서 404로 거부된다(실측). 유료 전환하며 프로젝트를
// 새로 만들면 쓸 수 없으므로 기본값을 옮겼다. 3.6 계열은 thinkingBudget:0을 거부해 사고 과정이 항상
// 붙고 호출이 4초를 넘는다. 3.5-flash는 사고를 끌 수 있어 1.4초로 끝난다(실측).
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";

/**
 * 먼저 부른 모델이 과부하로 거부할 때 이어서 부를 모델.
 *
 * 2026-08-04 저녁 `gemini-3.5-flash`가 `experiencing high demand`로 3회 연속 503을 냈다.
 * 같은 시각 `gemini-3.1-flash-lite`는 3회 모두 응답했다. 한 모델만 부르면 그 시간대에
 * 모든 설명이 규칙 문장으로 내려간다. 시연 도중 이 상태가 되면 AI를 붙였다는 말이 무색해진다.
 *
 * 예비 모델은 지시 준수력이 낮아 검사에 걸릴 확률이 높지만, 걸리면 규칙 문장으로 되돌아가므로
 * 화면이 틀린 말을 하지는 않는다. 아무 문장도 못 만드는 것보다 낫다.
 */
const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.1-flash-lite")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/**
 * 다시 불러 볼 만한 실패인지 본다.
 *
 * 과부하(503)와 요청량 초과(429)는 모델을 바꾸면 풀린다. 400·404는 요청 자체나 모델 접근이
 * 잘못된 것이라 다른 모델에서도 같은 이유로 막히거나, 막히지 않더라도 원인을 덮어 버린다.
 * 안전 차단은 문장 내용 문제이므로 모델을 바꿔 우회하지 않는다.
 */
function worthAnotherModel(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function callGemini(model: string, input: { system: string; user: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.user }] }],
      generationConfig: {
        temperature: 0.2,
        // 설명은 세 부분 2~3문장이라 길지 않지만, 사고 과정이 출력 한도를 먼저 소진하지 않도록 여유를 둔다.
        maxOutputTokens: 2400,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  const body = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    const reason = body.error?.message ?? `설명 생성 호출이 실패했습니다(HTTP ${response.status}).`;
    throw new GeminiCallError(reason, response.status);
  }
  if (body.promptFeedback?.blockReason) {
    throw new Error(`설명 생성이 차단되었습니다(${body.promptFeedback.blockReason}).`);
  }

  const finishReason = body.candidates?.[0]?.finishReason;
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new Error(
      finishReason === "MAX_TOKENS"
        ? "출력 한도 안에서 문장을 끝내지 못했습니다."
        : `설명 생성 응답이 비어 있습니다(${finishReason ?? "이유 미상"}).`,
    );
  }
  return text;
}

class GeminiCallError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * 실제 호출부. 제공자 등록과 스냅샷 수집 라우트가 같은 경로를 쓴다.
 *
 * **어느 모델이 답했는지 함께 돌려준다.** 배지와 저장본에 모델 이름을 적는데, 예비 모델로
 * 넘어간 것을 모르면 화면이 부르지도 않은 모델을 말한다.
 */
export async function geminiGenerate(input: { system: string; user: string }) {
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS.filter((name) => name !== GEMINI_MODEL)];
  const tried: string[] = [];

  for (const [index, model] of models.entries()) {
    const last = index === models.length - 1;
    try {
      return { text: await callGemini(model, input), model };
    } catch (error) {
      tried.push(`${model}: ${error instanceof Error ? error.message : "알 수 없는 오류"}`);
      const retryable = error instanceof GeminiCallError && worthAnotherModel(error.status);
      if (last || !retryable) {
        // 무엇을 어떤 순서로 시도했는지 남긴다. 화면의 실패 사유에 그대로 실린다.
        throw new Error(tried.join(" \\ "));
      }
    }
  }

  throw new Error("설명을 만들 모델이 없습니다.");
}

export function registerGeminiProvider() {
  if (!process.env.GEMINI_API_KEY) return false;

  registerReportProvider({
    name: readableModelName(GEMINI_MODEL),
    async generate({ system, user }) {
      return (await geminiGenerate({ system, user })).text;
    },
  });
  return true;
}

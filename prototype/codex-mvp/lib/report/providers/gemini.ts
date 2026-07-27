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

// 무료 사용 한도가 붙는 모델을 기본값으로 둔다. 최신 모델은 무료 한도가 없어 호출이 거부된다.
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** 실제 호출부. 제공자 등록과 스냅샷 수집 라우트가 같은 경로를 쓴다. */
export async function geminiGenerate(input: { system: string; user: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
    throw new Error(body.error?.message ?? `설명 생성 호출이 실패했습니다(HTTP ${response.status}).`);
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

export function registerGeminiProvider() {
  if (!process.env.GEMINI_API_KEY) return false;

  registerReportProvider({
    name: readableModelName(GEMINI_MODEL),
    async generate({ system, user }) {
      return geminiGenerate({ system, user });
    },
  });
  return true;
}

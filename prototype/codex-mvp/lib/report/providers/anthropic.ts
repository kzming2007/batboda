import { registerReportProvider } from "@/lib/report/provider";

/**
 * 실시간 LLM 제공자.
 *
 * 인증키가 있을 때만 등록한다. 키가 없으면 아무 일도 하지 않고, 화면은 규칙 기반 설명을 그대로 쓴다.
 * 의존성을 늘리지 않으려고 SDK 대신 fetch로 호출한다.
 * 키는 서버 환경변수로만 읽고 클라이언트로 내려보내지 않는다.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

type AnthropicResponse = {
  stop_reason?: string;
  content?: { type: string; text?: string }[];
  error?: { message?: string };
};

export function registerAnthropicProvider() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return false;

  registerReportProvider({
    name: MODEL,
    async generate({ system, user }) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          output_config: { effort: "low" },
          system,
          messages: [{ role: "user", content: user }],
        }),
      });

      const body = (await response.json()) as AnthropicResponse;
      if (!response.ok) {
        throw new Error(body.error?.message ?? `설명 생성 호출이 실패했습니다(HTTP ${response.status}).`);
      }
      if (body.stop_reason === "refusal") {
        throw new Error("설명 생성이 거부되었습니다.");
      }

      const text = (body.content ?? [])
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n")
        .trim();
      if (!text) throw new Error("설명 생성 응답이 비어 있습니다.");
      return text;
    },
  });
  return true;
}

import type { ReportBundle } from "@/lib/report/bundle";

/**
 * 설명 리포트 계약.
 * 1) 규칙 엔진의 근거 묶음만 입력으로 준다.
 * 2) 프롬프트에서 판정 변경·수치 생성·의학적/처방적 표현을 금지한다.
 * 3) 생성 결과를 검증한다.
 * 4) 검증에 실패하거나 제공자가 없으면 같은 근거의 규칙 기반 문장으로 대체한다.
 */

export const REPORT_SECTIONS = ["한 줄 결론", "왜 이렇게 나왔나", "함께 확인할 점"] as const;

/**
 * 금지 표현.
 * `강수확률`처럼 공식 데이터 항목 이름은 허용하고, 결과를 예측·보장·처방하는 표현만 막는다.
 */
export const FORBIDDEN_PHRASES = [
  "성공 확률",
  "성공확률",
  "발병 확률",
  "발병확률",
  "발생 확률",
  "발생확률",
  "감염 확률",
  "보장",
  "반드시 성공",
  "수확량은",
  "처방",
  "진단",
  "AI가 판단",
  "제 생각",
  "추천 품종",
];

export function reportSystemPrompt() {
  return [
    "당신은 초보 귀농인에게 농지 환경 분석 결과를 설명하는 역할만 맡는다.",
    "입력으로 받은 근거 묶음에 있는 사실만 사용한다. 새로운 수치, 기준, 작물 지식을 만들지 않는다.",
    "판정 단계와 위험 등급은 그대로 인용한다. 다른 단계로 바꾸거나 완화·강화하지 않는다.",
    "발생 확률, 수확량, 성공 보장, 병해 진단, 약제 처방을 쓰지 않는다.",
    `출력은 ${REPORT_SECTIONS.join(" / ")} 세 부분으로 쓰고 각 부분은 2~3문장으로 제한한다.`,
    "행동 지시는 이 세 부분에 넣지 않는다. 예방 행동은 화면의 행동 목록이 따로 보여준다.",
    "전문 용어를 쓸 때는 괄호로 쉬운 설명을 붙인다.",
    // 실제 모델 출력에서 판정 단계를 풀어 쓰다가 검증에 걸린 사례가 있어 형식을 명시한다.
    "판정 단계는 근거 묶음의 stage 값을 글자 그대로 한 번 이상 쓴다. 조사를 붙여 풀어 쓰거나 다른 말로 바꾸지 않는다.",
    "출력 형식은 아래와 같다. 부분 제목은 줄 맨 앞에 그대로 쓰고, 굵게 표시나 콜론, 목록 기호를 붙이지 않는다.",
    ...REPORT_SECTIONS.map((section) => `${section}\n(문장)`),
  ].join("\n");
}

export function reportUserPrompt(bundle: ReportBundle) {
  return [
    "다음 근거 묶음만 사용해 설명을 작성한다.",
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
  ].join("\n");
}

export type ReportValidation = {
  ok: boolean;
  failures: string[];
  checked: string[];
};

/** 생성된 설명이 규칙 결과를 왜곡하지 않았는지 확인한다. */
export function validateReport(draft: string, bundle: ReportBundle): ReportValidation {
  const failures: string[] = [];
  const checked = [
    "판정 그대로 인용",
    "금지 표현",
    "근거에 없는 숫자",
    "필수 구성",
    "길이",
  ];

  if (!draft.includes(bundle.stage)) {
    failures.push(`판정을 '${bundle.stage}' 그대로 쓰지 않고 바꿔 썼습니다.`);
  }
  for (const phrase of FORBIDDEN_PHRASES) {
    if (draft.includes(phrase)) failures.push(`쓰면 안 되는 표현 '${phrase}'이 있습니다.`);
  }
  const allowed = new Set(bundle.allowedNumbers);
  for (const match of draft.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowed.has(match[0])) {
      failures.push(`근거에 없는 숫자 '${match[0]}'을 새로 만들었습니다.`);
    }
  }
  const missingSections = REPORT_SECTIONS.filter((section) => !draft.includes(section));
  if (missingSections.length > 0) {
    failures.push(`빠진 부분이 있습니다: ${missingSections.join(", ")}`);
  }
  if (draft.trim().length < 60) failures.push("설명이 너무 짧습니다.");
  if (draft.length > 1200) failures.push("설명이 너무 깁니다.");

  return { ok: failures.length === 0, failures, checked };
}

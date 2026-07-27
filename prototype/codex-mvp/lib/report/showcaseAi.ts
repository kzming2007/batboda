import type { ReportBundle } from "@/lib/report/bundle";
import { FORBIDDEN_PHRASES } from "@/lib/report/contract";
import type { ShowcaseHighlight, ShowcaseReport } from "@/types/domain";

/**
 * 04 쉬운 말 리포트를 생성형 AI로 만드는 경로.
 *
 * 02 판정서의 짧은 설명과 같은 원칙을 쓰되, 형식이 길어 계약을 따로 둔다.
 * 1) 규칙 엔진이 확정한 근거 묶음만 입력으로 준다.
 * 2) 판정·수치를 바꾸거나 근거에 없는 숫자를 만들면 검사에서 막는다.
 * 3) 검사에 걸리거나 호출이 실패하면 사람이 써 둔 문안(`showcase.ts`)으로 되돌린다.
 *
 * 예방 행동 목록은 AI에게 맡기지 않는다. 규칙이 확정한 행동을 그대로 쓴다.
 */

export const SHOWCASE_SECTIONS = [
  "헤드라인",
  "이 땅의 흙은 어떤가요",
  "지금 날씨는 어떤 부담을 주나요",
  "이 판단의 한계",
  "마무리",
] as const;

export function showcaseSystemPrompt() {
  return [
    "당신은 농사를 처음 시작하는 사람에게 농지 환경 분석 결과를 풀어서 설명하는 역할만 맡는다.",
    "입력으로 받은 근거 묶음에 있는 사실만 사용한다. 새로운 수치, 기준, 작물 지식을 만들지 않는다.",
    "판정 단계는 근거 묶음의 stage 값을 글자 그대로 한 번 이상 쓴다. 조사를 붙여 풀어 쓰거나 다른 말로 바꾸지 않는다.",
    "발생 확률, 수확량, 성공 보장, 병해 진단, 약제 처방을 쓰지 않는다.",
    "전문 용어에는 괄호로 쉬운 설명을 붙인다. 예: 밭 적성등급(밭농사에 얼마나 맞는지 나눈 공식 등급)",
    "예방 행동 목록은 쓰지 않는다. 화면이 규칙이 정한 행동을 따로 보여준다.",
    `출력은 아래 다섯 부분으로 쓴다. 부분 제목을 줄 맨 앞에 그대로 쓰고, 굵게 표시나 콜론, 목록 기호를 붙이지 않는다.`,
    ...SHOWCASE_SECTIONS.map((section) => `${section}\n(문장)`),
    "헤드라인은 두 문장 이내, 흙과 날씨 부분은 각각 세 문장 이내, 한계와 마무리는 두 문장 이내로 쓴다.",
  ].join("\n");
}

export function showcaseUserPrompt(bundle: ReportBundle) {
  return [
    "다음 근거 묶음만 사용해 초보자용 설명을 작성한다.",
    "```json",
    JSON.stringify(bundle, null, 2),
    "```",
  ].join("\n");
}

export type ShowcaseValidation = { ok: boolean; failures: string[]; checked: string[] };

/** 생성된 리포트가 규칙 결과를 왜곡하지 않았는지 확인한다. 02와 같은 기준에 길이만 다르다. */
export function validateShowcaseDraft(draft: string, bundle: ReportBundle): ShowcaseValidation {
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
  const missing = SHOWCASE_SECTIONS.filter((section) => !draft.includes(section));
  if (missing.length > 0) failures.push(`빠진 부분이 있습니다: ${missing.join(", ")}`);
  if (draft.trim().length < 300) failures.push("설명이 너무 짧습니다.");
  if (draft.length > 2500) failures.push("설명이 너무 깁니다.");

  return { ok: failures.length === 0, failures, checked };
}

function sectionBody(draft: string, index: number) {
  const heading = SHOWCASE_SECTIONS[index];
  const start = draft.indexOf(heading);
  if (start === -1) return "";
  const next = SHOWCASE_SECTIONS[index + 1];
  const end = next ? draft.indexOf(next, start) : draft.length;
  return draft.slice(start + heading.length, end === -1 ? draft.length : end).trim();
}

/**
 * 색 강조를 규칙으로 뽑는다.
 * 실측값은 골드, 공식 기준은 딥그린, 주의·한계 표현은 클레이 레드로 표시한다.
 * 찾지 못하면 강조를 붙이지 않는다. 문장을 바꾸지는 않는다.
 */
function deriveHighlights(text: string, bundle: ReportBundle): ShowcaseHighlight[] {
  const found: ShowcaseHighlight[] = [];
  const seen = new Set<string>();
  const add = (phrase: string, kind: ShowcaseHighlight["kind"]) => {
    const trimmed = phrase.trim();
    if (trimmed.length < 2 || seen.has(trimmed)) return;
    if (!text.includes(trimmed)) return;
    seen.add(trimmed);
    found.push({ text: trimmed, kind });
  };

  const missingMarks = ["자료 없음", "이상치 제외", "확인 필요", "미확인"];
  for (const factor of bundle.keyFactors) {
    add(factor.value, missingMarks.includes(factor.value.trim()) ? "caution" : "value");
    add(factor.target, "official");
  }
  add(bundle.stage, "value");
  add(bundle.riskLabel, "caution");
  for (const phrase of [
    "성공 가능성",
    "수확량",
    "참고 판단",
    "농업기술센터",
    "차이가 있을 수 있습니다",
    "낙관하지 않습니다",
  ]) {
    add(phrase, "caution");
  }
  return found;
}

/** 검사를 통과한 초안을 04 화면 구조로 옮긴다. 내용은 바꾸지 않는다. */
export function parseShowcaseDraft(
  draft: string,
  bundle: ReportBundle,
  options: { caseLabel: string; originLabel: string },
): ShowcaseReport {
  const headline = sectionBody(draft, 0);
  const soil = sectionBody(draft, 1);
  const weather = sectionBody(draft, 2);
  const limit = sectionBody(draft, 3);
  const closing = sectionBody(draft, 4);

  return {
    caseLabel: options.caseLabel,
    curated: false,
    originLabel: options.originLabel,
    headline,
    blocks: [
      { id: "soil", heading: SHOWCASE_SECTIONS[1], body: soil },
      { id: "weather", heading: SHOWCASE_SECTIONS[2], body: weather },
      { id: "limit", heading: SHOWCASE_SECTIONS[3], body: limit },
    ],
    // 예방 행동은 규칙이 확정한 값을 그대로 쓴다. AI가 만들지 않는다.
    checklist: bundle.actions.map((action) => ({
      title: action.title,
      timing: action.timing,
      body: action.detail,
    })),
    closing,
    usedValues: bundle.keyFactors.map((factor) => `${factor.label} ${factor.value}`),
    highlights: deriveHighlights(draft, bundle),
  };
}

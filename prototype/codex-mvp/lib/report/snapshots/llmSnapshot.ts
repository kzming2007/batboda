import source from "@/lib/report/snapshots/llmResponses.json";
import type { ReportBundle } from "@/lib/report/bundle";

/**
 * 실호출 응답 스냅샷.
 *
 * 실제 제공자를 한 번 호출해 받은 응답을 저장해 두고, 같은 조합에서 그대로 재생한다.
 * 목적은 두 가지다.
 * 1) 네트워크나 사용 한도 때문에 시연 중 생성이 실패해도 같은 화면을 보여준다.
 * 2) 저장한 응답도 매번 같은 출력 검증을 거치므로 검증 계층이 실제로 동작하는 것을 보여준다.
 *
 * 사람이 쓴 문장은 여기에 넣지 않는다. 그건 `curated` 제공자가 따로 맡고, 화면 표기도 다르다.
 */

export type LlmResponseRecord = {
  /** 필지 주소 + 작물 + 기간으로 만든 조합 키 */
  key: string;
  /** 실제로 호출한 모델 이름 */
  model: string;
  /** 수집 시각 (ISO) */
  collectedAt: string;
  /** 모델이 돌려준 원문 */
  draft: string;
  /**
   * 수집 시점의 근거. 저장본은 그때의 예보 수치를 문장에 담고 있으므로
   * 오늘의 근거로 숫자를 검사하면 예보가 갱신된 만큼 실패한다.
   * 저장본은 저장 시점 근거와 짝이므로 그 값으로 검사한다.
   *
   * 판정과 위험 등급은 검사가 아니라 **재생 가능 여부**를 가리는 데 쓴다.
   * 저장 시점과 지금의 판정이 다르면 저장본을 쓰지 않는다. 화면 머리글은 오늘 판정을
   * 보여주는데 설명 문장이 옛 판정을 말하면 같은 화면에서 두 결론이 부딪친다.
   *
   * 이 필드가 없는 예전 기록은 오늘 근거로 검사한다.
   */
  capturedAt?: {
    stage: string;
    riskLabel: string;
    allowedNumbers: string[];
  };
};

type SnapshotFile = { note?: string; records: LlmResponseRecord[] };

const snapshot = source as SnapshotFile;

export function bundleKey(bundle: ReportBundle) {
  return `${bundle.parcel.address}|${bundle.crop}|${bundle.horizonDays}`;
}

/**
 * 저장본을 지금 화면에 쓸 수 있는지 본다.
 *
 * 판정이나 위험 등급이 바뀌었으면 쓰지 않는다. 예보가 달라져 판정이 뒤집히는 일은
 * 실제로 생기고, 그때 옛 문장을 그대로 내보내면 화면 머리글과 설명이 서로 다른 결론을 말한다.
 */
export function replayableFor(record: LlmResponseRecord, bundle: ReportBundle) {
  const captured = record.capturedAt;
  // 수집 시점 근거가 없는 기록은 쓰지 않는다. 오늘 근거로 숫자를 대조하면 예보가 갱신된 만큼
  // 검사에 걸려 규칙 문장으로 떨어지고, 저장본을 둔 의미가 없어진다.
  // 건너뛰면 `replay-live`가 실시간 경로로 넘어가므로 화면은 오히려 낫다. 다시 수집하면 살아난다.
  if (!captured) {
    return {
      ok: false as const,
      reason: "수집 시점 근거가 없는 예전 기록입니다. 다시 수집해야 재생할 수 있습니다.",
    };
  }
  if (captured.stage !== bundle.stage) {
    return {
      ok: false as const,
      reason: `저장할 때 판정이 '${captured.stage}'였는데 지금은 '${bundle.stage}'입니다.`,
    };
  }
  if (captured.riskLabel !== bundle.riskLabel) {
    return {
      ok: false as const,
      reason: `저장할 때 위험 등급이 '${captured.riskLabel}'였는데 지금은 '${bundle.riskLabel}'입니다.`,
    };
  }
  return { ok: true as const, reason: null };
}

/** 저장본을 검사할 때 쓸 근거. 수집 시점 값이 있으면 그것으로 대조한다. */
export function bundleForReplay(record: LlmResponseRecord, bundle: ReportBundle): ReportBundle {
  if (!record.capturedAt) return bundle;
  return { ...bundle, allowedNumbers: record.capturedAt.allowedNumbers };
}

export function findLlmResponse(bundle: ReportBundle): LlmResponseRecord | null {
  const key = bundleKey(bundle);
  return snapshot.records.find((record) => record.key === key) ?? null;
}

/** 04 쉬운 말 리포트는 같은 조합에 형식이 다르므로 키를 나눈다. */
export function showcaseKey(bundle: ReportBundle) {
  return `${bundleKey(bundle)}|showcase`;
}

export function findShowcaseResponse(bundle: ReportBundle): LlmResponseRecord | null {
  const key = showcaseKey(bundle);
  return snapshot.records.find((record) => record.key === key) ?? null;
}

export function llmSnapshotSummary() {
  const records = snapshot.records;
  if (records.length === 0) return null;
  const models = [...new Set(records.map((record) => record.model))];
  const collected = records
    .map((record) => record.collectedAt.slice(0, 10))
    .sort()
    .at(-1);
  return { count: records.length, models, collectedAt: collected ?? "" };
}

/** 모델 식별자를 읽는 이름으로 바꾼다. `gemini-2.5-flash` → `Gemini 2.5 Flash` */
export function readableModelName(id: string) {
  return id
    .split("-")
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/** `2026-07-26` → `7월 26일` */
export function readableDate(isoDate: string) {
  const [, month, day] = isoDate.split("-");
  if (!month || !day) return isoDate;
  return `${Number(month)}월 ${Number(day)}일`;
}

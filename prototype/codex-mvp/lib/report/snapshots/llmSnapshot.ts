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
};

type SnapshotFile = { note?: string; records: LlmResponseRecord[] };

const snapshot = source as SnapshotFile;

export function bundleKey(bundle: ReportBundle) {
  return `${bundle.parcel.address}|${bundle.crop}|${bundle.horizonDays}`;
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

import type { SoilData, SoilPhysicalProfile, SoilUseKind } from "@/types/domain";

type CodeTable = Readonly<Record<string, string>>;

/**
 * 적성등급 코드표.
 *
 * 밭(`Pfld_Grd_Cd`)·논(`Rfld_Grd_Cd`)·과수(`Fruit_Grd_Cd`)가 같은 1~5급지 체계를 쓴다.
 * 2026-08-04 실측 응답의 값도 모두 01~05 범위였다(85-61전 밭 02·논 03·과수 02,
 * 유방동 870답 밭 03·논 03·과수 04). 표에 없는 코드는 임의로 해석하지 않고
 * `미정의 코드 NN`으로 남긴다.
 */
const suitabilityGradeCodes = {
  "01": "1급지",
  "02": "2급지",
  "03": "3급지",
  "04": "4급지",
  "05": "5급지 · 부적합",
  "99": "기타",
} as const satisfies CodeTable;

/** 저해요인 코드표. 밭·논·과수 저해요인이 같은 코드 체계를 쓴다. */
const limitingFactorCodes = {
  "00": "제외",
  "01": "없음",
  "02": "경사",
  "03": "저습",
  "04": "사질",
  "05": "석력",
  "09": "중점",
  "10": "경반",
  "11": "암반",
  "13": "화산회",
  "14": "분석",
  "99": "기타",
} as const satisfies CodeTable;

export const soilV3CodeTables = {
  drainage: {
    "01": "매우 양호",
    "02": "양호",
    "03": "약간 양호",
    "04": "약간 불량",
    "05": "불량",
    "06": "매우 불량",
    "99": "기타",
  },
  effectiveDepth: {
    "01": "매우 얕음 · 0–25cm",
    "02": "얕음 · 25–50cm",
    "03": "보통 · 50–100cm",
    "04": "깊음 · 100cm 이상",
    "99": "기타",
  },
  topsoilTexture: {
    "01": "양질조사토",
    "02": "양질세사토",
    "03": "양질사토",
    "04": "세사양토",
    "05": "사양토",
    "06": "양토",
    "07": "미사질양토",
    "08": "미사질식양토",
    "09": "식양토",
    "99": "기타",
  },
  mainLandUse: {
    "01": "논",
    "02": "밭",
    "03": "과수·상전",
    "04": "초지",
    "05": "임지",
    "99": "기타",
  },
  useRecommendation: {
    "01": "논",
    "02": "밭",
    "03": "과수·상전",
    "04": "간이초지",
    "05": "집약초지",
    "06": "임지",
    "99": "기타",
  },
  uplandGrade: suitabilityGradeCodes,
  uplandLimitingFactor: limitingFactorCodes,
  paddyGrade: suitabilityGradeCodes,
  paddyLimitingFactor: limitingFactorCodes,
  orchardGrade: suitabilityGradeCodes,
  orchardLimitingFactor: limitingFactorCodes,
} as const satisfies Record<string, CodeTable>;

/**
 * 용도별 적성등급을 읽는 자리.
 *
 * 판정에 쓸 등급은 작물 종류가 정한다. 과수(사과·배)는 과수 등급, 밭작물은 밭 등급을 본다.
 * 논 등급은 지금 판정에 넣지 않고 값만 읽어 둔다.
 */
const soilUseKindTables: Record<
  SoilUseKind,
  {
    label: string;
    gradeField: keyof SoilPhysicalProfile;
    limitingFactorField: keyof SoilPhysicalProfile;
    gradeTable: CodeTable;
    limitingFactorTable: CodeTable;
  }
> = {
  upland: {
    label: "밭",
    gradeField: "uplandGradeCode",
    limitingFactorField: "uplandLimitingFactorCode",
    gradeTable: soilV3CodeTables.uplandGrade,
    limitingFactorTable: soilV3CodeTables.uplandLimitingFactor,
  },
  paddy: {
    label: "논",
    gradeField: "paddyGradeCode",
    limitingFactorField: "paddyLimitingFactorCode",
    gradeTable: soilV3CodeTables.paddyGrade,
    limitingFactorTable: soilV3CodeTables.paddyLimitingFactor,
  },
  orchard: {
    label: "과수",
    gradeField: "orchardGradeCode",
    limitingFactorField: "orchardLimitingFactorCode",
    gradeTable: soilV3CodeTables.orchardGrade,
    limitingFactorTable: soilV3CodeTables.orchardLimitingFactor,
  },
};

export function soilUseKindLabel(kind: SoilUseKind) {
  return soilUseKindTables[kind].label;
}

function normalizedCode(code: string | null | undefined) {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return /^\d$/.test(trimmed) ? trimmed.padStart(2, "0") : trimmed;
}

export function soilCodeLabel(table: CodeTable, code: string | null | undefined) {
  const normalized = normalizedCode(code);
  if (!normalized) return "확인되지 않음";
  return table[normalized] ?? `미정의 코드 ${normalized}`;
}

/** 용도별 적성등급을 판정 입력용 숫자로 돌려준다. 표에 없는 코드는 등급으로 쓰지 않는다. */
export function suitabilityGradeNumber(
  profile: SoilPhysicalProfile | null,
  kind: SoilUseKind,
) {
  const code = normalizedCode(profile?.[soilUseKindTables[kind].gradeField]);
  if (!code || !["01", "02", "03", "04", "05"].includes(code)) return null;
  return Number(code);
}

/** 해당 용도의 저해요인이 실질적으로 걸려 있는지. `제외`·`없음`은 걸린 것으로 보지 않는다. */
export function hasMaterialLimitingFactor(
  profile: SoilPhysicalProfile | null,
  kind: SoilUseKind,
) {
  const code = normalizedCode(profile?.[soilUseKindTables[kind].limitingFactorField]);
  return code !== null && !["00", "01"].includes(code);
}

export function suitabilityGradeLabel(
  profile: SoilPhysicalProfile | null,
  kind: SoilUseKind,
) {
  return soilCodeLabel(
    soilUseKindTables[kind].gradeTable,
    profile?.[soilUseKindTables[kind].gradeField],
  );
}

export function limitingFactorLabel(
  profile: SoilPhysicalProfile | null,
  kind: SoilUseKind,
) {
  return soilCodeLabel(
    soilUseKindTables[kind].limitingFactorTable,
    profile?.[soilUseKindTables[kind].limitingFactorField],
  );
}

// 밭 등급만 보던 시절의 호출부가 남아 있어 이름을 유지한다. 내부는 위 공통 함수를 쓴다.
export function uplandGradeNumber(profile: SoilPhysicalProfile | null) {
  return suitabilityGradeNumber(profile, "upland");
}

export function hasMaterialUplandLimit(profile: SoilPhysicalProfile | null) {
  return hasMaterialLimitingFactor(profile, "upland");
}

// V3의 6단계 배수 코드를 단기 위험 엔진의 3단계 입력으로만 묶는다.
// 화면에는 아래 그룹 대신 공식 원문 라벨을 그대로 표시한다.
export function drainageCategoryFromProfile(
  profile: SoilPhysicalProfile | null,
): SoilData["drainage"] {
  const code = normalizedCode(profile?.drainageCode);
  if (["01", "02"].includes(code ?? "")) return "good";
  if (["03", "04"].includes(code ?? "")) return "moderate";
  if (["05", "06"].includes(code ?? "")) return "poor";
  return "unknown";
}

export function decodedSoilProfile(profile: SoilPhysicalProfile) {
  return {
    drainage: soilCodeLabel(soilV3CodeTables.drainage, profile.drainageCode),
    effectiveDepth: soilCodeLabel(
      soilV3CodeTables.effectiveDepth,
      profile.effectiveDepthCode,
    ),
    topsoilTexture: soilCodeLabel(
      soilV3CodeTables.topsoilTexture,
      profile.topsoilTextureCode,
    ),
    mainLandUse: soilCodeLabel(
      soilV3CodeTables.mainLandUse,
      profile.mainLandUseCode,
    ),
    useRecommendation: soilCodeLabel(
      soilV3CodeTables.useRecommendation,
      profile.useRecommendationCode,
    ),
    uplandGrade: soilCodeLabel(
      soilV3CodeTables.uplandGrade,
      profile.uplandGradeCode,
    ),
    uplandLimitingFactor: soilCodeLabel(
      soilV3CodeTables.uplandLimitingFactor,
      profile.uplandLimitingFactorCode,
    ),
    orchardGrade: soilCodeLabel(
      soilV3CodeTables.orchardGrade,
      profile.orchardGradeCode,
    ),
    orchardLimitingFactor: soilCodeLabel(
      soilV3CodeTables.orchardLimitingFactor,
      profile.orchardLimitingFactorCode,
    ),
    // 논 항목은 판정에 쓰지 않고 값만 보관한다. 조회되지 않았으면 `확인되지 않음`으로 남는다.
    paddyGrade: soilCodeLabel(soilV3CodeTables.paddyGrade, profile.paddyGradeCode),
    paddyLimitingFactor: soilCodeLabel(
      soilV3CodeTables.paddyLimitingFactor,
      profile.paddyLimitingFactorCode,
    ),
  };
}

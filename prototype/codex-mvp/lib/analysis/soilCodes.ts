import type { SoilData, SoilPhysicalProfile } from "@/types/domain";

type CodeTable = Readonly<Record<string, string>>;

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
  uplandGrade: {
    "01": "1급지",
    "02": "2급지",
    "03": "3급지",
    "04": "4급지",
    "05": "5급지 · 부적합",
    "99": "기타",
  },
  uplandLimitingFactor: {
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
  },
} as const satisfies Record<string, CodeTable>;

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

export function uplandGradeNumber(profile: SoilPhysicalProfile | null) {
  const code = normalizedCode(profile?.uplandGradeCode);
  if (!code || !["01", "02", "03", "04", "05"].includes(code)) return null;
  return Number(code);
}

export function hasMaterialUplandLimit(profile: SoilPhysicalProfile | null) {
  const code = normalizedCode(profile?.uplandLimitingFactorCode);
  return code !== null && !["00", "01"].includes(code);
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
  };
}

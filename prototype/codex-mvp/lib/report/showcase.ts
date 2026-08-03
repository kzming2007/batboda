import { cropProfiles } from "@/lib/analysis/cropProfiles";
import {
  decodedSoilProfile,
  hasMaterialUplandLimit,
  uplandGradeNumber,
} from "@/lib/analysis/soilCodes";
import type { AnalysisResult, ShowcaseHighlight, ShowcaseReport } from "@/types/domain";

/**
 * 초보자용 자연어 리포트를 만든다.
 *
 * 이 문장은 LLM이 아니라 사람이 미리 작성한 문안을 규칙으로 조립한 것이다.
 * 그래서 화면 어디에서도 생성형 AI가 썼다고 말하지 않는다. 탭 이름도 `쉬운 말 리포트`다.
 * 제공자를 연결하면 `lib/report/provider.ts` 어댑터가 만든 문장이 같은 근거 묶음으로
 * 검증을 거쳐 이 자리를 대체한다. LLM 계층의 설계 의도는 소개서와 영상에서 설명한다.
 *
 * 규칙 두 가지를 지킨다.
 * 1. 수치는 규칙 엔진이 확정한 값만 끌어 쓴다. 새 숫자를 만들지 않는다.
 * 2. 발병 확률·수확량·성공 가능성을 말하지 않는다.
 *
 * pH와 밭 적성등급이 모두 조회된 사례에서만 만든다. 둘 중 하나라도 없으면
 * 문장을 채우는 대신 조건을 설명하고 비워 둔다.
 */

const rangeText = ([low, high]: [number, number]) => `${low.toFixed(1)}–${high.toFixed(1)}`;

/**
 * `주의로` / `낮음으로`처럼 받침에 따라 조사를 고른다.
 * 판정 라벨을 문장에 넣을 때 `주의으로`가 되지 않게 한다.
 */
function finalConsonantOf(word: string): number | null {
  const last = word.at(-1) ?? "";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28;
}

function withRo(word: string) {
  const final = finalConsonantOf(word);
  if (final === null) return `${word}로`;
  // 받침이 없거나 ㄹ이면 `로`, 그 밖에는 `으로`
  return final === 0 || final === 8 ? `${word}로` : `${word}으로`;
}

/** `경사와` / `저습과` */
function withWa(word: string) {
  const final = finalConsonantOf(word);
  if (final === null) return `${word}와`;
  return final === 0 ? `${word}와` : `${word}과`;
}

// 숫자로 끝나는 말의 조사는 마지막 자리의 한글 읽기를 따른다.
// 0 영 · 1 일 · 3 삼 · 6 육 · 7 칠 · 8 팔은 받침이 있어 `을`, 2·4·5·9는 `를`.
const digitHasFinal: Record<string, boolean> = {
  "0": true, "1": true, "2": false, "3": true, "4": false,
  "5": false, "6": true, "7": true, "8": true, "9": false,
};

/** `pH 6.9를` / `pH 7.1을` */
function withReul(value: string) {
  const lastDigit = value.trim().at(-1) ?? "";
  if (lastDigit in digitHasFinal) {
    return digitHasFinal[lastDigit] ? `${value}을` : `${value}를`;
  }
  const final = finalConsonantOf(value);
  if (final === null) return `${value}를`;
  return final === 0 ? `${value}를` : `${value}을`;
}

/** 작물별로 초보자에게 설명할 때 쓰는 표현. 공식 기준의 의미를 풀어 쓴 것이다. */
const cropVoice: Record<
  string,
  { soilNeed: string; watchPoint: string; season: string }
> = {
  potato: {
    soilNeed:
      "감자는 약간 산성인 흙을 좋아합니다. 중성에 가까워질수록 더뎅이병이 생기기 쉬워져서, 공식 권장 범위가 다른 작물보다 낮게 잡혀 있습니다.",
    watchPoint:
      "감자는 물이 고이는 데 특히 약합니다. 씨감자가 물에 잠기면 그대로 썩기 때문에, 심기 전 물빠짐을 확인하는 일이 비료보다 먼저입니다.",
    season: "서늘한 기후에서 잘 자라는 밭작물입니다.",
  },
  lettuce: {
    soilNeed:
      "상추는 중성에 가까운 흙에서 잘 자랍니다. 산성이 강하면 잎이 작아지고 뿌리가 깊게 뻗지 못합니다.",
    watchPoint:
      "상추는 더위에 약합니다. 기온이 올라가면 잎에서 쓴맛이 나고 꽃대가 먼저 올라와 상품성이 떨어집니다.",
    season: "서늘할 때 잎이 부드러워지는 엽채류입니다.",
  },
  apple: {
    soilNeed:
      "사과는 약산성 흙을 권장합니다. 나무를 한 번 심으면 오래 두기 때문에, 심기 전 흙 상태가 이후 몇 년을 좌우합니다.",
    watchPoint:
      "사과는 더위와 물빠짐에 모두 민감합니다. 여름 고온이 이어지면 과실이 굵어지지 않습니다.",
    season: "서늘한 기후를 좋아하는 과수입니다.",
  },
  pear: {
    soilNeed:
      "배는 pH 범위가 비교적 넓지만, 겉흙보다 속흙의 물빠짐과 물리성이 더 중요합니다. 비옥도보다 흙의 구조를 먼저 봅니다.",
    watchPoint:
      "배는 물이 잘 안 빠지는 땅에서 뿌리가 상하기 쉽습니다. 흙이 깊고 물이 잘 통하는지가 핵심입니다.",
    season: "적지 기준이 뚜렷한 과수입니다.",
  },
  cucumber: {
    soilNeed:
      "오이는 권장 pH 폭이 6.0에서 6.5로 좁습니다. 조금만 벗어나도 뿌리가 양분을 제대로 못 받습니다.",
    watchPoint:
      "오이는 낮과 밤 온도를 따로 관리해야 합니다. 낮에 너무 덥거나 밤에 너무 식으면 열매가 휘거나 떨어집니다.",
    season: "주야 온도 차에 민감한 시설채소입니다.",
  },
};

/** 밭 적성등급을 초보자 표현으로 옮긴다. 등급 자체는 토양특성 V3 공식 코드다. */
function gradeVoice(grade: number) {
  if (grade <= 2) {
    return "밭으로 쓰기에 조건이 좋은 땅입니다. 경사와 흙 깊이, 물빠짐이 대체로 무난하다는 뜻입니다.";
  }
  if (grade === 3) {
    return "밭으로 쓸 수는 있지만 손이 조금 더 가는 땅입니다. 조건 하나가 걸려 있어서 관리로 메워야 합니다.";
  }
  return "밭으로 쓰기에는 제약이 있는 땅입니다. 경사나 얕은 흙처럼 흙 자체를 바꾸기 어려운 조건이 걸려 있습니다.";
}

/** 행동 항목마다 `왜 지금 이걸 하나`를 풀어 쓴다. 제목은 규칙 엔진이 정한 값이다. */
const actionVoice: Record<string, string> = {
  "배수로와 고랑을 먼저 점검":
    "비가 오기 전에 하는 게 핵심입니다. 물이 고인 뒤에 손을 대면 흙이 눌려서 오히려 물빠짐이 나빠집니다. 고랑 끝이 막혀 있지 않은지만 봐도 절반은 확인됩니다.",
  "통풍 간격 확보":
    "습기가 오래 머무는 자리에서 병이 먼저 시작됩니다. 잎이 겹쳐 그늘이 진 구간을 골라 사이를 벌려 두면 마르는 속도가 달라집니다.",
  "온도 급변 시간대 대비":
    "하루 평균이 아니라 가장 낮은 때와 가장 높은 때가 작물을 힘들게 합니다. 그 시간대만 알아 두면 물 주는 때와 차광을 미리 맞출 수 있습니다.",
  "토양 실측으로 보정":
    "공공데이터의 검정 기록은 과거 시점입니다. 심기 직전에 간이 검정을 한 번 하면 지금 상태를 알고 투입량을 정할 수 있습니다. 지역 농업기술센터에서 받을 수 있습니다.",
  "현재 관리 계획 유지":
    "지금 자료에서는 급하게 손댈 신호가 없습니다. 예보는 자주 바뀌니 다음 발표 때 강수와 기온만 다시 확인하면 됩니다.",
};

/** 손으로 다듬은 대표 사례. `PNU:작물` 키로 찾는다. 없으면 일반 문안을 조립한다. */
const curatedOpening: Record<string, string> = {
  "5176038024100850061:lettuce":
    "결론부터 말하면, 이 땅에 상추를 심는 것은 지금 자료로는 무리가 없어 보입니다. 산도가 상추 권장 범위 안에 있고 밭 등급도 좋은 편이라, 흙을 바꾸는 일부터 시작할 필요는 없습니다. 다만 흙 조건이 좋다는 것과 지금 심기 좋다는 것은 다른 이야기입니다. 아래 저해요인과 날씨 부분을 함께 보셔야 합니다.",
  "5176038024100850022:potato":
    "흙의 산도만 보면 이 땅은 감자에 잘 맞습니다. 대관령 일대에서 이렇게 pH가 낮은 밭은 흔하지 않습니다. 다만 밭 적성등급이 낮게 나와서 산도 하나만으로 결론을 내리기는 어렵습니다.",
};

function factorValue(result: AnalysisResult, keyword: string) {
  return result.factors.find((factor) => factor.label.includes(keyword));
}

export function buildShowcaseReport(
  result: AnalysisResult,
): { report: ShowcaseReport | null; note: string | null } {
  const grade = uplandGradeNumber(result.soil.physicalProfile);
  const ph = result.soil.ph;

  if (ph === null && grade === null) {
    return {
      report: null,
      note: "이 필지는 토양검정 화학성(pH)과 토양특성(밭 적성등급) 모두 조회되지 않아 리포트를 만들지 않았습니다.",
    };
  }
  // pH는 검정 이력이 있는 필지에서만 나온다. 반경 1km 258필지 중 18건(7.0%)이었다.
  // 등급이 있으면 판정은 이미 나오므로 리포트도 만든다. 산도 문단만 조회되지 않았다고 적는다.
  // 없는 값을 채우지 않는 원칙은 그대로다 — 없다고 말하고, 있는 값만 쓴다.
  if (grade === null) {
    return {
      report: null,
      note: "이 필지는 밭 적성등급을 조회하지 못했습니다. 등급이 판정의 주 근거이므로 없는 상태로는 리포트를 만들지 않습니다.",
    };
  }

  const profile = cropProfiles[result.selection.cropId];
  const voice = cropVoice[result.selection.cropId];
  const decoded = result.soil.physicalProfile
    ? decodedSoilProfile(result.soil.physicalProfile)
    : null;

  const phFactor = factorValue(result, "pH");
  const gradeFactor = factorValue(result, "적성");
  const tempFactor = factorValue(result, "기온");
  const phRange = rangeText(profile.ph);
  const phState = phFactor?.state ?? "unknown";
  const hasPh = ph !== null;
  const phDirection = !hasPh
    ? ""
    : ph > profile.ph[1] ? "높습니다" : ph < profile.ph[0] ? "낮습니다" : "안에 있습니다";

  const curatedKey = `${result.parcel.parcelId}:${result.selection.cropId}`;
  const curated = curatedOpening[curatedKey];

  const headline = curated
    ?? `${result.parcel.address}에 ${result.cropName}를 심는 조건은 지금 조회한 자료로 ${result.suitabilityLabel}입니다. ` +
      `흙과 날씨를 따로 보면 어디를 손봐야 하는지가 더 분명해집니다.`;

  // ── 흙 이야기 ────────────────────────────────────────────
  const soilLines = [voice.soilNeed];
  soilLines.push(
    !hasPh
      ? `그런데 이 필지는 토양검정을 받은 기록이 없어 pH를 조회하지 못했습니다. ${result.cropName} 공식 권장 범위는 ${phRange}인데, 이 땅의 값이 그 안에 있는지는 지금 자료로 알 수 없습니다. 없는 값을 짐작해 채우지 않았습니다. 아래 판정은 밭 적성등급과 토양도에 적힌 조건으로 냈습니다.`
      : phState === "good"
        ? `이 땅의 pH는 ${ph}입니다. ${result.cropName} 공식 권장 범위 ${phRange} ${phDirection}. 산도를 맞추려고 따로 무언가를 넣을 필요는 없어 보입니다.`
        : phState === "watch"
          ? `이 땅의 pH는 ${ph}로, 권장 범위 ${phRange}를 조금 벗어나 ${phDirection}. 크게 어긋난 정도는 아니지만 심기 전에 한 번 재보시는 편이 좋습니다.`
          : `이 땅의 pH는 ${ph}로, 권장 범위 ${phRange}보다 ${phDirection}. 이 차이가 이번 판정에서 가장 크게 반영된 항목입니다.`,
  );
  soilLines.push(`밭 적성등급은 ${gradeFactor?.value ?? `${grade}급지`}입니다. ${gradeVoice(grade)}`);
  if (decoded) {
    soilLines.push(
      `토양도에 적힌 조건을 그대로 옮기면 저해요인은 ${decoded.uplandLimitingFactor}, 물빠짐은 ${decoded.drainage}, 흙 깊이는 ${decoded.effectiveDepth}, 겉흙은 ${decoded.topsoilTexture}입니다.`,
    );
  }

  // ── 날씨 이야기 ──────────────────────────────────────────
  const weatherLines = [voice.watchPoint];
  if (tempFactor) {
    weatherLines.push(
      `고른 ${result.selection.horizonDays}일 동안 기온은 ${tempFactor.value}이고 공식 적온은 ${tempFactor.target}입니다.`,
    );
  }
  const rainDay = result.weather.days.find((day) => (day.rainProbability ?? 0) >= 60);
  if (rainDay) {
    weatherLines.push(
      `${rainDay.label}은 강수확률이 ${rainDay.rainProbability}%로 가장 높습니다. 이날을 기준으로 앞뒤 일정을 잡으시면 됩니다.`,
    );
  }
  weatherLines.push(
    `가까운 ${result.selection.horizonDays}일 위험도는 ${withRo(result.riskLabel)} 봤습니다. 이 값은 흙 상태와 별개로, 고른 기간의 날씨만 본 것입니다.`,
  );
  if (result.recentClimate.status === "connected") {
    weatherLines.push(
      `참고로 최근 7일은 ${result.recentClimate.station.name} 관측소 기록으로 누적 강수 ${result.recentClimate.totalRainMm}mm, 강수일 ${result.recentClimate.wetDays}일이었습니다. 이 값은 판정 점수에 넣지 않고 상황 참고용으로만 보여드립니다.`,
    );
  }

  // ── 한계 ────────────────────────────────────────────────
  const limitLines = [
    "이 글은 공공데이터와 공식 기준을 대조한 참고 판단입니다. 수확량이나 성공 가능성을 말하지 않습니다.",
    hasPh
      ? `토양 검정 기록은 ${result.soil.sampledAt} 시점이고 시료 유형은 ${result.soil.sampleType}입니다. 그 뒤로 흙에 손을 댔다면 지금 값과 다를 수 있습니다.`
      : "산도와 유기물은 검정 이력이 있는 필지에서만 조회됩니다. 이 필지는 이력이 없어 그 항목을 빼고 판단했습니다. 지역 농업기술센터에 토양 검정을 신청하면 값을 확보할 수 있습니다.",
    `최근 날씨는 ${result.recentClimate.station.name} 관측소 기록이라 실제 농지와는 차이가 있을 수 있습니다.`,
    "심기 전에 현장을 직접 보시고, 지역 농업기술센터 확인을 함께 받는 편이 안전합니다.",
  ];

  const blocks = [
    { id: "soil", heading: "이 땅의 흙은 어떤가요", body: soilLines.join(" ") },
    { id: "weather", heading: "지금 날씨는 어떤 부담을 주나요", body: weatherLines.join(" ") },
    { id: "limits", heading: "이 판단의 한계", body: limitLines.join(" ") },
  ];

  const checklist = result.actions.map((action) => ({
    title: action.title,
    timing: action.timing,
    body: actionVoice[action.title] ?? action.detail,
  }));

  // 저해요인이 실질적으로 걸려 있으면 `산도가 맞다`로 끝내지 않는다.
  const limitFactor = hasMaterialUplandLimit(result.soil.physicalProfile)
    ? decoded?.uplandLimitingFactor ?? null
    : null;
  const closing = !hasPh
    ? `정리하면 산도는 아직 모르는 상태이고, 판정은 밭 적성등급과 날씨로 냈습니다. 심기 전 토양 검정으로 산도를 확인하는 것이 첫 순서입니다.${limitFactor ? ` 저해요인으로 적힌 ${limitFactor}도 함께 보셔야 합니다.` : ""}`
    : phState === "good"
      ? limitFactor
        ? `정리하면 산도는 맞습니다. 남은 것은 저해요인으로 적힌 ${withWa(limitFactor)} 고른 기간의 날씨입니다. 이 둘은 흙을 바꾸는 문제가 아니라 관리로 다루는 문제입니다.`
        : `정리하면 산도는 맞고, 남은 변수는 ${grade <= 2 ? "고른 기간의 날씨" : "밭 조건과 날씨"}입니다. 위 확인 목록부터 처리하시면 됩니다.`
      : `정리하면 pH ${withReul(String(ph))} 어떻게 다룰지가 먼저입니다. 심기 전 간이 검정으로 지금 값을 확인한 뒤 투입량을 정하시는 편이 안전합니다.`;

  const usedValues = [
    hasPh ? `pH ${ph}` : "pH 조회 안 됨",
    `밭 적성등급 ${grade}급지`,
    `적합도 ${result.suitabilityScore}`,
    `위험도 ${result.riskScore}`,
    `기간 ${result.selection.horizonDays}일`,
  ];

  // 강조는 화면이 임의로 고르지 않고 여기서 정한 목록으로만 입힌다.
  // 색 규칙은 판정 색과 같다. 실측 수치=골드, 공식 기준=딥그린, 주의·한계=클레이 레드.
  const highlights: ShowcaseHighlight[] = [
    { text: gradeFactor?.value ?? `${grade}급지`, kind: "value" },
    { text: `${result.cropName} 공식 권장 범위 ${phRange}`, kind: "official" },
    { text: `공식 권장 범위는 ${phRange}`, kind: "official" },
    { text: `권장 범위 ${phRange}`, kind: "official" },
    { text: result.suitabilityLabel, kind: phState === "risk" ? "caution" : "official" },
  ];
  if (hasPh) {
    // 본문에 `pH 6.9`와 `pH는 6.9` 두 형태로 나오므로 둘 다 등록한다.
    highlights.push({ text: `pH ${ph}`, kind: "value" }, { text: `pH는 ${ph}`, kind: "value" });
  } else {
    // 조회되지 않았다는 사실 자체를 주의 색으로 드러낸다.
    highlights.push({ text: "pH를 조회하지 못했습니다", kind: "caution" });
  }
  if (tempFactor) {
    highlights.push(
      { text: tempFactor.value, kind: "value" },
      { text: `공식 적온은 ${tempFactor.target}`, kind: "official" },
    );
  }
  if (rainDay) {
    highlights.push({ text: `강수확률이 ${rainDay.rainProbability}%`, kind: "caution" });
  }
  if (limitFactor) {
    highlights.push({ text: `저해요인은 ${limitFactor}`, kind: "caution" });
  }
  if (decoded) {
    highlights.push(
      { text: `물빠짐은 ${decoded.drainage}`, kind: "value" },
      { text: `겉흙은 ${decoded.topsoilTexture}`, kind: "value" },
    );
  }
  highlights.push(
    { text: `위험도는 ${withRo(result.riskLabel)}`, kind: "caution" },
    { text: "수확량이나 성공 가능성을 말하지 않습니다", kind: "caution" },
    { text: "판정 점수에 넣지 않고 상황 참고용으로만", kind: "caution" },
    { text: "지역 농업기술센터 확인을 함께 받는 편이 안전합니다", kind: "caution" },
  );

  return {
    report: {
      caseLabel: `${result.parcel.address} · ${result.cropName} · ${result.selection.horizonDays}일`,
      curated: Boolean(curated),
      headline,
      blocks,
      checklist,
      closing,
      usedValues,
      highlights: highlights.filter((item) => item.text.trim().length > 1),
    },
    note: null,
  };
}

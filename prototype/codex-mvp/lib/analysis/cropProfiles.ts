import type { CropId } from "@/types/domain";

type MeanTemperatureStandard = {
  mode: "mean";
  range: [number, number];
  label: string;
};

type DayNightTemperatureStandard = {
  mode: "day-night";
  day: [number, number];
  night: [number, number];
  label: string;
};

export type CropProfile = {
  id: CropId;
  name: string;
  shortName: string;
  emoji: string;
  description: string;
  ph: [number, number];
  temperature: MeanTemperatureStandard | DayNightTemperatureStandard;
  sensitivity: {
    ph: SensitivityLevel;
    temperature: SensitivityLevel;
    excessMoisture: SensitivityLevel;
  };
  sensitivityRationale: {
    ph: string;
    temperature: string;
    excessMoisture: string;
  };
  references: {
    ph: string;
    temperature: string;
  };
  weatherAdvisory?: {
    id: string;
    label: string;
    temperatureRange: [number, number];
    minHumidity: number;
    requireWetSignal: boolean;
    conditionLabel: string;
    rationale: string;
    reference: string;
    action: {
      title: string;
      detail: string;
      timing: string;
    };
  };
};

export type SensitivityLevel = "standard" | "sensitive" | "very-sensitive";

// 농촌진흥청 농업기술길잡이와 농사로 현장기술지원의 작물별 기준이다.
// 일반 강수확률·습도 기여도는 엔진의 자체 설계 규칙으로 두되,
// 작물별 공식 발생환경을 좁은 운영 신호로 조합할 근거가 있는 경우에만
// weatherAdvisory에 기록하며 공식 예측모형과 구분한다.
export const cropProfiles: Record<CropId, CropProfile> = {
  apple: {
    id: "apple",
    name: "사과",
    shortName: "사과",
    emoji: "🍎",
    description: "과수 · 서늘한 기후",
    ph: [6.0, 6.5],
    temperature: {
      mode: "mean",
      range: [15, 18],
      label: "생육기 평균",
    },
    sensitivity: {
      ph: "standard",
      temperature: "sensitive",
      excessMoisture: "sensitive",
    },
    sensitivityRationale: {
      ph: "공식 pH 범위를 기본 민감도로 대조",
      temperature: "30℃ 이상에서 호흡 증가와 과실 비대 저하",
      excessMoisture: "배수 불량 토양에서 정상 생육이 어려움",
    },
    references: {
      ph: "농업기술길잡이 사과(2025 개정8판), PDF 28쪽",
      temperature: "농업기술길잡이 사과(2025 개정8판), PDF 20쪽",
    },
  },
  pear: {
    id: "pear",
    name: "배",
    shortName: "배",
    emoji: "🍐",
    description: "과수 · 배수 관리",
    ph: [5.5, 6.5],
    temperature: {
      mode: "mean",
      range: [18, 20],
      label: "적지 생육기 평균",
    },
    sensitivity: {
      ph: "standard",
      temperature: "standard",
      excessMoisture: "sensitive",
    },
    sensitivityRationale: {
      ph: "공식 pH 범위를 기본 민감도로 대조",
      temperature: "장기 적지 평균을 단기 이탈 신호로만 사용",
      excessMoisture: "속흙의 배수와 물리성이 비옥도보다 중요",
    },
    references: {
      ph: "농업기술길잡이 배(2020 개정8판), PDF 122쪽",
      temperature: "농업기술길잡이 배(2020 개정8판), PDF 117~118쪽",
    },
  },
  cucumber: {
    id: "cucumber",
    name: "오이",
    shortName: "오이",
    emoji: "🥒",
    description: "시설채소 · 주야 온도 민감",
    ph: [6.0, 6.5],
    temperature: {
      mode: "day-night",
      day: [22, 28],
      night: [15, 18],
      label: "주간·야간 생육 적온",
    },
    sensitivity: {
      ph: "sensitive",
      temperature: "very-sensitive",
      excessMoisture: "standard",
    },
    sensitivityRationale: {
      ph: "공식 pH 범위가 6.0~6.5로 좁음",
      temperature: "주야 적온을 별도 관리하고 35℃ 이상에서 고온장해",
      excessMoisture: "현재 공식 장부에 작물별 가중 근거가 없어 기본값 적용",
    },
    references: {
      ph: "농사로 오이 현장기술지원 토양 적정범위",
      temperature: "농업기술길잡이 오이(2021 개정6판), PDF 28쪽",
    },
  },
  potato: {
    id: "potato",
    name: "감자",
    shortName: "감자",
    emoji: "🥔",
    description: "밭작물 · 서늘한 기후",
    ph: [5.0, 6.0],
    temperature: {
      mode: "mean",
      range: [14, 23],
      label: "일반 생육 적온",
    },
    sensitivity: {
      ph: "sensitive",
      temperature: "sensitive",
      excessMoisture: "very-sensitive",
    },
    sensitivityRationale: {
      ph: "공식 범위가 5.0~6.0이며 대표 시연 pH 이탈을 차등 반영",
      temperature: "일반 생육과 덩이줄기 비대 적온이 구분됨",
      excessMoisture: "침수 저항성이 약하고 과습 시 부패가 증가",
    },
    references: {
      ph: "농업기술길잡이 감자(2020 개정8판), PDF 74쪽",
      temperature: "농업기술길잡이 감자(2020 개정8판), PDF 71쪽",
    },
    weatherAdvisory: {
      id: "potato-late-blight-watch",
      label: "감자 역병 환경 신호",
      temperatureRange: [15, 21],
      minHumidity: 85,
      requireWetSignal: true,
      conditionLabel: "자체 설계 조건: 일평균 15–21℃ · 습도 85% 이상 · 비 신호",
      rationale:
        "공식 발생환경의 저온·다습·잦은 비 설명을 좁게 조합한 참고 신호이며 공식 예측모형이나 발병 확률이 아님",
      reference:
        "농업기술길잡이 감자(2020 개정8판), PDF 154~155쪽·172쪽·234쪽",
      action: {
        title: "감자 역병 대비 계획 확인",
        detail:
          "재배 전이면 배수·통풍과 예찰 계획을 확인하고, 이미 생육 중이면 아랫잎 반점과 잎 뒷면의 흰 균사를 함께 살핍니다.",
        timing: "재배 전 · 조건 예보 시",
      },
    },
  },
  lettuce: {
    id: "lettuce",
    name: "상추",
    shortName: "상추",
    emoji: "🥬",
    description: "엽채류 · 고온 주의",
    ph: [6.5, 7.0],
    temperature: {
      mode: "mean",
      range: [15, 20],
      label: "발아·생육 적온",
    },
    sensitivity: {
      ph: "sensitive",
      temperature: "sensitive",
      excessMoisture: "sensitive",
    },
    sensitivityRationale: {
      ph: "일반 상추에 적용한 잎상추 pH 범위가 6.5~7.0으로 좁음",
      temperature: "30℃ 이상과 5℃ 이하에서 발아가 저하됨",
      excessMoisture: "보수력과 배수가 모두 좋은 토양이 권장됨",
    },
    references: {
      ph: "농업기술길잡이 상추(2020 개정5판), PDF 35쪽",
      temperature: "농업기술길잡이 상추(2020 개정5판), PDF 33쪽",
    },
  },
};

export const cropList = Object.values(cropProfiles);

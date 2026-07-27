import type {
  AnalysisSelection,
  ParcelData,
  RecentClimateData,
  SourceStatus,
  SoilData,
  WeatherData,
  WeatherDay,
} from "@/types/domain";

const isPyeongchangDemo = (lat: number, lng: number) =>
  Math.abs(lat - 37.675) < 0.0001 && Math.abs(lng - 128.718) < 0.0001;

const locationLabel = (lat: number, lng: number) => {
  if (Math.abs(lat - 37.675) < 0.25 && Math.abs(lng - 128.718) < 0.35) {
    return "강원특별자치도 평창군 대관령면 시연 농지";
  }
  if (Math.abs(lat - 36.872) < 0.25 && Math.abs(lng - 128.74) < 0.35) {
    return "경상북도 영주시 시연 농지";
  }
  if (Math.abs(lat - 37.265) < 0.25 && Math.abs(lng - 127.198) < 0.35) {
    return "경기도 이천시 시연 농지";
  }
  return `선택 좌표 ${lat.toFixed(4)}, ${lng.toFixed(4)} 인근 시연 농지`;
};

const addDays = (iso: string, offset: number) => {
  const date = new Date(`${iso}T00:00:00+09:00`);
  date.setDate(date.getDate() + offset);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export function createMockParcel(
  selection: AnalysisSelection,
  status: SourceStatus = "mock",
): ParcelData {
  return {
    address: locationLabel(selection.lat, selection.lng),
    parcelId: "시연용 필지번호",
    farmMapId: null,
    interpretation: "밭 · 시연용 경계",
    candidateCount: 1,
    selectionStatus: "mock",
    status,
    source: status === "fallback" ? "팜맵 대체 자료" : "팜맵 시연 자료",
    observedAt: "시연 데이터",
  };
}

export function createMockSoil(
  selection: AnalysisSelection,
  status: SourceStatus = "mock",
): SoilData {
  if (isPyeongchangDemo(selection.lat, selection.lng)) {
    return {
      ph: 7.0,
      organicMatter: 18,
      electricalConductivity: null,
      electricalConductivityUnit: null,
      electricalConductivityUnitStatus: "mock",
      drainage: "good",
      year: "2025 검증 스냅샷",
      sampledAt: "2025-07-01",
      sampleType: "시설",
      parcelId: "51760380…0015",
      farmMapId: null,
      boundaryAvailable: true,
      physicalProfile: {
        drainageCode: "02",
        effectiveDepthCode: "04",
        erosionCode: "01",
        topsoilTextureCode: "04",
        mainLandUseCode: "03",
        useRecommendationCode: "03",
        uplandGradeCode: "04",
        uplandLimitingFactorCode: "02",
        orchardGradeCode: "03",
        orchardLimitingFactorCode: "02",
      },
      status,
      source:
        status === "fallback"
          ? "토양분석 대체 자료"
          : "토양분석 시연 자료 · 검증값 재현",
      observedAt: "2025-07-01 · 2026-07-23 실응답 검증",
    };
  }

  const eastShift = selection.lng > 128.5;
  return {
    ph: eastShift ? 5.4 : 6.2,
    organicMatter: eastShift ? 27 : 22,
    electricalConductivity: null,
    electricalConductivityUnit: null,
    electricalConductivityUnitStatus: "mock",
    drainage: eastShift ? "good" : "moderate",
    year: "2025 시연값",
    sampledAt: "시연 데이터",
    sampleType: "시연용",
    parcelId: null,
    farmMapId: null,
    boundaryAvailable: false,
    physicalProfile: null,
    status,
    source: status === "fallback" ? "토양분석 대체 자료" : "토양분석 시연 자료",
    observedAt: "시연 데이터",
  };
}

export function createMockRecentClimate(
  status: SourceStatus = "mock",
): RecentClimateData {
  return {
    station: {
      code: "시연용 관측소",
      name: "인근 농업기상 관측소",
      distanceKm: 6.5,
      elevationM: 1099,
      address: "시연용 관측지점",
      observedSince: "시연 데이터",
    },
    period: { begin: "2026-07-17", end: "2026-07-23" },
    itemCount: 7,
    totalRainMm: 139,
    wetDays: 6,
    minTempC: 14.6,
    maxTempC: 26.3,
    averageHumidityPct: 93.4,
    representativeness: "nearby",
    status,
    source: status === "fallback" ? "농업기상 대체 자료" : "농업기상 시연 자료",
    observedAt: "2026-07-17–2026-07-23 · 시연 데이터",
  };
}

export function createMockWeather(
  selection: AnalysisSelection,
  baseDate = "2026-07-23",
  status: SourceStatus = "mock",
): WeatherData {
  const templates: Omit<WeatherDay, "date" | "label">[] = [
    {
      minTemp: 15,
      maxTemp: 22,
      rainProbability: 20,
      precipitation: 0,
      precipitationType: "없음",
      humidity: 74,
      humidityAverage: 68,
      maxWindSpeed: 3.2,
      sky: "구름 조금",
    },
    {
      minTemp: 16,
      maxTemp: 24,
      rainProbability: 70,
      precipitation: 8,
      precipitationType: "비",
      humidity: 88,
      humidityAverage: 79,
      maxWindSpeed: 5.1,
      sky: "오후 비",
    },
    {
      minTemp: 17,
      maxTemp: 25,
      rainProbability: 60,
      precipitation: 4,
      precipitationType: "비",
      humidity: 84,
      humidityAverage: 76,
      maxWindSpeed: 4.4,
      sky: "흐리고 비",
    },
  ];

  const labels = ["오늘", "내일", "모레"];
  return {
    issuedAt: `${baseDate} 08:00 KST · 시연 데이터`,
    status,
    source: status === "fallback" ? "단기예보 대체 자료" : "단기예보 시연 자료",
    days: templates.slice(0, selection.horizonDays).map((day, index) => ({
      ...day,
      date: addDays(baseDate, index),
      label: labels[index],
    })),
  };
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FAVORITES_KEY,
  FAVORITES_LIMIT,
  favoriteId,
  favoritesSnapshot,
  isFavorite,
  parseFavorites,
  toggleFavorite,
  updateFavorites,
  type FavoriteFarm,
} from "@/lib/favorites";
import type { ParcelCandidate } from "@/types/domain";

const candidate: ParcelCandidate = {
  address: "대관령면 85-61전",
  parcelId: "5176038024100850061",
  farmMapId: "427603802400754",
  interpretation: "밭",
  observedAt: "2022-12-30",
};

const position = { lat: 37.675, lng: 128.718 };
const savedAt = "2026-08-04T06:00:00.000Z";

function stored(patch: Partial<FavoriteFarm> = {}): FavoriteFarm {
  return {
    parcelId: candidate.parcelId,
    farmMapId: candidate.farmMapId,
    address: candidate.address,
    interpretation: candidate.interpretation,
    lat: position.lat,
    lng: position.lng,
    savedAt,
    ...patch,
  };
}

describe("즐겨찾는 농지 담기", () => {
  it("없으면 담고 있으면 뺀다", () => {
    const once = toggleFavorite([], candidate, position, savedAt);
    expect(once).toHaveLength(1);
    expect(isFavorite(once, candidate)).toBe(true);

    const twice = toggleFavorite(once, candidate, position, savedAt);
    expect(twice).toHaveLength(0);
    expect(isFavorite(twice, candidate)).toBe(false);
  });

  it("방금 담은 것이 맨 앞에 온다", () => {
    const older = stored({ parcelId: "1111111111111111111", address: "먼저 담은 농지" });
    const next = toggleFavorite([older], candidate, position, savedAt);

    expect(next[0].address).toBe(candidate.address);
    expect(next[1].address).toBe("먼저 담은 농지");
  });

  // 판정을 담으면 예보가 갱신돼도 옛 결론이 남아 저장본 스냅샷과 뒤엉킨다.
  it("좌표와 필지만 담고 판정은 담지 않는다", () => {
    const [saved] = toggleFavorite([], candidate, position, savedAt);

    expect(saved.lat).toBe(position.lat);
    expect(saved.lng).toBe(position.lng);
    expect(Object.keys(saved).sort()).toEqual(
      ["address", "farmMapId", "interpretation", "lat", "lng", "parcelId", "savedAt"],
    );
  });

  it("같은 지번이라도 팜맵 도형이 다르면 다른 농지로 센다", () => {
    const other = { ...candidate, farmMapId: "999999999999999" };
    const list = toggleFavorite([], candidate, position, savedAt);

    expect(isFavorite(list, other)).toBe(false);
    expect(favoriteId(candidate)).not.toBe(favoriteId(other));
  });

  it("상한을 넘으면 오래된 것부터 밀어낸다", () => {
    let list: FavoriteFarm[] = [];
    for (let index = 0; index < FAVORITES_LIMIT + 3; index += 1) {
      list = toggleFavorite(
        list,
        { ...candidate, parcelId: `p${index}`, address: `농지 ${index}` },
        position,
        savedAt,
      );
    }

    expect(list).toHaveLength(FAVORITES_LIMIT);
    expect(list[0].address).toBe(`농지 ${FAVORITES_LIMIT + 2}`);
    expect(list.some((item) => item.address === "농지 0")).toBe(false);
  });
});

/**
 * `localStorage`는 사용자가 직접 고칠 수 있고 옛 버전 기록이 남기도 한다.
 * 깨진 값 하나로 화면 전체가 멈추면 안 된다.
 */
describe("저장된 값 읽기", () => {
  it("담은 그대로 다시 읽는다", () => {
    const list = toggleFavorite([], candidate, position, savedAt);
    expect(parseFavorites(JSON.stringify(list))).toEqual(list);
  });

  it("비어 있거나 JSON이 아니면 빈 목록으로 둔다", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("")).toEqual([]);
    expect(parseFavorites("{")).toEqual([]);
    expect(parseFavorites('{"parcelId":"x"}')).toEqual([]);
  });

  it("모양이 어긋난 항목만 버리고 나머지는 살린다", () => {
    const raw = JSON.stringify([
      stored(),
      { parcelId: "쓸 수 없음" },
      stored({ parcelId: "2222222222222222222", lat: Number.NaN }),
      stored({ parcelId: "3333333333333333333", address: "살아남는 농지" }),
    ]);
    const parsed = parseFavorites(raw);

    expect(parsed).toHaveLength(2);
    expect(parsed[1].address).toBe("살아남는 농지");
  });
});

/**
 * 화면 핸들러가 렌더 시점의 목록을 붙들면, 별표를 연달아 누를 때 두 클릭이 같은 옛 목록 위에서
 * 계산돼 앞의 것이 사라진다. 브라우저에서 실제로 재현된 문제다.
 */
describe("연달아 담기", () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => void memory.set(key, value),
      },
      addEventListener() {},
      removeEventListener() {},
    };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("한 렌더 안에서 두 번 담아도 둘 다 남는다", () => {
    const first = { ...candidate, parcelId: "aaaa", address: "먼저 담은 농지" };
    const second = { ...candidate, parcelId: "bbbb", address: "나중에 담은 농지" };

    // 화면이 다시 그려지기 전이라 두 호출 모두 같은 빈 목록을 봤다고 가정한다.
    const staleView: FavoriteFarm[] = [];
    updateFavorites((current) => toggleFavorite(current, first, position, savedAt));
    updateFavorites((current) => toggleFavorite(current, second, position, savedAt));
    expect(staleView).toHaveLength(0);

    const saved = favoritesSnapshot();
    expect(saved.map((item) => item.address)).toEqual(["나중에 담은 농지", "먼저 담은 농지"]);
    expect(parseFavorites(memory.get(FAVORITES_KEY) ?? null)).toHaveLength(2);
  });
});

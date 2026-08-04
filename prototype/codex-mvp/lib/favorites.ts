import type { ParcelCandidate } from "@/types/domain";

/**
 * 즐겨찾는 농지. 브라우저에만 저장한다.
 *
 * 프리셋 세 곳은 시연용이라 실제 사용자의 농지가 아니다. 농지는 한 번 찾으면 계속 같은 곳을 보는데,
 * 매번 지도를 끌고 지번을 다시 검색하게 두면 두 번째 방문이 첫 방문과 똑같이 오래 걸린다.
 *
 * **판정은 저장하지 않는다.** 좌표와 필지만 담고, 누를 때마다 다시 분석한다.
 * 판정까지 담으면 예보가 갱신돼도 옛 결론이 남아 저장본 스냅샷과 뒤엉킨다.
 *
 * 서버로 보내지 않는다. 농지 위치는 개인 자산 정보라 브라우저 밖으로 나갈 이유가 없다.
 */
export type FavoriteFarm = {
  parcelId: string;
  farmMapId: string;
  address: string;
  interpretation: string;
  lat: number;
  lng: number;
  savedAt: string;
};

export const FAVORITES_KEY = "batboda.favorites";

/** 화면 한 줄에 담기는 만큼만 둔다. 넘치면 오래된 것부터 밀어낸다. */
export const FAVORITES_LIMIT = 8;

/** 같은 필지라도 팜맵 도형이 다르면 다른 후보다. 후보 목록의 key와 같은 규칙을 쓴다. */
export function favoriteId(farm: { parcelId: string; farmMapId: string }) {
  return `${farm.parcelId}:${farm.farmMapId}`;
}

function isFavoriteShape(value: unknown): value is FavoriteFarm {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.parcelId === "string" && item.parcelId.length > 0 &&
    typeof item.farmMapId === "string" &&
    typeof item.address === "string" && item.address.length > 0 &&
    typeof item.interpretation === "string" &&
    typeof item.lat === "number" && Number.isFinite(item.lat) &&
    typeof item.lng === "number" && Number.isFinite(item.lng) &&
    typeof item.savedAt === "string"
  );
}

/**
 * 저장된 문자열을 목록으로 읽는다.
 *
 * `localStorage`는 사용자가 직접 고칠 수 있고 옛 버전이 남기도 한다. 깨진 값 하나가 화면 전체를
 * 못 그리게 만들면 안 되므로, 모양이 맞지 않는 항목은 조용히 버리고 나머지를 살린다.
 */
export function parseFavorites(raw: string | null): FavoriteFarm[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFavoriteShape).slice(0, FAVORITES_LIMIT);
  } catch {
    return [];
  }
}

export function isFavorite(list: FavoriteFarm[], farm: { parcelId: string; farmMapId: string }) {
  const id = favoriteId(farm);
  return list.some((item) => favoriteId(item) === id);
}

/** 이미 있으면 빼고 없으면 앞에 넣는다. 방금 저장한 것이 맨 앞에 보이는 편이 찾기 쉽다. */
export function toggleFavorite(
  list: FavoriteFarm[],
  candidate: ParcelCandidate,
  position: { lat: number; lng: number },
  savedAt: string,
): FavoriteFarm[] {
  const id = favoriteId(candidate);
  if (list.some((item) => favoriteId(item) === id)) {
    return list.filter((item) => favoriteId(item) !== id);
  }
  const next: FavoriteFarm = {
    parcelId: candidate.parcelId,
    farmMapId: candidate.farmMapId,
    address: candidate.address,
    interpretation: candidate.interpretation,
    lat: position.lat,
    lng: position.lng,
    savedAt,
  };
  return [next, ...list].slice(0, FAVORITES_LIMIT);
}

/* ─── 화면에 붙이는 부분 ─────────────────────────────────────
 *
 * `localStorage`는 리액트 바깥의 저장소라 `useSyncExternalStore`로 읽는다.
 * 효과 안에서 상태를 세우면 서버가 그린 화면과 한 번 어긋났다가 다시 그려진다.
 *
 * 서버 렌더에는 저장소가 없으므로 항상 빈 목록을 준다. 첫 그림은 서버와 같고,
 * 브라우저가 붙은 뒤 저장된 값으로 바뀐다.
 */

const EMPTY: FavoriteFarm[] = [];
const listeners = new Set<() => void>();

// getSnapshot은 값이 그대로면 같은 참조를 돌려줘야 한다. 아니면 리액트가 무한히 다시 그린다.
let cachedRaw: string | null = null;
let cachedList: FavoriteFarm[] = EMPTY;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(FAVORITES_KEY);
  } catch {
    // 사생활 보호 모드처럼 저장소를 막는 환경이 있다. 즐겨찾기가 없을 뿐 화면은 그대로 돈다.
    return null;
  }
}

export function subscribeFavorites(onChange: () => void) {
  listeners.add(onChange);
  // 다른 탭에서 담은 농지도 따라온다.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function favoritesSnapshot(): FavoriteFarm[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseFavorites(raw);
  }
  return cachedList;
}

export function favoritesServerSnapshot(): FavoriteFarm[] {
  return EMPTY;
}

/**
 * 저장된 목록을 바꾼다.
 *
 * 바뀐 목록을 통째로 받지 않고 함수를 받는다. 화면 핸들러가 렌더 시점의 목록을 붙들고 있으면
 * 별표를 연달아 누를 때 앞의 것이 사라진다. 두 번의 클릭이 같은 렌더 안에서 일어나면 둘 다
 * 같은 옛 목록 위에서 계산되기 때문이다. 저장 직전에 현재 값을 다시 읽어 그 위에 얹는다.
 */
export function updateFavorites(update: (current: FavoriteFarm[]) => FavoriteFarm[]) {
  const next = update(favoritesSnapshot());
  const raw = JSON.stringify(next);
  cachedRaw = raw;
  cachedList = next;
  try {
    window.localStorage.setItem(FAVORITES_KEY, raw);
  } catch {
    // 저장을 막는 환경에서도 이번 세션 동안은 목록이 살아 있게 둔다.
  }
  for (const listener of listeners) listener();
  return next;
}

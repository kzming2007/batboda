import { describe, expect, it } from "vitest";
import { toFarmMapCoordinates, toKmaGrid, validateCoordinates } from "@/lib/public-data/geo";

describe("coordinate conversions", () => {
  it("서울시청을 알려진 기상청 격자에 가깝게 변환한다", () => {
    const grid = toKmaGrid(37.5665, 126.978);
    expect(grid).toEqual({ nx: 60, ny: 127 });
  });

  it("WGS84 좌표를 유한한 EPSG:5179 값으로 변환한다", () => {
    const point = toFarmMapCoordinates(37.675, 128.718);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(point.x).toBeGreaterThan(900_000);
    expect(point.y).toBeGreaterThan(1_900_000);
  });

  it("국내 시연 범위 밖 좌표를 거부한다", () => {
    expect(validateCoordinates(37.675, 128.718)).toBe(true);
    expect(validateCoordinates(0, 0)).toBe(false);
  });
});

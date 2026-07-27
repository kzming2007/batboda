import { describe, expect, it } from "vitest";
import { parseSelection } from "@/lib/public-data/request";

describe("parseSelection", () => {
  it("유효한 국내 좌표와 입력을 정규화한다", () => {
    expect(
      parseSelection({ lat: "37.675", lng: "128.718", cropId: "potato", horizonDays: "3" }),
    ).toEqual({ lat: 37.675, lng: 128.718, cropId: "potato", horizonDays: 3 });
  });

  it("국내 범위 밖 좌표를 거부한다", () => {
    expect(() =>
      parseSelection({ lat: 0, lng: 0, cropId: "potato", horizonDays: 3 }),
    ).toThrow("대한민국 범위");
  });
});

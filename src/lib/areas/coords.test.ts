import { describe, expect, it } from "vitest";
import { parseCompactCoord, toTopSkyCoord, parseTopSkyCoordPair } from "./coords";

describe("coords", () => {
  it("parses AIP compact to decimal", () => {
    const c = parseCompactCoord("604027N 0154854E");
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(60 + 40 / 60 + 27 / 3600, 5);
    expect(c!.lon).toBeCloseTo(15 + 48 / 60 + 54 / 3600, 5);
  });

  it("round-trips TopSky space form", () => {
    const line = toTopSkyCoord(59.410277, 20.265277);
    const back = parseTopSkyCoordPair(line);
    expect(back).not.toBeNull();
    expect(back!.lat).toBeCloseTo(59.410277, 3);
  });
});

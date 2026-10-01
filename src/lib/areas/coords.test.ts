import { describe, expect, it } from "vitest";
import {
  circleStepCount,
  densifyCircle,
  inferSpacingFromRing,
  parseCompactCoord,
  parseTopSkyCoordPair,
  redensifyBoundCircle,
  toTopSkyCoord,
} from "./coords";

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

  it("parses unpadded LABEL seconds (ESAA style)", () => {
    const a = parseTopSkyCoordPair("N066.26.8.428 E018.56.56.216");
    expect(a).not.toBeNull();
    expect(a!.lat).toBeCloseTo(66 + 26 / 60 + 8.428 / 3600, 5);
    const b = parseTopSkyCoordPair("N056.40.2.182:E012.33.36.559");
    expect(b).not.toBeNull();
    expect(b!.lat).toBeCloseTo(56 + 40 / 60 + 2.182 / 3600, 5);
  });

  it("densifies circles with even step counts (10° → 36+close)", () => {
    const ring = densifyCircle(59.3, 17.8, 1.1, 10);
    expect(circleStepCount(10)).toBe(36);
    expect(ring.length).toBe(37); // closed
    expect(inferSpacingFromRing(ring)).toBeCloseTo(10, 5);
    const fine = redensifyBoundCircle(
      { lat: 59.3, lon: 17.8, radiusNm: 1.1 },
      5,
    );
    expect(fine.coordinates.length).toBe(73);
    expect(fine.circleSpacingDeg).toBe(5);
  });
});

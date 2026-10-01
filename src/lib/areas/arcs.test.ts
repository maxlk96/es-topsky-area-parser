import { describe, expect, it } from "vitest";
import {
  densifyArc,
  expandAipLateralCoords,
  hasPartialArcLateral,
  initialBearingDeg,
} from "./arcs";
import { parseCompactCoord } from "./coords";

describe("partial arc densify", () => {
  it("detects along-an-arc lateral limits", () => {
    expect(
      hasPartialArcLateral(
        "555623N 0142228E clockwise along an arc of 14.3 NM radius centred on 554402N 0140944E",
      ),
    ).toBe(true);
    expect(hasPartialArcLateral("circle with radius 12 NM centred on")).toBe(
      false,
    );
  });

  it("densifies clockwise arc between bearings (includes endpoints)", () => {
    const center = parseCompactCoord("554402N 0140944E")!;
    const start = parseCompactCoord("555623N 0142228E")!;
    const end = parseCompactCoord("553407N 0142753E")!;
    const pts = densifyArc(center, start, end, 14.3, true, 10);
    expect(pts.length).toBeGreaterThan(4);
    expect(pts[0]![1]).toBeCloseTo(start.lat, 5);
    expect(pts[0]![0]).toBeCloseTo(start.lon, 5);
    expect(pts[pts.length - 1]![1]).toBeCloseTo(end.lat, 5);
    // Not a full circle
    expect(pts.length).toBeLessThan(30);
    const a0 = initialBearingDeg(center.lat, center.lon, start.lat, start.lon);
    const a1 = initialBearingDeg(center.lat, center.lon, end.lat, end.lon);
    const span = (a1 - a0 + 360) % 360;
    expect(span).toBeGreaterThan(10);
    expect(span).toBeLessThan(350);
  });

  it("ESR34: expands arc + polyline (not full circle, not centre-as-only-ring)", () => {
    const text = `
ESR34 RAVLUNDA
555623N 0142228E clockwise along an arc of 14.3 NM radius centred on 554402N 0140944E -
553407N 0142753E - 554325N 0141146E - 554319N 0140919E - 554514N 0140819E -
554609N 0140954E - 554544N 0141144E to point of origin.
`;
    const ring = expandAipLateralCoords(text);
    // open vertices ≈ densified arc + 5 polyline points (closed adds +1)
    expect(ring.length).toBeGreaterThan(12);
    expect(ring.length).toBeLessThan(40);
    // centre must not be the only densify — first point is arc start
    const start = parseCompactCoord("555623N 0142228E")!;
    expect(ring[0]![1]).toBeCloseTo(start.lat, 4);
    expect(ring[0]![0]).toBeCloseTo(start.lon, 4);
  });

  it("ESR15A: sector pie slice with centre-first (ESAA style), not full circle", () => {
    const text = `
ESR15A VÄDDÖ
600816N 0185039E clockwise along an arc of 12 NM radius centred on 595632N 0185332E -
595038N 0191356E - 595632N 0185332E to point of origin.
`;
    const ring = expandAipLateralCoords(text);
    expect(ring.length).toBeGreaterThan(8);
    expect(ring.length).toBeLessThan(40);
    const center = parseCompactCoord("595632N 0185332E")!;
    expect(ring[0]![1]).toBeCloseTo(center.lat, 4);
    expect(ring[0]![0]).toBeCloseTo(center.lon, 4);
  });
});

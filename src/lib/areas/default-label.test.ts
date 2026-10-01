import { describe, expect, it } from "vitest";
import { defaultLabelPosition } from "./default-label";

describe("defaultLabelPosition", () => {
  it("returns null when area has no LABEL (never invent)", () => {
    expect(
      defaultLabelPosition({
        coordinates: [
          [18, 59],
          [18.1, 59],
          [18.1, 59.1],
          [18, 59],
        ],
        label: undefined,
      }),
    ).toBeNull();
  });

  it("uses boundCircle centre for full circles", () => {
    const pos = defaultLabelPosition({
      boundCircle: { lat: 56.141389, lon: 14.846944, radiusNm: 1.6 },
      coordinates: [
        [14.85, 56.14],
        [14.86, 56.14],
        [14.86, 56.15],
        [14.85, 56.14],
      ],
      label: { lat: 56.2, lon: 14.9, text: "STÄRNÖ" },
    });
    expect(pos).toEqual({ lat: 56.141389, lon: 14.846944 });
  });

  it("uses polygon centroid for non-circle areas", () => {
    const pos = defaultLabelPosition({
      coordinates: [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
      label: { lat: 9, lon: 9, text: "BOX" },
    });
    expect(pos!.lat).toBeCloseTo(1, 5);
    expect(pos!.lon).toBeCloseTo(1, 5);
  });

  it("falls back to first vertex when ring is too short for centroid", () => {
    const pos = defaultLabelPosition({
      coordinates: [[13.1, 55.6]],
      label: { lat: 0, lon: 0, text: "X" },
    });
    expect(pos).toEqual({ lat: 55.6, lon: 13.1 });
  });
});

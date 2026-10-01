import { describe, expect, it } from "vitest";
import { defaultLabelPosition, labelForAccept } from "./default-label";
import type { AreaRecord } from "./types";

function area(partial: Partial<AreaRecord> & { id: string }): AreaRecord {
  return {
    shortName: partial.shortName || partial.id.replace(/^ES/, ""),
    name: partial.name || "TEST",
    category: partial.category || "R",
    areaTypeCode: partial.areaTypeCode || "4F",
    coordinates: partial.coordinates || [
      [17, 59],
      [18, 59],
      [18, 60],
      [17, 59],
    ],
    directives: [],
    mapDefaultVisible: true,
    noaiw: false,
    provenance: partial.provenance || { source: "topsky" },
    rawBlock: partial.rawBlock || "",
    section: partial.section ?? "other",
    ...partial,
  };
}

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

  it("invent option generates position without an existing LABEL", () => {
    const pos = defaultLabelPosition(
      {
        boundCircle: { lat: 57.5, lon: 12.1, radiusNm: 2 },
        coordinates: [],
        label: undefined,
      },
      { invent: true },
    );
    expect(pos).toEqual({ lat: 57.5, lon: 12.1 });
  });
});

describe("labelForAccept", () => {
  it("keeps baseline LABEL coordinates on Accept (not circle centre)", () => {
    const existing = area({
      id: "ESR900",
      name: "OLD",
      boundCircle: { lat: 57.0, lon: 12.0, radiusNm: 3 },
      label: { lat: 57.12, lon: 12.34, text: "OLD" },
    });
    const candidate = area({
      id: "ESR900",
      name: "NEWNAME",
      provenance: { source: "enr51" },
      boundCircle: { lat: 57.0, lon: 12.0, radiusNm: 3 },
      label: { lat: 57.0, lon: 12.0, text: "NEWNAME" }, // AIP centre — must not win
    });
    const label = labelForAccept(candidate, existing);
    expect(label).toEqual({ lat: 57.12, lon: 12.34, text: "NEWNAME" });
  });

  it("does not invent LABEL for unlabeled baseline areas", () => {
    const existing = area({
      id: "ESR901",
      label: undefined,
    });
    const candidate = area({
      id: "ESR901",
      provenance: { source: "sup", supNumber: "1/2026" },
      label: { lat: 59, lon: 18, text: "X" },
    });
    expect(labelForAccept(candidate, existing)).toBeUndefined();
  });

  it("generates default LABEL for brand-new areas", () => {
    const candidate = area({
      id: "ESR902",
      name: "FRESH",
      provenance: { source: "sup", supNumber: "2/2026" },
      boundCircle: { lat: 56.5, lon: 13.5, radiusNm: 1 },
      label: undefined,
    });
    const label = labelForAccept(candidate, undefined);
    expect(label).toEqual({ lat: 56.5, lon: 13.5, text: "FRESH" });
  });

  it("keeps omit-label ids unlabeled", () => {
    const existing = area({
      id: "ESR94",
      shortName: "R94",
      label: { lat: 59, lon: 18, text: "X" },
    });
    const candidate = area({
      id: "ESR94",
      shortName: "R94",
      boundCircle: { lat: 59.1, lon: 18.1, radiusNm: 2 },
      label: { lat: 59.1, lon: 18.1, text: "X" },
    });
    expect(labelForAccept(candidate, existing)).toBeUndefined();
    expect(labelForAccept(candidate, undefined)).toBeUndefined();
  });
});

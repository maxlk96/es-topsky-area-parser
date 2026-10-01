import { describe, expect, it } from "vitest";
import type { AreaRecord } from "./types";
import {
  buildExportChangelog,
  formatExportChangelogText,
} from "./changelog";

function area(
  partial: Partial<AreaRecord> & Pick<AreaRecord, "id" | "shortName" | "name">,
): AreaRecord {
  return {
    category: "R",
    areaTypeCode: "3",
    coordinates: [
      [17.9, 59.3],
      [18.0, 59.3],
      [18.0, 59.4],
      [17.9, 59.3],
    ],
    limits: [0, 15],
    activation: { type: "ALWAYS" },
    directives: [],
    mapDefaultVisible: true,
    noaiw: false,
    provenance: { source: "topsky" },
    rawBlock: "",
    section: "other",
    ...partial,
  };
}

describe("export changelog", () => {
  it("lists new, changed, and removed vs baseline", () => {
    const baseline = [
      area({ id: "ESR111", shortName: "R111", name: "SÖRENTORP" }),
      area({
        id: "ESD140",
        shortName: "D140",
        name: "Bornholm West",
        category: "D",
        areaTypeCode: "4F",
      }),
      area({
        id: "ESR112",
        shortName: "R112",
        name: "VÄLLINGE",
        areaTypeCode: "4F",
        activation: { type: "AUP", key: "ESR112" },
        noaiw: true,
        directives: ["NOAIW"],
      }),
    ];
    const working = [
      area({
        id: "ESR94",
        shortName: "R94",
        name: "SÖRENTORP",
        areaTypeCode: "3",
        activation: { type: "ALWAYS" },
      }),
      area({
        id: "ESR112",
        shortName: "R112",
        name: "VÄLLINGE",
        areaTypeCode: "4F",
        activation: { type: "AUP", key: "ESR112" },
        noaiw: true,
        directives: ["NOAIW"],
        limits: [0, 60],
      }),
    ];
    const log = buildExportChangelog(baseline, working);
    expect(log.new.map((e) => e.id)).toEqual(["ESR94"]);
    expect(log.removed.map((e) => e.id).sort()).toEqual(["ESD140", "ESR111"]);
    expect(log.changed.map((e) => e.id)).toEqual(["ESR112"]);
    expect(log.changed[0]!.notes?.some((n) => /LIMITS/i.test(n))).toBe(true);

    const text = formatExportChangelogText(log, {
      baselineKind: "GitHub main",
      generatedAt: new Date("2026-10-01T12:00:00Z"),
    });
    expect(text).toContain("## New (1)");
    expect(text).toContain("ESR94  SÖRENTORP");
    expect(text).toContain("## Removed (2)");
    expect(text).toContain("ESD140  Bornholm West");
    expect(text).toContain("ESR111  SÖRENTORP");
    expect(text).toContain("## Changed (1)");
    expect(text).toContain("ESR112  VÄLLINGE");
  });
});

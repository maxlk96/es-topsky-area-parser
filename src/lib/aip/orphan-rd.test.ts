import { describe, expect, it } from "vitest";
import type { AreaRecord } from "@/lib/areas/types";
import {
  ORPHAN_RD_NOTE,
  enrPermanentRdIdSet,
  findOrphanPermanentRd,
  isPermanentRdArea,
  orphanRdDiffItems,
} from "./orphan-rd";

function rd(
  partial: Partial<AreaRecord> & Pick<AreaRecord, "id" | "shortName" | "name">,
): AreaRecord {
  return {
    category: partial.id.startsWith("ESD") ? "D" : "R",
    areaTypeCode: "4F",
    coordinates: [
      [15, 55],
      [15.1, 55],
      [15.1, 55.1],
      [15, 55],
    ],
    limits: [0, 50],
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

describe("orphan permanent R/D", () => {
  it("isPermanentRdArea skips tempo SUP and non-R/D", () => {
    expect(
      isPermanentRdArea(
        rd({
          id: "ESR500",
          shortName: "R500",
          name: "VRÅNGÖ",
          section: "tempo",
          provenance: { source: "topsky", supNumber: "145/26" },
        }),
      ),
    ).toBe(false);
    expect(
      isPermanentRdArea(
        rd({
          id: "A1",
          shortName: "A1",
          name: "PCA",
          category: "PCA",
          areaTypeCode: "T",
        }),
      ),
    ).toBe(false);
    expect(
      isPermanentRdArea(
        rd({ id: "ESD140", shortName: "D140", name: "Bornholm West" }),
      ),
    ).toBe(true);
  });

  it("finds ESR111 and ESD140 when absent from ENR set", () => {
    const working = [
      rd({ id: "ESR111", shortName: "R111", name: "SÖRENTORP" }),
      rd({ id: "ESD140", shortName: "D140", name: "Bornholm West" }),
      rd({ id: "ESR3", shortName: "R3", name: "Lower Part of River Kalix" }),
      rd({
        id: "ESR505",
        shortName: "R505",
        name: "LUGNET",
        section: "tempo",
        provenance: { source: "topsky", supNumber: "305/25" },
      }),
    ];
    const aip = [
      rd({
        id: "ESR03",
        shortName: "R3",
        name: "LOWER PART OF RIVER KALIX",
        provenance: { source: "enr51" },
      }),
      rd({
        id: "ESR94",
        shortName: "R94",
        name: "SÖRENTORP",
        provenance: { source: "enr51" },
      }),
    ];
    const ids = enrPermanentRdIdSet(aip);
    expect(ids.has("ESR3")).toBe(true); // ESR03 normalized
    expect(ids.has("ESR94")).toBe(true);

    const orphans = findOrphanPermanentRd(working, aip);
    expect(orphans.map((a) => a.id).sort()).toEqual(["ESD140", "ESR111"]);

    const diffs = orphanRdDiffItems(orphans);
    expect(diffs.every((d) => d.status === "removed")).toBe(true);
    expect(diffs[0]!.notes[0]).toBe(ORPHAN_RD_NOTE);
  });

  it("counts ENR excluded stubs (FIR / UAS / IFR) as present in AIP", () => {
    const working = [
      rd({ id: "ESR1", shortName: "R1", name: "Border" }),
    ];
    const aip = [
      rd({
        id: "ESR1",
        shortName: "R1",
        name: "BORDER",
        provenance: { source: "enr51" },
        exclusionReason: "fir_border",
        coordinates: [],
      }),
    ];
    expect(findOrphanPermanentRd(working, aip)).toEqual([]);
  });
});

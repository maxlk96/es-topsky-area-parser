import { describe, expect, it } from "vitest";
import {
  catalogueSupKeySet,
  findStaleTempoAreas,
  isStaleExcludedStub,
  isTempoSupArea,
  pruneStaleTempoAreas,
  staleTempoDiffItems,
  staleTempoReason,
  supCatalogueKey,
} from "./stale-tempo";
import type { AreaRecord } from "./types";
import { mergeTempoSection } from "./write-topsky";

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
    section: partial.section ?? "tempo",
    ...partial,
  };
}

describe("supCatalogueKey", () => {
  it("normalizes long and short SUP years", () => {
    expect(supCatalogueKey("146/2026")).toBe("146/26");
    expect(supCatalogueKey("146/26")).toBe("146/26");
  });
});

describe("stale tempo detection", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("ignores permanent ENR areas", () => {
    const enr = area({
      id: "ESR24",
      section: "other",
      provenance: { source: "enr51" },
    });
    expect(isTempoSupArea(enr)).toBe(false);
    expect(staleTempoReason(enr, { now, catalogueKeys: new Set() })).toBeNull();
  });

  it("flags validity ended", () => {
    const a = area({
      id: "ESR900",
      provenance: {
        source: "topsky",
        supNumber: "146/26",
        validTo: "01 SEP 2026",
      },
    });
    expect(staleTempoReason(a, { now })).toBe("validity_ended");
  });

  it("flags SUP missing from AMDT catalogue (e.g. 146/26)", () => {
    const a = area({
      id: "ESR900",
      provenance: {
        source: "topsky",
        supNumber: "146/26",
        validTo: "31 DEC 2026",
      },
    });
    const keys = catalogueSupKeySet([
      { number: "179/2026" },
      { number: "186/2026" },
    ]);
    expect(staleTempoReason(a, { now, catalogueKeys: keys })).toBe(
      "sup_not_in_amdt",
    );
    expect(
      staleTempoReason(a, {
        now,
        catalogueKeys: catalogueSupKeySet([{ number: "146/2026" }]),
      }),
    ).toBeNull();
  });

  it("prunes stale areas and builds expired diff rows", () => {
    const keep = area({
      id: "ESR901",
      provenance: {
        source: "topsky",
        supNumber: "179/2026",
        validTo: "31 DEC 2026",
      },
    });
    const gone = area({
      id: "ESR900",
      provenance: {
        source: "topsky",
        supNumber: "146/26",
        validTo: "31 DEC 2026",
      },
    });
    const permanent = area({
      id: "ESR24",
      section: "other",
      provenance: { source: "enr51" },
    });
    const keys = catalogueSupKeySet([{ number: "179/2026" }]);
    const { kept, removed } = pruneStaleTempoAreas([keep, gone, permanent], {
      now,
      catalogueKeys: keys,
    });
    expect(kept.map((a) => a.id)).toEqual(["ESR901", "ESR24"]);
    expect(removed).toHaveLength(1);
    expect(removed[0]!.reason).toBe("sup_not_in_amdt");
    const diffs = staleTempoDiffItems(removed);
    expect(diffs[0]!.status).toBe("expired");
    expect(diffs[0]!.notes.some((n) => /not in AMDT/i.test(n))).toBe(true);
  });

  it("findStaleTempoAreas skips tempo without SUP number when only catalogue is set", () => {
    const noSup = area({
      id: "ESR1",
      provenance: { source: "topsky" },
    });
    expect(
      findStaleTempoAreas([noSup], {
        now,
        catalogueKeys: new Set(["179/26"]),
      }),
    ).toHaveLength(0);
  });
});

describe("isStaleExcludedStub", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("drops expired and catalogue-missing stubs", () => {
    expect(
      isStaleExcludedStub("// 146/26 - Valid to 01 SEP 2026\n// EXCLUDED. ONLY UAS (BVLOS)", {
        now,
      }),
    ).toBe(true);
    expect(
      isStaleExcludedStub("// 146/26 - Valid to 31 DEC 2026\n// EXCLUDED. ONLY UAS (BVLOS)", {
        now,
        catalogueKeys: new Set(["179/26"]),
      }),
    ).toBe(true);
    expect(
      isStaleExcludedStub("// 146/26 - Valid to 31 DEC 2026\n// EXCLUDED. ONLY UAS (BVLOS)", {
        now,
        catalogueKeys: new Set(["146/26"]),
      }),
    ).toBe(false);
  });
});

describe("R505 HAKEFJORDEN (SUP 145/26) prune", () => {
  it("drops HAKEFJORDEN when 145/26 gone; keeps LUGNET (305/25)", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const lugnet = area({
      id: "ESR505",
      shortName: "R505",
      name: "LUGNET",
      provenance: {
        source: "topsky",
        supNumber: "305/25",
        validTo: "31 DEC 2026",
      },
    });
    const hake = area({
      id: "ESR505",
      shortName: "R505",
      name: "HAKEFJORDEN",
      provenance: {
        source: "topsky",
        supNumber: "145/26",
        validTo: "14 SEP 27",
      },
    });
    const keys = catalogueSupKeySet([
      { number: "305/2025" },
      { number: "179/2026" },
    ]);
    const { kept, removed } = pruneStaleTempoAreas([lugnet, hake], {
      now,
      catalogueKeys: keys,
    });
    expect(kept.map((a) => a.name)).toEqual(["LUGNET"]);
    expect(removed).toHaveLength(1);
    expect(removed[0]!.area.name).toBe("HAKEFJORDEN");
    expect(removed[0]!.reason).toBe("sup_not_in_amdt");
  });
});

describe("mergeTempoSection catalogue prune", () => {
  it("omits tempo SUP areas absent from catalogue on export", () => {
    const file = `//ESR24 DROTTNINGHOLM
AREA:3:  R24
ACTIVE:1
N059.20.26.000 E017.52.30.000

//      START OF TEMPO R AND D AREAS
// 146/26 - Valid to 31 DEC 2026
//ESR900 GONE
AREA:4F:  R900
LIMITS:0:50
N059.00.00.000 E017.00.00.000
N059.01.00.000 E017.00.00.000
N059.01.00.000 E017.01.00.000
N059.00.00.000 E017.00.00.000

// 179/26 - Valid to 31 DEC 2026
//ESR901 KEEP
AREA:4F:  R901
LIMITS:0:50
N058.00.00.000 E016.00.00.000
N058.01.00.000 E016.00.00.000
N058.01.00.000 E016.01.00.000
N058.00.00.000 E016.00.00.000

//      END OF TEMPO R AND D AREAS
`;
    const gone = area({
      id: "ESR900",
      shortName: "R900",
      name: "GONE",
      provenance: {
        source: "topsky",
        supNumber: "146/26",
        validTo: "31 DEC 2026",
      },
      rawBlock: "",
    });
    const keep = area({
      id: "ESR901",
      shortName: "R901",
      name: "KEEP",
      provenance: {
        source: "topsky",
        supNumber: "179/26",
        validTo: "31 DEC 2026",
      },
      rawBlock: "",
    });
    const out = mergeTempoSection(file, [gone, keep], {
      now: new Date("2026-06-01T12:00:00Z"),
      catalogueKeys: catalogueSupKeySet([{ number: "179/2026" }]),
    });
    expect(out).toContain("ESR901");
    expect(out).not.toContain("ESR900");
    expect(out).not.toContain("146/26");
    expect(out).toContain("179/26");
  });
});

import { describe, expect, it } from "vitest";
import { parseEnr51Html } from "./parse-enr51";
import { mergeAipReloadCandidates } from "./reload-aip";
import type { AreaRecord } from "@/lib/areas/types";

const ENR_SNIPPET = `
<html><body>
ESR41A RINGENÄS
564559N 0123350E - 564159N 0124050E - 564159N 0124340E - 564119N 0124410E -
564019N 0124220E - 563359N 0124220E - 563559N 0123310E - 563959N 0122950E -
564259N 0122950E to point of origin.
40500 ft AMSL
GND
Military aviation operations. Permission obtainable from STOCKHOLM ACC.
ESR117 NYNÄSHAMN
A circle with radius 1000 m centred on 585523N 0175804E.
1400 ft AMSL
GND
Oil refinery.
ESR03 LOWER PART OF RIVER KALIX
661128N 0230205E - 661000N 0231000E - 660500N 0230500E - 660800N 0225500E -
661128N 0230205E to point of origin.
UNL
GND
Military.
</body></html>
`;

function stub(over: Partial<AreaRecord>): AreaRecord {
  return {
    id: "ESR1",
    shortName: "R1",
    name: "TEST",
    category: "R",
    areaTypeCode: "4F",
    coordinates: [
      [18, 59],
      [18.1, 59],
      [18.1, 59.1],
      [18, 59],
    ],
    directives: [],
    mapDefaultVisible: true,
    noaiw: true,
    provenance: { source: "sup" },
    rawBlock: "",
    section: "tempo",
    ...over,
  };
}

describe("parseEnr51Html", () => {
  it("extracts R/D names, polygons, circles; normalizes ESR03→ESR3", () => {
    const areas = parseEnr51Html(ENR_SNIPPET, { amdtId: "test-amdt" });
    const r41 = areas.find((a) => a.id === "ESR41A")!;
    const r117 = areas.find((a) => a.id === "ESR117")!;
    const r3 = areas.find((a) => a.id === "ESR3")!;
    expect(r41.name).toBe("RINGENÄS");
    expect(r41.coordinates.length).toBeGreaterThanOrEqual(4);
    expect(r41.needsReview).toBeUndefined();
    expect(r117.name).toBe("NYNÄSHAMN");
    expect(r117.boundCircle?.radiusNm).toBeCloseTo(1000 / 1852, 3);
    expect(r117.name).not.toMatch(/</);
    expect(r3).toBeTruthy();
    expect(r3.name).toMatch(/KALIX/);
    expect(areas.every((a) => a.provenance.source === "enr51")).toBe(true);
  });
});

describe("mergeAipReloadCandidates", () => {
  it("lets non-expired SUP override ENR 5.1 for the same id", () => {
    const enr = [
      stub({
        id: "ESR534",
        shortName: "R534",
        name: "BRUNNA",
        provenance: { source: "enr51" },
        section: "other",
      }),
    ];
    const sup = [
      stub({
        id: "ESR534",
        shortName: "R534",
        name: "BRUNNA",
        provenance: {
          source: "sup",
          supNumber: "83/2026",
          validFrom: "30 MAR 2026",
          validTo: "31 DEC 2026",
        },
        section: "tempo",
      }),
    ];
    const merged = mergeAipReloadCandidates(enr, sup, {
      now: new Date("2026-10-01T12:00:00Z"),
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].provenance.source).toBe("sup");
    expect(merged[0].provenance.rawComment || "").toMatch(/overrides ENR 5\.1/);
  });
});

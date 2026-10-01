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
ESR1 ESRANGE
690336N 0203255E along the FIR BDRY to 683156N 0215935E - 681745N 0214612E -
675924N 0212754E - 674724N 0211613E - 674724N 0205443E - 675924N 0204843E -
682121N 0195516E along the FIR BDRY to point of origin.
UNL
GND
Rymdbas.
ESR113 STOCKHOLM
592015N 0180200E - 592010N 0180509E - 591914N 0180429E - 591940N 0180141E to point of origin.
1000 ft AMSL
GND
Drönarflygning är förbjuden.
Drone flying is prohibited.
Special authorization required from the Swedish Transport Agency except for drones.
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

  it("marks FIR BDRY areas as fir_border (manual only, no auto coords)", () => {
    const areas = parseEnr51Html(ENR_SNIPPET, { amdtId: "test-amdt" });
    const r1 = areas.find((a) => a.id === "ESR1")!;
    expect(r1).toBeTruthy();
    expect(r1.name).toBe("ESRANGE");
    expect(r1.exclusionReason).toBe("fir_border");
    expect(r1.coordinates).toEqual([]);
  });

  it("excludes ESR113 drone-prohibition area as uas_only", () => {
    const areas = parseEnr51Html(ENR_SNIPPET, { amdtId: "test-amdt" });
    const r113 = areas.find((a) => a.id === "ESR113")!;
    expect(r113).toBeTruthy();
    expect(r113.exclusionReason).toBe("uas_only");
    expect(r113.coordinates).toEqual([]);
  });

  it("ESR130-style 400 ft SFC lower limit → LIMITS 4", () => {
    const html = `
<html><body>
ESR130 MALMÖ
553902N 0130553E - 553830N 0130615E - 553722N 0130403E - 553628N 0130524E to point of origin.
1200 ft AMSL
400 ft SFC
Special permission by Swedish Transport Agency.
</body></html>`;
    const areas = parseEnr51Html(html, { amdtId: "test-amdt" });
    const r130 = areas.find((a) => a.id === "ESR130")!;
    expect(r130.limits).toEqual([4, 12]);
  });

  it("partial arcs densify (ESR34 / ESR15A); full-circle LABEL at centre", () => {
    const html = `
<html><body>
ESR34 RAVLUNDA
555623N 0142228E clockwise along an arc of 14.3 NM radius centred on 554402N 0140944E -
553407N 0142753E - 554325N 0141146E - 554319N 0140919E - 554514N 0140819E -
554609N 0140954E - 554544N 0141144E to point of origin.
17000 ft AMSL
GND
Military activities including aviation operations.
ESR15A VÄDDÖ
600816N 0185039E clockwise along an arc of 12 NM radius centred on 595632N 0185332E -
595038N 0191356E - 595632N 0185332E to point of origin.
40500 ft AMSL
GND
Military activities including aviation operations.
ESR117 NYNÄSHAMN
A circle with radius 1000 m centred on 585523N 0175804E.
1400 ft AMSL
GND
Oil refinery.
</body></html>`;
    const areas = parseEnr51Html(html, { amdtId: "test-amdt" });
    const r34 = areas.find((a) => a.id === "ESR34")!;
    const r15a = areas.find((a) => a.id === "ESR15A")!;
    const r117 = areas.find((a) => a.id === "ESR117")!;
    expect(r34.boundCircle).toBeUndefined();
    expect(r34.coordinates.length).toBeGreaterThan(12);
    expect(r15a.boundCircle).toBeUndefined();
    expect(r15a.coordinates.length).toBeGreaterThan(8);
    expect(r117.boundCircle).toBeTruthy();
    expect(r117.label?.lat).toBeCloseTo(r117.boundCircle!.lat, 5);
    expect(r117.label?.lon).toBeCloseTo(r117.boundCircle!.lon, 5);
  });

  it("ESR94 Sörentorp is parsed without an active LABEL", () => {
    const html = `
<html><body>
ESR94 SÖRENTORP
A circle with radius 0.5 NM centred on 592348N 0175929E.
1500 ft AMSL
GND
Särskilda tillstånd från Transportstyrelsen krävs förutom för svenska luftfartyg.
</body></html>`;
    const areas = parseEnr51Html(html, { amdtId: "test-amdt" });
    const r94 = areas.find((a) => a.id === "ESR94")!;
    expect(r94).toBeTruthy();
    expect(r94.boundCircle).toBeTruthy();
    expect(r94.label).toBeUndefined();
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

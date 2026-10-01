import { describe, expect, it } from "vitest";
import { diffCandidates } from "@/lib/areas/diff";
import type { AreaRecord } from "@/lib/areas/types";
import { parseEnr51Html } from "./parse-enr51";
import { parseSupHtml } from "./parse-sup";
import { mergeAipReloadCandidates } from "./reload-aip";
import {
  IFR_PLANNING_EXCLUSION,
  IFR_PLANNING_NOTE,
  isIfrPlanningOnlyArea,
  isIfrPlanningOnlyDesignator,
  isIfrPlanningOnlyText,
} from "./ifr-planning";

function stub(over: Partial<AreaRecord>): AreaRecord {
  return {
    id: "ESD184Z",
    shortName: "D184Z",
    name: "IFR FBZ",
    category: "D",
    areaTypeCode: "3",
    coordinates: [
      [18, 59],
      [18.1, 59],
      [18.1, 59.1],
      [18, 59],
    ],
    directives: [],
    mapDefaultVisible: true,
    noaiw: false,
    provenance: { source: "enr51" },
    rawBlock: "",
    section: "other",
    ...over,
  };
}

describe("IFR flight planning only exclusion", () => {
  it("flags ESD184Z / ESD185Z and short variants", () => {
    expect(isIfrPlanningOnlyDesignator("ESD184Z")).toBe(true);
    expect(isIfrPlanningOnlyDesignator("ESD185Z")).toBe(true);
    expect(isIfrPlanningOnlyDesignator("D184Z")).toBe(true);
    expect(isIfrPlanningOnlyDesignator("d185z")).toBe(true);
    expect(isIfrPlanningOnlyDesignator("ESD184")).toBe(false);
    expect(isIfrPlanningOnlyDesignator("ESD185")).toBe(false);
  });

  it("detects AIP IFR planning-only remarks", () => {
    expect(
      isIfrPlanningOnlyText(
        "FL 660 SFC Endast för färdplanering IFR. For IFR flight planning purposes only.",
      ),
    ).toBe(true);
    expect(isIfrPlanningOnlyText("Planned activities will be notified by eAUP.")).toBe(
      false,
    );
  });

  it("isIfrPlanningOnlyArea combines designator and reason", () => {
    expect(
      isIfrPlanningOnlyArea({
        id: "ESD184Z",
        shortName: "D184Z",
      }),
    ).toBe(true);
    expect(
      isIfrPlanningOnlyArea({
        id: "ESD171",
        exclusionReason: IFR_PLANNING_EXCLUSION,
      }),
    ).toBe(true);
  });

  it("ENR 5.1 marks both ESD184Z and ESD185Z as ifr_planning_only stubs", () => {
    const html = `
<html><body>
ESD184Z VIDSEL WEST FBZ
663000N 0190000E - 663000N 0200000E - 660000N 0200000E - 660000N 0190000E to point of origin.
FL 660
SFC
Endast för färdplanering IFR. For IFR flight planning purposes only.
ESD185Z VIDSEL EAST FBZ
663000N 0200000E - 663000N 0210000E - 660000N 0210000E - 660000N 0200000E to point of origin.
FL 660
SFC
For IFR flight planning purposes only.
ESD184 VIDSEL WEST
663000N 0190000E - 663000N 0200000E - 660000N 0200000E - 660000N 0190000E to point of origin.
FL 660
GND
Military activities including aviation operations.
</body></html>`;
    const areas = parseEnr51Html(html, { amdtId: "test-amdt" });
    const z184 = areas.find((a) => a.id === "ESD184Z")!;
    const z185 = areas.find((a) => a.id === "ESD185Z")!;
    const d184 = areas.find((a) => a.id === "ESD184")!;
    expect(z184.exclusionReason).toBe(IFR_PLANNING_EXCLUSION);
    expect(z184.coordinates).toEqual([]);
    expect(z185.exclusionReason).toBe(IFR_PLANNING_EXCLUSION);
    expect(z185.coordinates).toEqual([]);
    expect(d184.exclusionReason).toBeUndefined();
    expect(d184.coordinates.length).toBeGreaterThanOrEqual(4);
  });

  it("SUP Accept path never returns drawable IFR-planning FBZ", () => {
    const html = `
<html><body>
Temporary danger area – ESD185Z VIDSEL EAST FBZ
Temporary danger area ESD185Z established for IFR flight planning purposes only.
ESD185Z VIDSEL EAST FBZ
Vertical limit
663000N 0200000E – 663000N 0210000E – 660000N 0210000E – 660000N 0200000E –
663000N 0200000E.
FL 660
SFC
For IFR flight planning purposes only.
</body></html>`;
    const areas = parseSupHtml(html, {
      amdtId: "test",
      supNumber: "99/2026",
      href: "AIP SUP 99-2026/ES-SUP-en-GB.html",
    });
    expect(areas).toHaveLength(1);
    expect(areas[0]!.id).toBe("ESD185Z");
    expect(areas[0]!.exclusionReason).toBe(IFR_PLANNING_EXCLUSION);
    expect(areas[0]!.coordinates).toEqual([]);
  });

  it("diff marks IFR planning as excluded with clear note; baseline untouched", () => {
    const existing = stub({
      id: "ESD184",
      shortName: "D184",
      name: "VIDSEL WEST",
      exclusionReason: undefined,
    });
    const candidate = stub({
      id: "ESD184Z",
      shortName: "D184Z",
      exclusionReason: IFR_PLANNING_EXCLUSION,
      coordinates: [],
      provenance: {
        source: "enr51",
        rawComment: "For IFR flight planning purposes only.",
      },
    });
    const items = diffCandidates([existing], [candidate]);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe("excluded");
    expect(items[0]!.notes[0]).toBe(IFR_PLANNING_NOTE);
    expect(items[0]!.candidate.coordinates).toEqual([]);
    expect(items[0]!.existing).toBeUndefined();
  });

  it("reload keeps ENR IFR stubs and never adds/overwrites from SUP", () => {
    const enr = [
      stub({
        id: "ESD184Z",
        shortName: "D184Z",
        exclusionReason: IFR_PLANNING_EXCLUSION,
        coordinates: [],
        provenance: { source: "enr51" },
      }),
      stub({
        id: "ESD185Z",
        shortName: "D185Z",
        exclusionReason: IFR_PLANNING_EXCLUSION,
        coordinates: [],
        provenance: { source: "enr51" },
      }),
      stub({
        id: "ESD184",
        shortName: "D184",
        name: "VIDSEL WEST",
        exclusionReason: undefined,
        provenance: { source: "enr51" },
      }),
    ];
    const sup = [
      stub({
        id: "ESD184Z",
        shortName: "D184Z",
        coordinates: [
          [19, 66],
          [20, 66],
          [20, 66.1],
          [19, 66],
        ],
        exclusionReason: undefined,
        provenance: {
          source: "sup",
          supNumber: "1/2026",
          validFrom: "01 JAN 2026",
          validTo: "31 DEC 2026",
        },
        section: "tempo",
      }),
      stub({
        id: "ESD185Z",
        shortName: "D185Z",
        coordinates: [
          [20, 66],
          [21, 66],
          [21, 66.1],
          [20, 66],
        ],
        exclusionReason: IFR_PLANNING_EXCLUSION,
        provenance: {
          source: "sup",
          supNumber: "2/2026",
          validFrom: "01 JAN 2026",
          validTo: "31 DEC 2026",
        },
        section: "tempo",
      }),
    ];
    const merged = mergeAipReloadCandidates(enr, sup, {
      now: new Date("2026-10-01T12:00:00Z"),
    });
    const z184 = merged.find((a) => a.id === "ESD184Z")!;
    const z185 = merged.find((a) => a.id === "ESD185Z")!;
    const d184 = merged.find((a) => a.id === "ESD184")!;
    expect(z184.exclusionReason).toBe(IFR_PLANNING_EXCLUSION);
    expect(z184.coordinates).toEqual([]);
    expect(z184.provenance.source).toBe("enr51");
    expect(z185.exclusionReason).toBe(IFR_PLANNING_EXCLUSION);
    expect(z185.coordinates).toEqual([]);
    expect(d184.exclusionReason).toBeUndefined();
    expect(d184.coordinates.length).toBeGreaterThanOrEqual(4);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyLabelEdits,
  formatAreaBlock,
  patchLabelInBlock,
} from "./write-topsky";
import type { AreaRecord } from "./types";

function baseArea(over: Partial<AreaRecord> = {}): AreaRecord {
  return {
    id: "ESR105",
    shortName: "R105",
    name: "TEST",
    category: "R",
    areaTypeCode: "4F",
    coordinates: [
      [18.0, 59.3],
      [18.1, 59.3],
      [18.1, 59.4],
      [18.0, 59.4],
      [18.0, 59.3],
    ],
    directives: [],
    mapDefaultVisible: true,
    noaiw: true,
    provenance: { source: "topsky" },
    rawBlock: "",
    section: "other",
    ...over,
  };
}

describe("label placer export", () => {
  it("patches an existing LABEL line and never invents one", () => {
    const withLabel = `//ESR105 TEST
AREA:4F:  R105
NOAIW
LABEL:N059.20.00.000:E018.05.00.000:TEST
LIMITS:0:95
N059.30.00.000 E018.00.00.000
`;
    const unlabeled = `//ESR999 STOCKHOLM
AREA:3:  R999
LIMITS:0:25
N059.30.00.000 E018.00.00.000
`;
    const patched = patchLabelInBlock(withLabel, {
      lat: 59.25,
      lon: 18.1,
      text: "TEST",
    });
    expect(patched).toMatch(/LABEL:N0?59\.15\.00/);
    expect(patched).toContain("AREA:4F:  R105");

    const untouched = patchLabelInBlock(unlabeled, {
      lat: 59.25,
      lon: 18.1,
      text: "NOPE",
    });
    expect(untouched).toBe(unlabeled);
    expect(untouched).not.toMatch(/LABEL:/);
  });

  it("applyLabelEdits only rewrites labeled + labelEdited areas", () => {
    const file = `//ESR105 TEST
AREA:4F:  R105
LABEL:N059.20.00.000:E018.05.00.000:TEST
N059.30.00.000 E018.00.00.000

//ESR999 STOCKHOLM
AREA:3:  R999
N059.30.00.000 E018.00.00.000
`;
    const out = applyLabelEdits(file, [
      baseArea({
        label: { lat: 59.25, lon: 18.1, text: "TEST" },
        labelEdited: true,
      }),
      baseArea({
        id: "ESR999",
        shortName: "R999",
        name: "STOCKHOLM",
        areaTypeCode: "3",
        noaiw: false,
        label: undefined,
        labelEdited: true, // even if flagged, no LABEL in file → untouched
      }),
    ]);
    expect(out).toMatch(/ESR105[\s\S]*LABEL:N0?59\.15/);
    expect(out).toContain("//ESR999 STOCKHOLM");
    expect(out.indexOf("LABEL:", out.indexOf("ESR999"))).toBe(-1);
  });

  it("formatAreaBlock omits LABEL when area has none", () => {
    const block = formatAreaBlock(baseArea({ label: undefined }));
    expect(block).not.toMatch(/LABEL:/);
  });
});

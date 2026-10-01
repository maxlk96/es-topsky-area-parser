import { describe, expect, it } from "vitest";
import { diffCandidates } from "@/lib/areas/diff";
import type { AreaRecord } from "@/lib/areas/types";
import {
  FIR_BORDER_EXCLUSION,
  FIR_BORDER_NOTE,
  hasFirBorderLateralLimits,
} from "./fir-border";

describe("hasFirBorderLateralLimits", () => {
  it("detects FIR BDRY / along the FIR wording", () => {
    expect(
      hasFirBorderLateralLimits(
        "690336N 0203255E along the FIR BDRY to 683156N 0215935E",
      ),
    ).toBe(true);
    expect(
      hasFirBorderLateralLimits("thence along the Swedish FIR boundary to"),
    ).toBe(true);
    expect(hasFirBorderLateralLimits("riksgränsen till punkten")).toBe(true);
    expect(
      hasFirBorderLateralLimits(
        "564559N 0123350E - 564159N 0124050E to point of origin.",
      ),
    ).toBe(false);
  });
});

describe("diffCandidates fir_border", () => {
  it("excludes FIR-border candidates and leaves baseline untouched", () => {
    const existing: AreaRecord = {
      id: "ESR1",
      shortName: "R1",
      name: "ESRANGE",
      category: "R",
      areaTypeCode: "4F",
      coordinates: [
        [20.5, 69],
        [21.5, 68.5],
        [20, 68.3],
        [20.5, 69],
      ],
      directives: ["NOAIW"],
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "topsky" },
      rawBlock: "//ESR1 Esrange\nAREA:4F:  R1\n...",
      section: "other",
    };
    const candidate: AreaRecord = {
      ...existing,
      coordinates: [],
      exclusionReason: FIR_BORDER_EXCLUSION,
      provenance: {
        source: "enr51",
        rawComment: "690336N along the FIR BDRY to 683156N",
      },
    };
    const items = diffCandidates([existing], [candidate]);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("excluded");
    expect(items[0].notes[0]).toBe(FIR_BORDER_NOTE);
    expect(items[0].existing?.coordinates.length).toBeGreaterThan(3);
    expect(items[0].candidate.coordinates).toEqual([]);
  });
});

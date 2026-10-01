import { describe, expect, it } from "vitest";
import {
  isPcaSubPart,
  layerKeyFor,
  type LayerVisibility,
  isLayerVisible,
  DEFAULT_LAYER_VISIBILITY,
} from "./map-layers";
import type { AreaRecord } from "./types";

function stub(
  partial: Partial<AreaRecord> & Pick<AreaRecord, "category" | "shortName">,
): AreaRecord {
  return {
    id: partial.id ?? partial.shortName,
    name: partial.name ?? partial.shortName,
    areaTypeCode: "T",
    coordinates: [],
    limits: undefined,
    activation: { type: "NONE", raw: [] },
    directives: [],
    label: undefined,
    mapDefaultVisible: true,
    noaiw: false,
    provenance: { source: "topsky" },
    rawBlock: "",
    section: "other",
    ...partial,
  };
}

describe("map-layers", () => {
  it("splits PCA mains vs sub-parts", () => {
    expect(isPcaSubPart(stub({ category: "PCA", shortName: "A1" }))).toBe(false);
    expect(isPcaSubPart(stub({ category: "PCA", shortName: "A11" }))).toBe(true);
    expect(layerKeyFor(stub({ category: "PCA", shortName: "M51" }))).toBe("PCA_SUB");
  });

  it("classifies FS / TCT / STCA by AreaType (TMA names are TCT)", () => {
    expect(
      layerKeyFor(
        stub({ category: "OTHER", shortName: "FSGGCIE", areaTypeCode: "2F" }),
      ),
    ).toBe("FS");
    expect(
      layerKeyFor(
        stub({
          category: "OTHER",
          shortName: "ESOS TMA",
          name: "ESOS TMA",
          areaTypeCode: "TCTA",
        }),
      ),
    ).toBe("TCT");
    expect(
      layerKeyFor(
        stub({
          category: "OTHER",
          shortName: "ESOS TMA",
          name: "ESOS TMA",
          areaTypeCode: "TCT_I",
        }),
      ),
    ).toBe("TCT");
    expect(
      layerKeyFor(
        stub({
          category: "OTHER",
          shortName: "STCA1",
          name: "STCA test",
          areaTypeCode: "STCA",
        }),
      ),
    ).toBe("STCA");
    expect(
      layerKeyFor(
        stub({
          category: "OTHER",
          shortName: "EoR 01L",
          areaTypeCode: "S",
        }),
      ),
    ).toBe("OTHER");
  });

  it("defaults all layers visible except UAS-only", () => {
    const v: LayerVisibility = DEFAULT_LAYER_VISIBILITY;
    expect(isLayerVisible(stub({ category: "R", shortName: "R505" }), v)).toBe(true);
    expect(isLayerVisible(stub({ category: "D", shortName: "D309" }), v)).toBe(true);
    expect(
      isLayerVisible(
        stub({ category: "OTHER", shortName: "FSGGCIE", areaTypeCode: "2F" }),
        v,
      ),
    ).toBe(true);
    expect(
      isLayerVisible(
        stub({ category: "PCA", shortName: "A1", areaTypeCode: "T" }),
        v,
      ),
    ).toBe(true);
    expect(
      isLayerVisible(
        stub({
          category: "R",
          shortName: "R113",
          name: "STOCKHOLM (UAV only)",
          exclusionReason: "uas_only",
          mapDefaultVisible: false,
        }),
        v,
      ),
    ).toBe(false);
  });
});

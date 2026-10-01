import { describe, expect, it } from "vitest";
import {
  isPcaSubPart,
  layerKeyFor,
  type LayerVisibility,
  isLayerVisible,
  DEFAULT_LAYER_VISIBILITY,
} from "./map-layers";
import type { AreaRecord } from "./types";

function stub(partial: Partial<AreaRecord> & Pick<AreaRecord, "category" | "shortName">): AreaRecord {
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

describe("map-layers PCA / ATS", () => {
  it("splits PCA mains vs sub-parts", () => {
    expect(isPcaSubPart(stub({ category: "PCA", shortName: "A1" }))).toBe(false);
    expect(isPcaSubPart(stub({ category: "PCA", shortName: "G9" }))).toBe(false);
    expect(isPcaSubPart(stub({ category: "PCA", shortName: "A11" }))).toBe(true);
    expect(isPcaSubPart(stub({ category: "PCA", shortName: "I61" }))).toBe(true);
    expect(layerKeyFor(stub({ category: "PCA", shortName: "M5" }))).toBe("PCA");
    expect(layerKeyFor(stub({ category: "PCA", shortName: "M51" }))).toBe("PCA_SUB");
  });

  it("defaults only R/D visible", () => {
    const v: LayerVisibility = DEFAULT_LAYER_VISIBILITY;
    expect(isLayerVisible(stub({ category: "R", shortName: "R505" }), v)).toBe(true);
    expect(isLayerVisible(stub({ category: "D", shortName: "D309" }), v)).toBe(true);
    expect(isLayerVisible(stub({ category: "PCA", shortName: "A1" }), v)).toBe(false);
    expect(isLayerVisible(stub({ category: "PCA", shortName: "A11" }), v)).toBe(false);
    expect(
      isLayerVisible(
        stub({ category: "OTHER", shortName: "ESOS TMA", name: "ESOS TMA" }),
        v,
      ),
    ).toBe(false);
  });
});

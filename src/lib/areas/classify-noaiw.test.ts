import { describe, expect, it } from "vitest";
import {
  hasAviationFlyingWording,
  inferAreaTypeFromRemarks,
  mergeEnrAcceptPreservingNoaiw,
} from "./classify";
import type { AreaRecord } from "./types";

function stub(partial: Partial<AreaRecord> & Pick<AreaRecord, "id">): AreaRecord {
  return {
    shortName: partial.shortName ?? partial.id.replace(/^ES/, ""),
    name: partial.name ?? partial.id,
    category: partial.category ?? "R",
    areaTypeCode: partial.areaTypeCode ?? "4F",
    coordinates: partial.coordinates ?? [],
    directives: partial.directives ?? [],
    mapDefaultVisible: partial.mapDefaultVisible ?? true,
    noaiw: partial.noaiw ?? false,
    activation: partial.activation,
    provenance: partial.provenance ?? { source: "enr51" },
    rawBlock: partial.rawBlock ?? "",
    section: partial.section ?? "other",
    ...partial,
  };
}

describe("hasAviationFlyingWording", () => {
  it("matches military aviation operations / flygverksamhet", () => {
    expect(
      hasAviationFlyingWording(
        "Temporary restricted area ESR791 Möja established for military aviation operations.",
      ),
    ).toBe(true);
    expect(
      hasAviationFlyingWording("området upprättas för militär flygverksamhet."),
    ).toBe(true);
    expect(
      hasAviationFlyingWording(
        "Military activities including aviation operations with UAS. Permission obtainable from STOCKHOLM ACC.",
      ),
    ).toBe(true);
  });

  it("does not match bare military operations or exemption chrome", () => {
    expect(
      hasAviationFlyingWording(
        "Temporary restricted area ESR527 Stenshuvud established for military operations. Flight within the area prohibited for all non-participating ACFT. Exempted after permission from Malmö ACC: Military flights.",
      ),
    ).toBe(false);
  });
});

describe("inferAreaTypeFromRemarks NOAIW", () => {
  it("SUP 179/186-style military operations/activities → 4F without NOAIW", () => {
    const ops = inferAreaTypeFromRemarks(
      "Temporary restricted area ESR527 Stenshuvud established for military operations.",
    );
    expect(ops.areaTypeCode).toBe("4F");
    expect(ops.noaiw).toBe(false);
    expect(ops.reason).toBe("military_non_aviation");
    const acts = inferAreaTypeFromRemarks(
      "Temporary restricted area ESR739 Hyttefallet established for military activities.",
    );
    expect(acts.areaTypeCode).toBe("4F");
    expect(acts.noaiw).toBe(false);
    expect(acts.reason).toBe("military_non_aviation");
  });

  it("military aviation operations → 4F + NOAIW", () => {
    const r = inferAreaTypeFromRemarks(
      "Temporary restricted area ESR791 Möja established for military aviation operations.",
    );
    expect(r.areaTypeCode).toBe("4F");
    expect(r.noaiw).toBe(true);
    expect(r.reason).toBe("flying_or_ats_permission");
  });
});

describe("mergeEnrAcceptPreservingNoaiw", () => {
  it("keeps baseline noaiw=false for legacy permanent 4F when candidate also omits it", () => {
    const existing = stub({
      id: "ESR1A",
      areaTypeCode: "4F",
      noaiw: false,
      directives: [],
      activation: { type: "ALWAYS" },
      provenance: { source: "topsky" },
    });
    const candidate = stub({
      id: "ESR1A",
      areaTypeCode: "4F",
      noaiw: false,
      directives: [],
      activation: { type: "ALWAYS" },
      provenance: { source: "enr51", amdtId: "test" },
    });
    const merged = mergeEnrAcceptPreservingNoaiw(candidate, existing);
    expect(merged.noaiw).toBe(false);
    expect(merged.directives).not.toContain("NOAIW");
    expect(merged.activation).toEqual({ type: "ALWAYS" });
  });

  it("adds NOAIW for ENR 5.1 §2.2.1 candidate even when baseline lacked it", () => {
    const existing = stub({
      id: "ESR3",
      areaTypeCode: "4F",
      noaiw: false,
      directives: [],
      activation: { type: "AUP", key: "ESR3" },
    });
    const candidate = stub({
      id: "ESR3",
      areaTypeCode: "4F",
      noaiw: true,
      directives: ["NOAIW"],
      activation: { type: "AUP", key: "ESR3" },
      provenance: { source: "enr51", amdtId: "test" },
    });
    const merged = mergeEnrAcceptPreservingNoaiw(candidate, existing);
    expect(merged.noaiw).toBe(true);
    expect(merged.directives).toContain("NOAIW");
  });

  it("keeps baseline noaiw=true when already present", () => {
    const existing = stub({
      id: "ESD171",
      areaTypeCode: "4F",
      noaiw: true,
      directives: ["NOAIW"],
      activation: { type: "AUP", key: "ESD171" },
    });
    const candidate = stub({
      id: "ESD171",
      areaTypeCode: "4F",
      noaiw: true,
      directives: ["NOAIW"],
      activation: { type: "AUP", key: "ESD171" },
      provenance: { source: "enr51" },
    });
    const merged = mergeEnrAcceptPreservingNoaiw(candidate, existing);
    expect(merged.noaiw).toBe(true);
    expect(merged.directives).toContain("NOAIW");
  });

  it("does not alter new SUP candidates", () => {
    const candidate = stub({
      id: "ESR527",
      noaiw: false,
      provenance: { source: "sup", supNumber: "179/2026" },
      section: "tempo",
    });
    expect(mergeEnrAcceptPreservingNoaiw(candidate, undefined)).toBe(candidate);
  });
});

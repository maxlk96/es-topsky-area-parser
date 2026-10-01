import { describe, expect, it } from "vitest";
import {
  areasEquivalent,
  diffCandidates,
  explainAreaChanges,
  mergeCandidateAreas,
  mergeDiffItems,
  sortDiffItems,
} from "./diff";
import type { AreaRecord, DiffItem } from "./types";

function stub(over: Partial<AreaRecord> = {}): AreaRecord {
  return {
    id: "ESR7",
    shortName: "R7",
    name: "TEST",
    category: "R",
    areaTypeCode: "4F",
    coordinates: [
      [18, 59],
      [18.1, 59],
      [18.1, 59.1],
      [18, 59.1],
      [18, 59],
    ],
    limits: [0, 110],
    directives: [],
    mapDefaultVisible: true,
    noaiw: true,
    provenance: { source: "topsky" },
    rawBlock: "",
    section: "other",
    ...over,
  };
}

describe("explainAreaChanges", () => {
  it("ignores close-ring duplicate (N vs N+1)", () => {
    const open = stub({
      coordinates: [
        [18, 59],
        [18.1, 59],
        [18.1, 59.1],
        [18, 59.1],
      ],
    });
    const closed = stub();
    expect(explainAreaChanges(open, closed)).toEqual([]);
    expect(areasEquivalent(open, closed)).toBe(true);
  });

  it("ignores sub-tolerance vertex noise", () => {
    const a = stub();
    const b = stub({
      coordinates: [
        [18.00001, 59.00001],
        [18.1, 59],
        [18.1, 59.1],
        [18, 59.1],
        [18.00001, 59.00001],
      ],
    });
    expect(explainAreaChanges(a, b)).toEqual([]);
  });

  it("reports LIMITS and vertex-count changes", () => {
    const a = stub({ limits: [0, 335] });
    const b = stub({
      limits: [0, 355],
      coordinates: [
        [18, 59],
        [18.1, 59],
        [18.1, 59.1],
        [18, 59.1],
        [18.05, 59.05],
        [18, 59],
      ],
      provenance: { source: "enr51" },
    });
    const reasons = explainAreaChanges(a, b);
    expect(reasons.some((r) => r.includes("LIMITS"))).toBe(true);
    expect(reasons.some((r) => r.includes("Coords"))).toBe(true);
  });

  it("compares circles by centre/radius, not densified rings", () => {
    const a = stub({
      boundCircle: { lat: 59, lon: 18, radiusNm: 1 },
      coordinates: [
        [18, 59],
        [18.1, 59],
        [18, 59.1],
        [18, 59],
      ],
    });
    const b = stub({
      boundCircle: { lat: 59, lon: 18, radiusNm: 1 },
      coordinates: Array.from({ length: 37 }, (_, i) => {
        const ang = (i / 36) * Math.PI * 2;
        return [18 + 0.01 * Math.cos(ang), 59 + 0.01 * Math.sin(ang)] as [
          number,
          number,
        ];
      }),
      provenance: { source: "enr51" },
    });
    expect(explainAreaChanges(a, b)).toEqual([]);
  });
});

describe("diffCandidates reasons", () => {
  it("puts change reasons on changed rows and marks close-ring as present", () => {
    const existing = [
      stub({
        id: "ESR12",
        coordinates: [
          [18, 59],
          [18.1, 59],
          [18.1, 59.1],
          [18, 59.1],
        ],
      }),
      stub({ id: "ESR13", limits: [0, 335] }),
    ];
    const candidates = [
      stub({
        id: "ESR12",
        coordinates: [
          [18, 59],
          [18.1, 59],
          [18.1, 59.1],
          [18, 59.1],
          [18, 59],
        ],
        provenance: { source: "enr51" },
      }),
      stub({
        id: "ESR13",
        limits: [0, 355],
        provenance: { source: "enr51" },
      }),
    ];
    const items = diffCandidates(existing, candidates);
    const r12 = items.find((i) => i.candidate.id === "ESR12")!;
    const r13 = items.find((i) => i.candidate.id === "ESR13")!;
    expect(r12.status).toBe("present");
    expect(r13.status).toBe("changed");
    expect(r13.notes.some((n) => n.includes("LIMITS 0:335 → 0:355"))).toBe(true);
  });

  it("labels ENR 5.1 + AUP without saying permanent (ESD171)", () => {
    const existing = [
      stub({
        id: "ESD171",
        shortName: "D171",
        name: "HÄRNÖN EAST",
        category: "D",
        activation: { type: "AUP", key: "ESD171" },
      }),
    ];
    const candidates = [
      stub({
        id: "ESD171",
        shortName: "D171",
        name: "HÄRNON EAST",
        category: "D",
        activation: { type: "AUP", key: "ESD171" },
        provenance: { source: "enr51" },
      }),
    ];
    const item = diffCandidates(existing, candidates)[0]!;
    expect(item.notes).toContain("ENR 5.1");
    expect(item.notes).toContain("AUP activation");
    expect(item.notes.some((n) => /permanent/i.test(n))).toBe(false);
  });

  it("flags NOAIW-only ENR 5.1 §2.2.1 updates as changed", () => {
    const ring: [number, number][] = [
      [22.7, 66.3],
      [23.2, 66.3],
      [23.2, 66.1],
      [22.7, 66.1],
      [22.7, 66.3],
    ];
    const existing = [
      stub({
        id: "ESR3",
        shortName: "R3",
        name: "LOWER PART OF RIVER KALIX",
        noaiw: false,
        directives: [],
        coordinates: ring,
      }),
    ];
    const candidates = [
      stub({
        id: "ESR3",
        shortName: "R3",
        name: "LOWER PART OF RIVER KALIX",
        noaiw: true,
        directives: ["NOAIW"],
        coordinates: ring,
        provenance: { source: "enr51" },
      }),
    ];
    const item = diffCandidates(existing, candidates)[0]!;
    expect(item.status).toBe("changed");
    expect(item.notes).toContain("NOAIW added");
  });
});

describe("mergeDiffItems / mergeCandidateAreas", () => {
  it("accumulates by id — newer batch replaces same designator, keeps others", () => {
    const prev: DiffItem[] = [
      {
        status: "changed",
        candidate: stub({
          id: "ESR3",
          provenance: { source: "enr51" },
        }),
        notes: ["ENR 5.1"],
      },
      {
        status: "new",
        candidate: stub({
          id: "ESR791",
          provenance: { source: "sup", supNumber: "185/2026" },
        }),
        notes: ["SUP 185/2026"],
      },
    ];
    const incoming: DiffItem[] = [
      {
        status: "changed",
        candidate: stub({
          id: "A1",
          shortName: "A1",
          category: "PCA",
          areaTypeCode: "T",
          provenance: { source: "vatiris_pca" },
        }),
        notes: ["vatiris echarts PCA"],
      },
      {
        status: "present",
        candidate: stub({
          id: "ESR3",
          provenance: { source: "enr51" },
        }),
        notes: ["ENR 5.1", "updated"],
      },
    ];
    const merged = mergeDiffItems(prev, incoming);
    expect(merged.map((d) => d.candidate.id).sort()).toEqual([
      "A1",
      "ESR3",
      "ESR791",
    ]);
    expect(merged.find((d) => d.candidate.id === "ESR3")!.notes).toContain(
      "updated",
    );
    expect(merged.find((d) => d.candidate.id === "ESR791")).toBeTruthy();
  });

  it("sorts stacked groups ENR → SUP → PCA", () => {
    const items = sortDiffItems([
      {
        status: "changed",
        candidate: stub({
          id: "A1",
          provenance: { source: "vatiris_pca" },
        }),
        notes: [],
      },
      {
        status: "new",
        candidate: stub({
          id: "ESR791",
          provenance: { source: "sup", supNumber: "185/2026" },
        }),
        notes: [],
      },
      {
        status: "changed",
        candidate: stub({
          id: "ESR3",
          provenance: { source: "enr51" },
        }),
        notes: [],
      },
    ]);
    expect(items.map((d) => d.candidate.id)).toEqual([
      "ESR3",
      "ESR791",
      "A1",
    ]);
  });

  it("orders SUP verify rows by SUP number, not excluded-after-new", () => {
    const items = sortDiffItems([
      {
        status: "new",
        candidate: stub({
          id: "ESR791",
          provenance: { source: "sup", supNumber: "185/2026" },
        }),
        notes: [],
      },
      {
        status: "excluded",
        candidate: stub({
          id: "ESD865",
          provenance: { source: "sup", supNumber: "191/2026" },
          exclusionReason: "uas_only",
        }),
        notes: [],
      },
      {
        status: "excluded",
        candidate: stub({
          id: "ESD821",
          provenance: { source: "sup", supNumber: "111/2026" },
          exclusionReason: "uas_only",
        }),
        notes: [],
      },
    ]);
    expect(items.map((d) => d.candidate.provenance.supNumber)).toEqual([
      "191/2026",
      "185/2026",
      "111/2026",
    ]);
  });

  it("merges drawable candidates by id", () => {
    const a = stub({ id: "ESR3", provenance: { source: "enr51" } });
    const b = stub({
      id: "A1",
      provenance: { source: "vatiris_pca" },
    });
    const a2 = stub({
      id: "ESR3",
      name: "KALIX",
      provenance: { source: "enr51" },
    });
    const merged = mergeCandidateAreas([a, b], [a2]);
    expect(merged).toHaveLength(2);
    expect(merged.find((x) => x.id === "ESR3")!.name).toBe("KALIX");
  });
});

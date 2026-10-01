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
  it("omits unchanged close-ring matches; keeps real LIMITS changes", () => {
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
    expect(items.find((i) => i.candidate.id === "ESR12")).toBeUndefined();
    const r13 = items.find((i) => i.candidate.id === "ESR13")!;
    expect(r13.status).toBe("changed");
    expect(r13.notes.some((n) => n.includes("LIMITS 0:335 → 0:355"))).toBe(true);
  });

  it("omits densification-only vertex churn as unchanged", () => {
    const base: [number, number][] = [
      [15.0, 59.48],
      [15.01, 59.45],
      [14.9, 59.4],
      [14.85, 59.42],
      [15.0, 59.48],
    ];
    // Insert edge midpoints — same polygon, denser ring (AIP arc expand).
    const densified: [number, number][] = [];
    for (let i = 0; i < base.length - 1; i++) {
      const [lon1, lat1] = base[i]!;
      const [lon2, lat2] = base[i + 1]!;
      densified.push([lon1, lat1]);
      densified.push([(lon1 + lon2) / 2, (lat1 + lat2) / 2]);
    }
    densified.push(base[base.length - 1]!);
    const existing = [
      stub({
        id: "ESR18",
        shortName: "R18",
        name: "BOFORS, VILLINGSBERG",
        coordinates: base,
      }),
    ];
    const candidates = [
      stub({
        id: "ESR18",
        shortName: "R18",
        name: "BOFORS, VILLINGSBERG",
        coordinates: densified,
        provenance: { source: "enr51" },
      }),
    ];
    expect(diffCandidates(existing, candidates)).toEqual([]);
  });

  it("labels ENR 5.1 + AUP without saying permanent (ESD171)", () => {
    const ring: [number, number][] = [
      [18.3, 62.6],
      [18.4, 62.6],
      [18.4, 62.5],
      [18.3, 62.5],
      [18.3, 62.6],
    ];
    const existing = [
      stub({
        id: "ESD171",
        shortName: "D171",
        name: "HÄRNÖN EAST",
        category: "D",
        activation: { type: "AUP", key: "ESD171" },
        coordinates: ring,
        noaiw: true,
        directives: ["NOAIW"],
      }),
    ];
    const candidates = [
      stub({
        id: "ESD171",
        shortName: "D171",
        name: "HÄRNÖN EAST",
        category: "D",
        activation: { type: "AUP", key: "ESD171" },
        coordinates: ring,
        noaiw: true,
        directives: ["NOAIW"],
        provenance: { source: "enr51" },
        // Real change so the row is emitted (unchanged rows are omitted).
        limits: [0, 405],
      }),
    ];
    const item = diffCandidates(existing, candidates)[0]!;
    expect(item.status).toBe("changed");
    expect(item.notes).toContain("ENR 5.1");
    expect(item.notes).toContain("AUP activation");
    expect(item.notes.some((n) => /permanent/i.test(n))).toBe(false);
  });

  it("ignores NOAIW/AREA/ACTIVE-only diffs when footprint matches (already-correct TopSky)", () => {
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
        activation: { type: "ALWAYS" },
      }),
      stub({
        id: "ESR102",
        shortName: "R102",
        name: "HAGA",
        areaTypeCode: "4F",
        noaiw: true,
        directives: ["NOAIW"],
        activation: { type: "ALWAYS" },
        boundCircle: { lat: 59.3639, lon: 18.0389, radiusNm: 0.54 },
        coordinates: [
          [18.0389, 59.3739],
          [18.0489, 59.3639],
          [18.0389, 59.3539],
          [18.0289, 59.3639],
          [18.0389, 59.3739],
        ],
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
        activation: { type: "AUP", key: "ESR3" },
        provenance: { source: "enr51" },
      }),
      stub({
        id: "ESR102",
        shortName: "R102",
        name: "HAGA",
        areaTypeCode: "3",
        noaiw: false,
        directives: [],
        activation: { type: "AUP", key: "ESR102" },
        boundCircle: { lat: 59.3639, lon: 18.0389, radiusNm: 0.54 },
        coordinates: [
          [18.0389, 59.3739],
          [18.0489, 59.3639],
          [18.0389, 59.3539],
          [18.0289, 59.3639],
          [18.0389, 59.3739],
        ],
        provenance: { source: "enr51" },
      }),
    ];
    expect(diffCandidates(existing, candidates)).toEqual([]);
  });

  it("still flags real LIMITS / geometry changes (with policy notes)", () => {
    const ring: [number, number][] = [
      [18, 59],
      [18.1, 59],
      [18.1, 59.1],
      [18, 59.1],
      [18, 59],
    ];
    const items = diffCandidates(
      [stub({ id: "ESR13", limits: [0, 335], coordinates: ring })],
      [
        stub({
          id: "ESR13",
          limits: [0, 355],
          coordinates: ring,
          noaiw: true,
          provenance: { source: "enr51" },
        }),
      ],
    );
    expect(items[0]!.status).toBe("changed");
    expect(items[0]!.notes.some((n) => n.includes("LIMITS"))).toBe(true);
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
        // Unchanged on re-diff → drop prior ESR3 changed row.
        status: "present",
        candidate: stub({
          id: "ESR3",
          provenance: { source: "enr51" },
        }),
        notes: ["ENR 5.1"],
      },
    ];
    const merged = mergeDiffItems(prev, incoming);
    expect(merged.map((d) => d.candidate.id).sort()).toEqual([
      "A1",
      "ESR791",
    ]);
    expect(merged.find((d) => d.candidate.id === "ESR3")).toBeUndefined();
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

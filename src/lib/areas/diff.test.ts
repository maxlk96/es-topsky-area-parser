import { describe, expect, it } from "vitest";
import { areasEquivalent, diffCandidates, explainAreaChanges } from "./diff";
import type { AreaRecord } from "./types";

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
});

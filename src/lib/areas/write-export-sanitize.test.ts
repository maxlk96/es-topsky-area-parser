import { describe, expect, it } from "vitest";
import { toTopSkyCoord } from "./coords";
import {
  applyAcceptedAreaBlocks,
  formatAreaBlock,
  formatExcludedSupStub,
  formatLabelLine,
  formatSupNumberShort,
  formatSupValidityLine,
  formatTempoAreaBlocks,
  mergeTempoSection,
  needsFullBlockRewrite,
  sanitizeExportedTopSkyText,
} from "./write-topsky";
import type { AreaRecord } from "./types";

function tempoArea(partial: Partial<AreaRecord> & Pick<AreaRecord, "id" | "shortName" | "name">): AreaRecord {
  return {
    category: "R",
    areaTypeCode: "4F",
    coordinates: [
      [14.1, 58.5],
      [14.2, 58.5],
      [14.2, 58.6],
      [14.1, 58.5],
    ],
    limits: [0, 40],
    activation: { type: "AUP", key: partial.id },
    directives: ["NOAIW"],
    label: { lat: 58.55, lon: 14.15, text: partial.name },
    mapDefaultVisible: true,
    noaiw: true,
    provenance: { source: "sup", supNumber: "182/2025", validTo: "31 AUG 2026" },
    rawBlock: "",
    section: "tempo",
    ...partial,
  };
}

describe("export TopSky validity", () => {
  it("formatAreaBlock uses Nddd pad and never seconds=60", () => {
    const area: AreaRecord = {
      id: "ESR768",
      shortName: "R768",
      name: "TJÅMOTIS",
      category: "R",
      areaTypeCode: "4F",
      coordinates: [
        [18.5316667, 67.715],
        [19.8622222, 66.5986111],
        [15 + 24 / 60 + 59.7 / 3600, 58 + 39 / 60 + 26 / 3600],
        [18.5316667, 67.715],
      ],
      limits: [70, 660],
      activation: { type: "AUP", key: "ESR768" },
      directives: ["NOAIW"],
      label: {
        lat: 66 + 55 / 60 + 55 / 3600,
        lon: 17 + 55 / 60 + 59.9 / 3600,
        text: "TJÅMOTIS",
      },
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "sup" },
      rawBlock: "",
      section: "tempo",
    };
    const block = formatAreaBlock(area);
    expect(block).toMatch(/LABEL:N066\./);
    expect(block).toMatch(/^N0\d{2}\./m);
    expect(block).not.toMatch(/\.60\.000/);
  });

  it("sanitize strips trailing spaces and space-only lines", () => {
    const raw = [
      "AREA:4F:  R1",
      "LIMITS:0:110           ",
      "N065.21.21.000 E015.31.08.000 ",
      " ",
      "//next",
      "",
    ].join("\n");
    const out = sanitizeExportedTopSkyText(raw);
    expect(out).toContain("LIMITS:0:110\n");
    expect(out).toContain("N065.21.21.000 E015.31.08.000\n");
    expect(out.split("\n").some((l) => l.length > 0 && !l.trim())).toBe(false);
  });

  it("LABEL sanitizes junk and pads centre coords", () => {
    expect(formatLabelLine({ lat: 58.92, lon: 17.967, text: "NYN<äSHAMN " })).toBe(
      `LABEL:${toTopSkyCoord(58.92, 17.967).replace(" ", ":")}:NYNÄSHAMN`,
    );
  });

  it("rewrites accepted ENR permanent blocks (not only LABEL)", () => {
    const file = `//ESR130 MALMÖ
AREA:3:  R130
ACTIVE:1
LABEL:N055.35.25.966:E013.01.54.062:MALMÖ
LIMITS:4:12
N055.39.02.000 E013.05.53.000
N055.38.30.000 E013.06.15.000
N055.37.22.000 E013.04.03.000
N055.39.02.000 E013.05.53.000

//      START OF TEMPO R AND D AREAS
//      END OF TEMPO R AND D AREAS
`;
    const accepted: AreaRecord = {
      id: "ESR130",
      shortName: "R130",
      name: "MALMÖ",
      category: "R",
      areaTypeCode: "3",
      coordinates: [
        [13.1, 55.6],
        [13.2, 55.6],
        [13.2, 55.7],
        [13.1, 55.6],
      ],
      limits: [4, 12],
      activation: { type: "ALWAYS" },
      directives: [],
      label: { lat: 55.65, lon: 13.15, text: "MALMÖ" },
      mapDefaultVisible: true,
      noaiw: false,
      provenance: { source: "enr51" },
      rawBlock: "",
      section: "other",
    };
    expect(needsFullBlockRewrite(accepted)).toBe(true);
    const out = applyAcceptedAreaBlocks(file, [accepted]);
    expect(out).toMatch(/LIMITS:4:12/);
    expect(out).toMatch(/N055\.36\.00\.000 E013\.06\.00\.000/);
    expect(out).toMatch(/LABEL:N055\./);
    expect(out).not.toContain("N055.39.02.000 E013.05.53.000");
    expect(out).toContain("START OF TEMPO");
  });

  it("leaves untouched topsky rawBlock alone", () => {
    const area: AreaRecord = {
      id: "ESR130",
      shortName: "R130",
      name: "MALMÖ",
      category: "R",
      areaTypeCode: "3",
      coordinates: [[13, 55], [13.1, 55], [13.1, 55.1], [13, 55]],
      limits: [0, 12],
      directives: [],
      mapDefaultVisible: true,
      noaiw: false,
      provenance: { source: "topsky" },
      rawBlock: "//ESR130 MALMÖ\nAREA:3:  R130\nLIMITS:4:12\n",
      section: "other",
    };
    expect(needsFullBlockRewrite(area)).toBe(false);
  });

  it("shortens SUP numbers and formats Valid-to / EXCLUDED stubs", () => {
    expect(formatSupNumberShort("182/2025")).toBe("182/25");
    expect(formatSupNumberShort("182/25")).toBe("182/25");
    const a = tempoArea({ id: "ESR797", shortName: "R797", name: "MOHOLM" });
    expect(formatSupValidityLine(a)).toBe("// 182/25 - Valid to 31 AUG 2026");
    expect(formatExcludedSupStub({
      ...a,
      exclusionReason: "uas_only",
      provenance: { source: "sup", supNumber: "197/2025", validTo: "31 AUG 2026" },
    })).toBe("// 197/25 - Valid to 31 AUG 2026\n// EXCLUDED. ONLY UAS (BVLOS)\n");
  });

  it("groups rewritten SUP areas under one Valid-to header", () => {
    const a = tempoArea({ id: "ESR797", shortName: "R797", name: "MOHOLM" });
    const b = tempoArea({ id: "ESR798", shortName: "R798", name: "OTHER" });
    const out = formatTempoAreaBlocks([a, b]);
    expect(out.match(/\/\/ 182\/25 - Valid to 31 AUG 2026/g)).toHaveLength(1);
    expect(out).toContain("//ESR797 MOHOLM");
    expect(out).toContain("//ESR798 OTHER");
    expect(out.indexOf("Valid to")).toBeLessThan(out.indexOf("//ESR797"));
  });

  it("mergeTempoSection emits Valid-to for accepted SUP and keeps EXCLUDED stubs", () => {
    const file = `//ESR24 DROTTNINGHOLM
AREA:3:  R24
LIMITS:0:20
ACTIVE:1
N059.20.26.000 E017.52.30.000

//      START OF TEMPO R AND D AREAS
// 280/25 - Valid to 31 AUG 2026
// EXCLUDED. ONLY UAS (BVLOS)

//      END OF TEMPO R AND D AREAS
`;
    const accepted = tempoArea({
      id: "ESR797",
      shortName: "R797",
      name: "MOHOLM",
      rawBlock: "",
      provenance: { source: "sup", supNumber: "182/2025", validTo: "31 AUG 2026" },
    });
    const out = mergeTempoSection(file, [accepted], {
      now: new Date("2026-06-01T12:00:00Z"),
    });
    expect(out).toContain("// 182/25 - Valid to 31 AUG 2026");
    expect(out).toContain("//ESR797 MOHOLM");
    expect(out).toContain("// 280/25 - Valid to 31 AUG 2026");
    expect(out).toContain("// EXCLUDED. ONLY UAS (BVLOS)");
  });

  it("does not emit // NO AUP ACTIVATION when ACTIVE:1 (or other non-AUP ACTIVE) is present", () => {
    const always = tempoArea({
      id: "ESR130",
      shortName: "R130",
      name: "MALMÖ",
      activation: { type: "ALWAYS" },
      provenance: { source: "sup", supNumber: "1/2026", validTo: "31 DEC 2026" },
      rawBlock: "",
    });
    const scheduled = tempoArea({
      id: "ESR31",
      shortName: "R31",
      name: "KARLSÖ",
      activation: {
        type: "SCHEDULE",
        raw: ["ACTIVE:0315:0815:1234567:0000:2359"],
      },
      provenance: { source: "sup", supNumber: "2/2026", validTo: "31 DEC 2026" },
      rawBlock: "",
    });
    const out = formatTempoAreaBlocks([always, scheduled]);
    expect(out).not.toContain("// NO AUP ACTIVATION");
    expect(out).toContain("ACTIVE:1");
    expect(formatAreaBlock(always)).not.toContain("// NO AUP ACTIVATION");
  });

  it("re-emits // NO AUP ACTIVATION for preserved manual tempo SUP areas", () => {
    const file = `//      START OF TEMPO R AND D AREAS
// 299/25 - Valid to 31 DEC 2026
// NO AUP ACTIVATION

//ESD309 ARGUS
AREA:4F:  D309
NOAIW
LABEL:N057.45.38.379:E015.51.58.559:ARGUS
LIMITS:520:660
N059.24.37.000 E020.15.55.000
N059.13.36.000 E020.35.51.000
N056.25.02.000 E012.12.46.000
N056.38.47.000 E012.02.05.000
N059.24.37.000 E020.15.55.000

//      END OF TEMPO R AND D AREAS
`;
    const d309 = tempoArea({
      id: "ESD309",
      shortName: "D309",
      name: "ARGUS",
      category: "D",
      activation: { type: "MANUAL" },
      provenance: { source: "topsky", supNumber: "299/25", validTo: "31 DEC 2026" },
      rawBlock: `// 299/25 - Valid to 31 DEC 2026
//ESD309 ARGUS
AREA:4F:  D309
NOAIW
LABEL:N057.45.38.379:E015.51.58.559:ARGUS
LIMITS:520:660
N059.24.37.000 E020.15.55.000
N059.13.36.000 E020.35.51.000
N056.25.02.000 E012.12.46.000
N056.38.47.000 E012.02.05.000
N059.24.37.000 E020.15.55.000
`,
    });
    const out = mergeTempoSection(file, [d309], {
      now: new Date("2026-06-01T12:00:00Z"),
    });
    expect(out).toContain("// 299/25 - Valid to 31 DEC 2026");
    expect(out).toContain("// NO AUP ACTIVATION");
    expect(out).toContain("//ESD309 ARGUS");
    expect(out).not.toMatch(/ACTIVE:AUP:ESD309/);
  });

  it("ESR94 emits // NO LABEL and never an active LABEL", () => {
    const r94: AreaRecord = {
      id: "ESR94",
      shortName: "R94",
      name: "SÖRENTORP",
      category: "R",
      areaTypeCode: "3",
      coordinates: [
        [17.9914, 59.3967],
        [17.995, 59.3967],
        [17.995, 59.4],
        [17.9914, 59.3967],
      ],
      limits: [0, 15],
      activation: { type: "ALWAYS" },
      directives: [],
      // Even if a centre label sneaks in, export must suppress it.
      label: { lat: 59.3966667, lon: 17.9913889, text: "SÖRENTORP" },
      mapDefaultVisible: true,
      noaiw: false,
      boundCircle: { lat: 59.3966667, lon: 17.9913889, radiusNm: 0.5 },
      provenance: { source: "enr51" },
      rawBlock: "",
      section: "other",
    };
    const block = formatAreaBlock(r94, { includeSupHeader: false });
    expect(block).toContain("// NO LABEL");
    expect(block).toMatch(/\/\/LABEL:N059\./);
    expect(block).not.toMatch(/(^|\n)LABEL:/);
    expect(needsFullBlockRewrite(r94)).toBe(true);
  });

  it("sanitize rewrites legacy seconds=60, pads Nddd, cleans LABEL junk", () => {
    const raw = [
      "LABEL:N66.55.55.000:E017.55.60.000:TJÅMOTIS",
      "LABEL:N058.55.23.000:E017.58.04.000:NYN<äSHAMN",
      "N58.39.26.000 E015.24.60.000",
      "N64.46.04.000 E018.42.60.000",
    ].join("\n");
    const out = sanitizeExportedTopSkyText(raw);
    expect(out).not.toMatch(/\.60\.000/);
    expect(out).not.toMatch(/NYN</);
    expect(out).toContain("NYNÄSHAMN");
    expect(out).toMatch(/LABEL:N066\./);
    expect(out).toMatch(/^N058\./m);
  });
});

import { describe, expect, it } from "vitest";
import { toTopSkyCoord } from "./coords";
import {
  applyAcceptedAreaBlocks,
  ensureOmitLabelMarkers,
  findSectionBannerSpan,
  formatAreaBlock,
  formatExcludedSupStub,
  formatLabelLine,
  formatSupNumberShort,
  isSectionBannerLine,
  formatSupValidityLine,
  formatTempoAreaBlocks,
  mergeTempoSection,
  needsFullBlockRewrite,
  sanitizeExportedTopSkyText,
  TEMPO_END_BANNER,
  TEMPO_START_BANNER,
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

  it("ESR94 / ESR102 / ESR127 emit // NO LABEL and never an active LABEL", () => {
    for (const spec of [
      {
        id: "ESR94",
        shortName: "R94",
        name: "SÖRENTORP",
        lat: 59.3966667,
        lon: 17.9913889,
      },
      {
        id: "ESR102",
        shortName: "R102",
        name: "HAGA",
        lat: 59.3638889,
        lon: 18.0388889,
      },
      {
        id: "ESR127",
        shortName: "R127",
        name: "SOLNA",
        lat: 59.3525,
        lon: 18.0105556,
      },
    ] as const) {
      const area: AreaRecord = {
        id: spec.id,
        shortName: spec.shortName,
        name: spec.name,
        category: "R",
        areaTypeCode: "3",
        coordinates: [
          [spec.lon, spec.lat],
          [spec.lon + 0.01, spec.lat],
          [spec.lon + 0.01, spec.lat + 0.01],
          [spec.lon, spec.lat],
        ],
        limits: [0, 15],
        activation: { type: "ALWAYS" },
        directives: [],
        label: { lat: spec.lat, lon: spec.lon, text: spec.name },
        mapDefaultVisible: true,
        noaiw: false,
        boundCircle: { lat: spec.lat, lon: spec.lon, radiusNm: 0.5 },
        provenance: { source: "enr51" },
        rawBlock: "",
        section: "other",
      };
      const block = formatAreaBlock(area, { includeSupHeader: false });
      expect(block).toContain("// NO LABEL");
      expect(block).toMatch(/\/\/LABEL:N059\./);
      expect(block).not.toMatch(/(^|\n)LABEL:/);
      expect(needsFullBlockRewrite(area)).toBe(true);
    }
  });

  it("inserts new permanent R/D after END OF TEMPO in ESAA order (not file top)", () => {
    const file = `// intro

${TEMPO_START_BANNER}

//ESR700 TEMP
AREA:4F:  R700

${TEMPO_END_BANNER}

//ESR93 STYRSÖ
AREA:4F:  R93
ACTIVE:AUP:ESR93
LABEL:N057.36.31.964:E011.45.33.870:STYRSÖ
LIMITS:0:999
N057.39.18.000 E011.43.17.000
N057.39.18.000 E011.47.01.000
N057.37.21.000 E011.47.35.000
N057.39.18.000 E011.43.17.000

//ESR95 MARSTRAND
AREA:4F:  R95
ACTIVE:AUP:ESR95
LABEL:N057.55.54.799:E011.41.47.102:MARSTRAND
LIMITS:0:999
N057.57.11.000 E011.43.06.000
N057.56.23.000 E011.44.50.000
N057.54.35.000 E011.42.22.000
N057.57.11.000 E011.43.06.000

//      MILITARY EXERCISE AREAS (PCA)
//A1
AREA:T: A1
`;
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
      mapDefaultVisible: true,
      noaiw: false,
      boundCircle: { lat: 59.3966667, lon: 17.9913889, radiusNm: 0.5 },
      provenance: { source: "enr51" },
      rawBlock: "",
      section: "other",
    };
    const out = applyAcceptedAreaBlocks(file, [r94]);
    const iStart = out.indexOf("START OF TEMPO");
    const iEnd = out.indexOf("END OF TEMPO");
    const i93 = out.indexOf("//ESR93");
    const i94 = out.indexOf("//ESR94");
    const i95 = out.indexOf("//ESR95");
    expect(i94).toBeGreaterThan(iEnd);
    expect(i94).toBeGreaterThan(i93);
    expect(i94).toBeLessThan(i95);
    expect(i94).toBeGreaterThan(iStart);
    // Must not float to the top (before TEMPO).
    expect(i94).toBeGreaterThan(iStart);
    const r94Block = out.slice(i94, i95);
    expect(r94Block).toContain("// NO LABEL");
    expect(r94Block).not.toMatch(/(^|\n)LABEL:/);
  });

  it("ensureOmitLabelMarkers stamps // NO LABEL on R102 / R127 file blocks", () => {
    const file = `//ESR102 Haga
AREA:4F:  R102
//LABEL:N059.21.50.000:E018.02.20.000:HAGA
ACTIVE:1
LIMITS:0:20

//ESR127 SOLNA (UAV Only)
//AREA:3:  R127
//ACTIVE:AUP:ESR127
//LABEL:N059.21.09.000:E018.00.38.000:SOLNA
//LIMITS:0:20
//N059.21.38.980 E018.00.38.000
`;
    const out = ensureOmitLabelMarkers(file);
    expect(out).toMatch(/AREA:4F:\s+R102\n\/\/ NO LABEL/);
    expect(out).toMatch(/\/\/AREA:3:\s+R127\n\/\/ NO LABEL/);
    expect(out).not.toMatch(/(^|\n)LABEL:/);
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

  it("findSectionBannerSpan keeps //// START //// as one contiguous block", () => {
    const file = `//note

${TEMPO_START_BANNER}

//ESD1 X
AREA:4F:  D1

${TEMPO_END_BANNER}
`;
    const start = findSectionBannerSpan(file, "START OF TEMPO R AND D AREAS")!;
    const end = findSectionBannerSpan(file, "END OF TEMPO R AND D AREAS")!;
    expect(file.slice(start.start, start.end).trim()).toBe(TEMPO_START_BANNER);
    expect(file.slice(end.start, end.end).trim()).toBe(TEMPO_END_BANNER);
  });

  it("does not emit orphan //// + // stubs; preserves full SOARING SECTORS banner", () => {
    const soaring = `/////////////////////////////////////////////////////////////////////
//
//      SOARING SECTORS
//
//      Naming syntax: FSxxyyy
//      FS=flygsport
//      xx=ICAO (ESSD=SD)
//      yyy=name shortening (Horn=HOR)
//
//      https://flygsport.se/grenar/segelflyg/segelflyget/verksamhet/luftrum
//
//      2025-rev3
//
/////////////////////////////////////////////////////////////////////`;
    const file = `${TEMPO_START_BANNER}

// 144/26 - Valid to 10 SEP 27
//ESR728 BONA
AREA:4F:  R728
NOAIW
ACTIVE:AUP:ESR728
LABEL:N058.39.05.197:E015.06.07.799:BONA
LIMITS:16:100
N058.44.48.000 E014.58.58.000
N058.40.28.000 E015.14.39.000
N058.44.48.000 E014.58.58.000

${TEMPO_END_BANNER}

//A99 LAST PCA
AREA:T: A99
NOAIW
LABEL:N060.00.00.000:E018.00.00.000:A99
LIMITS:0:999
N060.01.00.000 E018.01.00.000
N060.02.00.000 E018.01.00.000
N060.01.00.000 E018.01.00.000

${soaring}

//ESSD EAGLE
AREA:2F:FSSDEAG
NOSAP
NOAIW
LABEL:N060.04.38.110:E015.31.01.735:EAGLE
LIMITS:45:90
N060.11.13.000 E015.23.53.000
N060.07.30.000 E015.52.54.000
N060.11.13.000 E015.23.53.000
`;
    // Simulate legacy rawBlock that swallowed END-banner opening crumbs.
    const tempo728: AreaRecord = {
      id: "ESR728",
      shortName: "R728",
      name: "BONA",
      category: "R",
      areaTypeCode: "4F",
      coordinates: [
        [14.98, 58.74],
        [15.24, 58.67],
        [14.98, 58.74],
      ],
      limits: [16, 100],
      activation: { type: "AUP", key: "ESR728" },
      directives: ["NOAIW"],
      label: { lat: 58.65, lon: 15.1, text: "BONA" },
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "topsky", supNumber: "144/26", validTo: "10 SEP 27" },
      rawBlock: `// 144/26 - Valid to 10 SEP 27
//ESR728 BONA
AREA:4F:  R728
NOAIW
ACTIVE:AUP:ESR728
LABEL:N058.39.05.197:E015.06.07.799:BONA
LIMITS:16:100
N058.44.48.000 E014.58.58.000
N058.40.28.000 E015.14.39.000
N058.44.48.000 E014.58.58.000
/////////////////////////////////////////////////////////////////////
//
`,
      section: "tempo",
    };
    const pca: AreaRecord = {
      id: "ESA99",
      shortName: "A99",
      name: "A99",
      category: "PCA",
      areaTypeCode: "T",
      coordinates: [
        [18.01, 60.01],
        [18.01, 60.02],
        [18.01, 60.01],
      ],
      limits: [0, 999],
      activation: { type: "NONE" },
      directives: ["NOAIW"],
      label: { lat: 60, lon: 18, text: "A99" },
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "vatiris_pca" },
      rawBlock: "",
      section: "other",
    };
    expect(isSectionBannerLine("//      SOARING SECTORS")).toBe(true);
    const out = applyAcceptedAreaBlocks(
      mergeTempoSection(file, [tempo728], {
        now: new Date("2026-06-01T12:00:00Z"),
      }),
      [pca],
    );
    // Full END banner once — not a lone //// + // stub before the next area.
    expect(out.match(/\/{20,}/g)?.length).toBeGreaterThanOrEqual(4);
    expect(out).not.toMatch(
      /\/{20,}\n\/\/\n\n\/\/ESR728/i,
    );
    expect(out).toContain(TEMPO_END_BANNER);
    // Full SOARING banner preserved even when last PCA is rewritten.
    expect(out).toContain("//      SOARING SECTORS");
    expect(out).toContain("//      Naming syntax: FSxxyyy");
    expect(out).toContain("//      2025-rev3");
    expect(out).toContain("https://flygsport.se/grenar/segelflyg");
    const soar = findSectionBannerSpan(out, "SOARING SECTORS")!;
    expect(soar).toBeTruthy();
    expect(out.slice(soar.start, soar.end).trim()).toBe(soaring);
  });

  it("mergeTempoSection preserves full START/END banners and orders EXCLUDED by SUP number", () => {
    const file = `//ESR24 DROTTNINGHOLM
AREA:3:  R24

${TEMPO_START_BANNER}

// 100/26 - Valid to 31 AUG 2026
// EXCLUDED. ONLY UAS (BVLOS)

${TEMPO_END_BANNER}
`;
    const accepted = tempoArea({
      id: "ESR797",
      shortName: "R797",
      name: "MOHOLM",
      rawBlock: "",
      provenance: {
        source: "sup",
        supNumber: "182/2025",
        validTo: "31 AUG 2026",
      },
    });
    const excluded = tempoArea({
      id: "ESD865",
      shortName: "D865",
      name: "UAS",
      exclusionReason: "uas_only",
      coordinates: [],
      rawBlock: "",
      provenance: {
        source: "sup",
        supNumber: "191/2026",
        validTo: "31 DEC 2026",
      },
    });
    const out = mergeTempoSection(file, [accepted, excluded], {
      now: new Date("2026-06-01T12:00:00Z"),
    });
    expect(out).toContain(TEMPO_START_BANNER);
    expect(out).toContain(TEMPO_END_BANNER);
    // Banners stay contiguous (not split by content lines).
    expect(out).toMatch(
      /\/{20,}\n\/\/\n\/\/\s+START OF TEMPO R AND D AREAS\n\/\/\n\/{20,}/,
    );
    expect(out).toMatch(
      /\/{20,}\n\/\/\n\/\/\s+END OF TEMPO R AND D AREAS\n\/\/\n\/{20,}/,
    );
    // Newest SUP number first (not included-then-excluded):
    // 191/2026 excl → 100/2026 excl → 182/2025 active.
    const i191 = out.indexOf("// 191/26");
    const i182 = out.indexOf("// 182/25");
    const i100 = out.indexOf("// 100/26");
    expect(i191).toBeGreaterThan(-1);
    expect(i182).toBeGreaterThan(-1);
    expect(i100).toBeGreaterThan(-1);
    expect(i191).toBeLessThan(i100);
    expect(i100).toBeLessThan(i182);
  });
});

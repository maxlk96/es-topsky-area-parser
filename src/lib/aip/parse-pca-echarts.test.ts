import { describe, expect, it } from "vitest";
import {
  mergePcaAcceptPreservingLabel,
  normalizePcaLocation,
  parsePcaEchartsFeatureCollection,
  webMercatorToWgs84,
} from "./parse-pca-echarts";
import type { AreaRecord } from "@/lib/areas/types";
import {
  applyAcceptedAreaBlocks,
  formatAreaBlock,
  needsFullBlockRewrite,
} from "@/lib/areas/write-topsky";

describe("parse-pca-echarts", () => {
  it("converts Web Mercator close to TopSky A1 vertex", () => {
    // From live EXEA A1 first vertex ≈ N060.17.58 E018.12.47
    const { lat, lon } = webMercatorToWgs84(2027200.5, 8471200.0);
    // Loose check — exact metres vary; just ensure Sweden-ish.
    expect(lat).toBeGreaterThan(55);
    expect(lat).toBeLessThan(70);
    expect(lon).toBeGreaterThan(10);
    expect(lon).toBeLessThan(25);
  });

  it("normalizes LOCATION and rejects CTR/TMA junk", () => {
    expect(normalizePcaLocation("A1")).toBe("A1");
    expect(normalizePcaLocation("a11")).toBe("A11");
    expect(normalizePcaLocation("C1 med ")).toBeNull();
    expect(normalizePcaLocation("JOKKMOKK CTR")).toBeNull();
  });

  it("parses EXEA feature into AREA:T PCA with LIMITS", () => {
    // Synthetic square in EPSG:3857 around Stockholm-ish
    const x0 = 2000000;
    const y0 = 8250000;
    const fc = {
      features: [
        {
          properties: {
            LOCATION: "A1",
            NAMEOFAREA: "ES A1",
            UPPER: "UNL",
            LOWER: "GND",
            WEF: "2026-10-01",
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [x0, y0],
                [x0 + 10000, y0],
                [x0 + 10000, y0 + 10000],
                [x0, y0 + 10000],
                [x0, y0],
              ],
            ],
          },
        },
      ],
    };
    const areas = parsePcaEchartsFeatureCollection(fc, "main");
    expect(areas).toHaveLength(1);
    const a = areas[0]!;
    expect(a.id).toBe("A1");
    expect(a.category).toBe("PCA");
    expect(a.areaTypeCode).toBe("T");
    expect(a.noaiw).toBe(true);
    expect(a.limits).toEqual([0, 999]);
    expect(a.coordinates.length).toBeGreaterThanOrEqual(4);
    expect(a.provenance.source).toBe("vatiris_pca");
    expect(a.label).toBeTruthy();
  });

  it("Accept preserves existing LABEL coordinates", () => {
    const existing: AreaRecord = {
      id: "A1",
      shortName: "A1",
      name: "A1",
      category: "PCA",
      areaTypeCode: "T",
      coordinates: [
        [18, 60],
        [18.1, 60],
        [18.1, 60.1],
        [18, 60],
      ],
      limits: [0, 999],
      directives: ["NOAIW", "NOAPW", "NOSAP"],
      label: { lat: 60.25, lon: 18.19, text: "A1" },
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "topsky" },
      rawBlock: "//A1\nAREA:T: A1\n",
      section: "other",
    };
    const candidate: AreaRecord = {
      ...existing,
      coordinates: [
        [18.2, 60.2],
        [18.3, 60.2],
        [18.3, 60.3],
        [18.2, 60.2],
      ],
      label: { lat: 60.25, lon: 18.25, text: "A1" }, // echarts centroid — must not win
      provenance: { source: "vatiris_pca" },
      rawBlock: "",
      directives: ["NOAIW", "NOAPW"],
    };
    const merged = mergePcaAcceptPreservingLabel(candidate, existing);
    expect(merged.label?.lat).toBeCloseTo(60.25, 5);
    expect(merged.label?.lon).toBeCloseTo(18.19, 5);
    expect(merged.coordinates[0]?.[0]).toBeCloseTo(18.2, 5);
    expect(merged.directives).toContain("NOSAP");
    expect(merged.rawBlock).toBe("");
    expect(needsFullBlockRewrite(merged)).toBe(true);
  });

  it("format/export PCA keeps LABEL and emits NOAPW", () => {
    const area: AreaRecord = {
      id: "A1",
      shortName: "A1",
      name: "A1",
      category: "PCA",
      areaTypeCode: "T",
      coordinates: [
        [18.213, 60.299],
        [18.55, 60.266],
        [18.5, 60.2],
        [18.213, 60.299],
      ],
      limits: [0, 999],
      directives: ["NOAIW", "NOAPW"],
      label: { lat: 60.24822, lon: 18.18755, text: "A1" },
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "vatiris_pca" },
      rawBlock: "",
      section: "other",
    };
    const block = formatAreaBlock(area, { includeSupHeader: false });
    expect(block).toMatch(/^\/\/A1$/m);
    expect(block).toContain("AREA:T: A1");
    expect(block).toContain("NOAIW");
    expect(block).toContain("NOAPW");
    expect(block).toMatch(/LABEL:N060\./);
    expect(block).toContain(":A1");

    const file = `//      MILITARY EXERCISE AREAS (PCA)
//
/////////////////////////////////////////////////////////////////////

//A1
AREA:T: A1
NOAIW
NOAPW
LABEL:N060.14.53.609:E018.11.15.178:A1
LIMITS:0:999
N060.17.58.000 E018.12.47.000
N060.15.58.000 E018.33.17.000
N059.43.46.000 E018.57.42.000
N060.17.58.000 E018.12.47.000

//A11
AREA:T: A11
NOAIW
NOAPW
LABEL:N060.11.47.004:E017.40.01.728:A11
LIMITS:0:999
N060.17.58.000 E018.12.47.000
N059.14.58.000 E017.44.48.000
N058.57.58.000 E017.24.28.000
N060.17.58.000 E018.12.47.000
`;
    const out = applyAcceptedAreaBlocks(file, [area]);
    // Must not swallow A11
    expect(out).toContain("//A11");
    expect(out).toMatch(/LABEL:N060\.14\.53|LABEL:N060\.248|LABEL:N060\./);
    // Preserved label coords from area (60.24822 → N060.14.53-ish)
    expect(out).toMatch(/LABEL:N060\.14\./);
  });
});

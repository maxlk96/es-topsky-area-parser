import { describe, expect, it } from "vitest";
import { toTopSkyCoord } from "./coords";
import {
  applyAcceptedAreaBlocks,
  formatAreaBlock,
  formatLabelLine,
  needsFullBlockRewrite,
  sanitizeExportedTopSkyText,
} from "./write-topsky";
import type { AreaRecord } from "./types";

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
});

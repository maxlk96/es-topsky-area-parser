import { describe, expect, it } from "vitest";
import { parseTopSkyText } from "./parse-topsky";

const SAMPLE = `
//      START OF TEMPO R AND D AREAS
// 299/25 - Valid to 31 DEC 2026
//ESD309 ARGUS
AREA:4F:  D309
NOAIW
ACTIVE:AUP:ESD309
LABEL:N057.45.38.379:E015.51.58.559:ARGUS
LIMITS:520:660
N059.24.37.000 E020.15.55.000
N059.13.36.000 E020.35.51.000
N056.25.02.000 E012.12.46.000
N056.38.47.000 E012.02.05.000
N059.24.37.000 E020.15.55.000

//      END OF TEMPO R AND D AREAS

//ESR24 Drottningholm
AREA:3:  R24
LIMITS:0:020
ACTIVE:1
N059.20.26.000 E017.52.30.000
N059.20.24.879 E017.52.52.434
N059.19.20.000 E017.52.30.000
N059.20.26.000 E017.52.30.000
`;

describe("parseTopSkyText", () => {
  it("parses tempo 4F and permanent 3", () => {
    const { areas } = parseTopSkyText(SAMPLE);
    const d309 = areas.find((a) => a.shortName === "D309");
    const r24 = areas.find((a) => a.shortName === "R24");
    expect(d309).toBeTruthy();
    expect(d309!.areaTypeCode).toBe("4F");
    expect(d309!.noaiw).toBe(true);
    expect(d309!.limits).toEqual([520, 660]);
    expect(d309!.section).toBe("tempo");
    expect(d309!.coordinates.length).toBeGreaterThanOrEqual(4);
    expect(r24!.areaTypeCode).toBe("3");
    expect(r24!.noaiw).toBe(false);
    expect(r24!.mapDefaultVisible).toBe(true);
  });
});

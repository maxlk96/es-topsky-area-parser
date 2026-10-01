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

//ESR2 Vidsel GND-UNL
AREA:4F:  R2
ACTIVE:AUP:ESR2
LABEL:N066.26.8.428:E018.56.56.216:VIDSEL
LIMITS:0:999
N066.54.54.000 E018.34.45.000
N066.35.55.000 E019.51.44.000
N066.07.55.000 E020.22.44.000
N066.54.54.000 E018.34.45.000

//ESR41A RINGENÄS
AREA:4F:  R41A
NOAIW
ACTIVE:AUP:ESR41A
LABEL:N056.40.2.182:E012.33.36.559:RINGENÄS
LIMITS:0:405
N056.45.59.000 E012.33.50.000
N056.41.59.000 E012.40.50.000
N056.41.59.000 E012.43.40.000
N056.45.59.000 E012.33.50.000

//ESR999
AREA:4F:  R999
NOAIW
ACTIVE:AUP:ESR999
LIMITS:0:50
N059.00.00.000 E018.00.00.000
N059.01.00.000 E018.00.00.000
N059.01.00.000 E018.01.00.000
N059.00.00.000 E018.00.00.000
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
    expect(d309!.name).toBe("ARGUS");
    expect(r24!.areaTypeCode).toBe("3");
    expect(r24!.noaiw).toBe(false);
    expect(r24!.mapDefaultVisible).toBe(true);
    expect(r24!.name).toBe("DROTTNINGHOLM");
  });

  it("keeps AIP names from unpadded LABEL coords and //ES comments", () => {
    const { areas } = parseTopSkyText(SAMPLE);
    const r2 = areas.find((a) => a.id === "ESR2")!;
    const r41 = areas.find((a) => a.id === "ESR41A")!;
    expect(r2.name).toBe("VIDSEL");
    expect(r2.label?.text).toBe("VIDSEL");
    expect(r2.label!.lat).toBeGreaterThan(66);
    expect(r2.needsReview).toBeUndefined();
    expect(r41.name).toBe("RINGENÄS");
    expect(r41.label?.text).toBe("RINGENÄS");
    expect(r41.needsReview).toBeUndefined();
  });

  it("flags R/D without AIP name as needs_review", () => {
    const { areas } = parseTopSkyText(SAMPLE);
    const r999 = areas.find((a) => a.id === "ESR999")!;
    expect(r999.name).toBe("R999");
    expect(r999.needsReview).toBe("missing_name");
  });
});

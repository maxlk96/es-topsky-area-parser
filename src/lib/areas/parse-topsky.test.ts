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

//ESR117 Nynäshamn
AREA:3:  R117
ACTIVE:1
LABEL:N058.55.23.000:E017.58.04.000:NYN<\xe4SHAMN
LIMITS:0:14
N058.55.55.000 E017.58.04.000
N058.55.54.623 E017.58.09.361
N058.55.53.000 E017.58.04.000
N058.55.55.000 E017.58.04.000
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
    expect(d309!.provenance.supNumber).toBe("299/25");
    expect(d309!.provenance.validTo).toBe("31 DEC 2026");
    expect(d309!.rawBlock).toMatch(/\/\/ 299\/25 - Valid to 31 DEC 2026/);
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

  it("fixes R117 corrupt LABEL to NYNÄSHAMN from //ES comment", () => {
    const { areas } = parseTopSkyText(SAMPLE);
    const r117 = areas.find((a) => a.id === "ESR117")!;
    expect(r117.name).toBe("NYNÄSHAMN");
    expect(r117.label?.text).toBe("NYNÄSHAMN");
    expect(r117.rawBlock).toMatch(/LABEL:[^:\n]+:[^:\n]+:NYNÄSHAMN/);
    expect(r117.rawBlock).not.toMatch(/NYN</);
  });

  it("does not swallow TEMPO / SOARING banner lines into area rawBlock", () => {
    const text = `/////////////////////////////////////////////////////////////////////
//
//      START OF TEMPO R AND D AREAS
//
/////////////////////////////////////////////////////////////////////

// 144/26 - Valid to 10 SEP 27
//ESR728 BONA
AREA:4F:  R728
NOAIW
ACTIVE:AUP:ESR728
LIMITS:16:100
N058.44.48.000 E014.58.58.000
N058.40.28.000 E015.14.39.000
N058.44.48.000 E014.58.58.000

/////////////////////////////////////////////////////////////////////
//
//      END OF TEMPO R AND D AREAS
//
/////////////////////////////////////////////////////////////////////

//A1
AREA:T: A1
NOAIW
LIMITS:0:999
N060.01.00.000 E018.01.00.000
N060.02.00.000 E018.01.00.000
N060.01.00.000 E018.01.00.000

/////////////////////////////////////////////////////////////////////
//
//      SOARING SECTORS
//
//      Naming syntax: FSxxyyy
//
/////////////////////////////////////////////////////////////////////

//ESSD EAGLE
AREA:2F:FSSDEAG
LIMITS:45:90
N060.11.13.000 E015.23.53.000
N060.07.30.000 E015.52.54.000
N060.11.13.000 E015.23.53.000
`;
    const { areas } = parseTopSkyText(text);
    const r728 = areas.find((a) => a.id === "ESR728")!;
    const a1 = areas.find((a) => a.shortName.trim() === "A1")!;
    expect(r728.rawBlock).not.toMatch(/\/{10,}/);
    expect(r728.rawBlock).not.toMatch(/END OF TEMPO/);
    expect(a1.rawBlock).not.toMatch(/SOARING SECTORS/);
    expect(a1.rawBlock).not.toMatch(/\/{10,}/);
  });

  it("inherits SUP Valid-to across sibling tempo areas (145/26 → ESR500–506)", () => {
    const text = `
//      START OF TEMPO R AND D AREAS
// 305/25 - Valid to 31 DEC 2026
//ESR505 LUGNET
AREA:4F:  R505
NOAIW
ACTIVE:AUP:ESR505
LABEL:N060.39.41.953:E015.43.04.598:LUGNET
LIMITS:0:30
N060.40.27.000 E015.48.54.000
N060.34.43.000 E015.48.57.000
N060.40.27.000 E015.48.54.000

// 145/26 - Valid to 14 SEP 27
//ESR500 VRÅNGÖ
AREA:4F:  R500
NOAIW
ACTIVE:AUP:ESR500
LIMITS:0:25
N057.35.28.000 E011.49.25.000
N057.33.51.000 E011.50.54.000
N057.35.28.000 E011.49.25.000

//ESR505 HAKEFJORDEN
AREA:4F:  R505
NOAIW
ACTIVE:AUP:ESR505
LABEL:N057.55.43.132:E011.33.40.942:HAKEFJORDEN
LIMITS:0:45
N058.02.33.000 E011.49.14.000
N057.59.31.000 E011.47.48.000
N058.02.33.000 E011.49.14.000

//ESR506 ÖCKERÖ
AREA:4F:  R506
NOAIW
ACTIVE:AUP:ESR506
LIMITS:0:45
N057.50.58.000 E011.41.01.000
N057.47.19.000 E011.40.41.000
N057.50.58.000 E011.41.01.000

// 146/26 - Valid to 03 SEP 27
//ESR727 DEGERNÄS
AREA:4F:  R727
NOAIW
ACTIVE:AUP:ESR727
LIMITS:0:235
N065.51.52.000 E021.25.27.000
N065.48.35.000 E021.36.16.000
N065.51.52.000 E021.25.27.000

//      END OF TEMPO R AND D AREAS
`;
    const { areas } = parseTopSkyText(text);
    const lugnet = areas.find((a) => a.name === "LUGNET")!;
    const vrango = areas.find((a) => a.id === "ESR500")!;
    const hake = areas.find((a) => a.name === "HAKEFJORDEN")!;
    const ockero = areas.find((a) => a.id === "ESR506")!;
    const deger = areas.find((a) => a.id === "ESR727")!;

    expect(lugnet.provenance.supNumber).toBe("305/25");
    expect(vrango.provenance.supNumber).toBe("145/26");
    // Sibling under same Valid-to — previously lost SUP provenance.
    expect(hake.provenance.supNumber).toBe("145/26");
    expect(hake.provenance.validTo).toBe("14 SEP 27");
    expect(ockero.provenance.supNumber).toBe("145/26");
    // Next SUP header must not contaminate ÖCKERÖ.
    expect(ockero.provenance.supNumber).not.toBe("146/26");
    expect(deger.provenance.supNumber).toBe("146/26");
  });
});

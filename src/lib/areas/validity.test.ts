import { describe, expect, it } from "vitest";
import type { AreaRecord } from "./types";
import {
  extractHoursSection,
  isExpired,
  isUpcoming,
  isWithinAnyWindow,
  parseAllValidityWindows,
  parseLooseDate,
  parseValidityWindow,
} from "./validity";

function area(
  validFrom?: string,
  validTo?: string,
  supNumber = "191/2026",
  validityWindows?: { from: string; to: string }[],
): AreaRecord {
  return {
    id: "ESR794",
    shortName: "R794",
    name: "TEST",
    category: "R",
    areaTypeCode: "4F",
    coordinates: [],
    directives: [],
    mapDefaultVisible: true,
    noaiw: true,
    provenance: {
      source: "sup",
      supNumber,
      validFrom,
      validTo,
      validityWindows,
    },
    rawBlock: "",
    section: "tempo",
  };
}

describe("parseLooseDate", () => {
  it("does not treat HHMM as a year", () => {
    expect(parseLooseDate("22 OCT 1200")).toBeNull();
    const d = parseLooseDate("22 OCT 1200", { defaultYear: 2026 });
    expect(d?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });

  it("parses real calendar years", () => {
    const d = parseLooseDate("27 OCT 2026", { endOfDay: true });
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCHours()).toBe(23);
  });
});

describe("parseValidityWindow", () => {
  it("maps Hours HHMM lines onto the SUP year", () => {
    const w = parseValidityWindow(
      "Tider / Hours 21 OCT 1600 – 22 OCT 1200",
      "AIP SUP 191/2026 01 OCT 2026 …",
      { supNumber: "191/2026" },
    );
    expect(w.validFrom).toMatch(/21 OCT 2026/);
    expect(w.validTo).toMatch(/22 OCT 2026/);
    expect(w.fromDate?.toISOString()).toBe("2026-10-21T16:00:00.000Z");
    expect(w.toDate?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });

  it("treats 2000 as 20:00, not year 2000", () => {
    const w = parseValidityWindow(
      "Tider / Hours 04 OCT 0600 – 09 OCT 2000",
      "AIP SUP 170/2026 17 SEP 2026",
      { supNumber: "170/2026" },
    );
    expect(w.validTo).toMatch(/09 OCT 2026/);
    expect(w.toDate?.toISOString()).toBe("2026-10-09T20:00:00.000Z");
  });

  it("keeps cross-year windows like SUP 189/2026 (end 2027)", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const w = parseValidityWindow(
      "Tider / Hours 07 OCT 2026 – 31 AUG 2027",
      "AIP SUP 189/2026 01 OCT 2026 Temporary danger areas near Västervik",
      { supNumber: "189/2026" },
    );
    expect(w.validFrom).toBe("07 OCT 2026");
    expect(w.validTo).toBe("31 AUG 2027");
    expect(w.toDate?.getUTCFullYear()).toBe(2027);
    const a = area(w.validFrom, w.validTo, "189/2026");
    expect(isExpired(a, now)).toBe(false);
    expect(isUpcoming(a, now)).toBe(true);
  });

  it("SUP 83/2026: multi-period Hours span — not expired on 01 OCT", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const full = `
AIP SUP 83/2026
16 APR 2026
Replaces AIP SUP 56/2026. Updated hours 28 APR - 01 MAY.
ESR534 BRUNNA
Tider / Hours
30 MAR – 27 APR, MON – FRI 0600 – 1730
28 APR 0600 – 01 MAY 2200
04 MAY – 23 OCT, MON – FRI 0600 – 1730
26 OCT – 25 DEC, MON – FRI 0700 – 1830
28 – 31 DEC 0700 – 1830
– S L U T / E N D –
`;
    const hours = extractHoursSection(full);
    expect(hours).toBeTruthy();
    const parts = parseAllValidityWindows(hours!, 2026);
    expect(parts.length).toBeGreaterThanOrEqual(4);
    expect(parts[0].validFrom).toMatch(/30 MAR 2026/);
    expect(parts[parts.length - 1].validTo).toMatch(/31 DEC 2026/);

    const w = parseValidityWindow("ESR534 BRUNNA", full, { supNumber: "83/2026" });
    // Must NOT latch onto only 28 APR – 01 MAY from preamble or mid Hours line
    expect(w.validFrom).toMatch(/30 MAR 2026/);
    expect(w.validTo).toMatch(/31 DEC 2026/);
    expect(w.windows?.length).toBeGreaterThanOrEqual(4);

    const a = area(
      w.validFrom,
      w.validTo,
      "83/2026",
      w.windows?.map((x) => ({
        from: x.validFrom,
        to: x.validTo,
      })),
    );
    expect(isExpired(a, now)).toBe(false);
    expect(isUpcoming(a, now)).toBe(false);
    expect(isWithinAnyWindow(a, now)).toBe(true);

    // After last window
    expect(isExpired(a, new Date("2027-01-01T12:00:00Z"))).toBe(true);
    // Before first window
    expect(isExpired(a, new Date("2026-03-01T12:00:00Z"))).toBe(false);
    expect(isUpcoming(a, new Date("2026-03-01T12:00:00Z"))).toBe(true);
  });
});

describe("isExpired / isUpcoming", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("upcoming windows are not expired", () => {
    const a = area("21 OCT 2026", "22 OCT 2026");
    expect(isExpired(a, now)).toBe(false);
    expect(isUpcoming(a, now)).toBe(true);
  });

  it("active windows are not expired", () => {
    const a = area("01 SEP 2026", "31 OCT 2026");
    expect(isExpired(a, now)).toBe(false);
    expect(isUpcoming(a, now)).toBe(false);
  });

  it("past end is expired", () => {
    const a = area("01 AUG 2026", "31 AUG 2026");
    expect(isExpired(a, now)).toBe(true);
  });

  it("legacy HHMM-only strings still resolve via SUP year", () => {
    // Previously these became year 1200 and looked expired.
    const a = area("21 OCT 1600", "22 OCT 1200", "191/2026");
    expect(isExpired(a, now)).toBe(false);
    expect(isUpcoming(a, now)).toBe(true);
  });
});

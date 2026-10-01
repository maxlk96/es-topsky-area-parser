import { describe, expect, it } from "vitest";
import type { AreaRecord } from "./types";
import {
  isExpired,
  isUpcoming,
  parseLooseDate,
  parseValidityWindow,
} from "./validity";

function area(
  validFrom?: string,
  validTo?: string,
  supNumber = "191/2026",
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

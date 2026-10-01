import { describe, expect, it } from "vitest";
import {
  extractAipLimitPair,
  feetToLimitsUnit,
  parseAipVerticalToken,
} from "./limits";

describe("limits", () => {
  it("converts AMSL feet exactly /100", () => {
    expect(feetToLimitsUnit(2500)).toBe(25);
    expect(parseAipVerticalToken("2500 ft AMSL")).toBe(25);
  });

  it("parses FL and GND", () => {
    expect(parseAipVerticalToken("FL520")).toBe(520);
    expect(parseAipVerticalToken("GND")).toBe(0);
    expect(parseAipVerticalToken("UNL")).toBe(999);
  });

  it("parses 400 ft SFC as 4 (not GND)", () => {
    expect(parseAipVerticalToken("400 ft SFC")).toBe(4);
    expect(parseAipVerticalToken("400 FT SFC")).toBe(4);
  });

  it("ESR130 Malmö: 400 ft SFC – 1200 ft AMSL → LIMITS 4:12", () => {
    const pair = extractAipLimitPair(
      "1200 ft AMSL\n400 ft SFC\nSpecial permission by Swedish Transport Agency",
    );
    expect(pair).toEqual([4, 12]);
  });

  it("still treats bare GND/SFC as 0 with an upper ft limit", () => {
    expect(extractAipLimitPair("2500 ft AMSL\nGND")).toEqual([0, 25]);
    expect(extractAipLimitPair("FL 95\nSFC")).toEqual([0, 95]);
  });
});

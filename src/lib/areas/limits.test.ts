import { describe, expect, it } from "vitest";
import { feetToLimitsUnit, parseAipVerticalToken } from "./limits";

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
});

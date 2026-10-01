import { describe, expect, it } from "vitest";
import {
  isNotInAipArea,
  isNotInAipDesignator,
  NOT_IN_AIP_EXCLUSION,
} from "./not-in-aip";

describe("not-in-aip", () => {
  it("flags ESR111 / R111", () => {
    expect(isNotInAipDesignator("ESR111")).toBe(true);
    expect(isNotInAipDesignator("R111")).toBe(true);
    expect(isNotInAipDesignator("esr111")).toBe(true);
    expect(isNotInAipDesignator("ESR94")).toBe(false);
    expect(isNotInAipDesignator("ESR110")).toBe(false);
  });

  it("isNotInAipArea respects exclusionReason", () => {
    expect(
      isNotInAipArea({ id: "ESR24", exclusionReason: NOT_IN_AIP_EXCLUSION }),
    ).toBe(true);
    expect(isNotInAipArea({ id: "ESR111", shortName: "R111" })).toBe(true);
  });

  it("does not flag legacy ESD140 (kept intentionally)", () => {
    expect(isNotInAipDesignator("ESD140")).toBe(false);
    expect(isNotInAipDesignator("D140")).toBe(false);
  });
});

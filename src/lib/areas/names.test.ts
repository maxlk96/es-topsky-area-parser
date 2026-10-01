import { describe, expect, it } from "vitest";
import {
  cleanCommentName,
  isDesignatorOnlyName,
  resolveAreaName,
  sanitizePlaceName,
} from "./names";

describe("area names", () => {
  it("detects designator-only names", () => {
    expect(isDesignatorOnlyName("R41A", "R41A", "ESR41A")).toBe(true);
    expect(isDesignatorOnlyName("ESR41A", "R41A", "ESR41A")).toBe(true);
    expect(isDesignatorOnlyName("RINGENÄS", "R41A", "ESR41A")).toBe(false);
    expect(isDesignatorOnlyName("", "R41A", "ESR41A")).toBe(true);
  });

  it("cleans comment tails like GND-UNL", () => {
    expect(cleanCommentName("Vidsel GND-UNL")).toBe("Vidsel");
    expect(cleanCommentName("RINGENÄS")).toBe("RINGENÄS");
  });

  it("prefers LABEL text over comment", () => {
    const r = resolveAreaName({
      labelText: "RINGENÄS",
      commentName: "R41A",
      shortName: "R41A",
      id: "ESR41A",
    });
    expect(r.name).toBe("RINGENÄS");
    expect(r.fromAip).toBe(true);
  });

  it("fixes corrupt LABEL NYN<äSHAMN using //ES comment", () => {
    expect(sanitizePlaceName("NYN<\xe4SHAMN")).toBe("NYN\xe4SHAMN");
    const r = resolveAreaName({
      labelText: "NYN<\xe4SHAMN",
      commentName: "Nynäshamn",
      shortName: "R117",
      id: "ESR117",
    });
    expect(r.name).toBe("NYNÄSHAMN");
    expect(r.fixedCorruption).toBe(true);
    expect(r.name).not.toMatch(/</);
  });
});

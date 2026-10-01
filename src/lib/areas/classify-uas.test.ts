import { describe, expect, it } from "vitest";
import {
  applyDesignatorPolicy,
  areaOmitsLabel,
  isUasOnlyText,
  mentionsUasActivity,
} from "./classify";
import type { AreaRecord } from "./types";

describe("areaOmitsLabel", () => {
  it("flags ESR94 / ESR102 / ESR127 (and short forms)", () => {
    expect(areaOmitsLabel({ id: "ESR94", shortName: "R94" })).toBe(true);
    expect(areaOmitsLabel({ id: "esr94", shortName: "r94" })).toBe(true);
    expect(areaOmitsLabel({ id: "ESR102", shortName: "R102" })).toBe(true);
    expect(areaOmitsLabel({ id: "R102" })).toBe(true);
    expect(areaOmitsLabel({ id: "ESR127", shortName: "R127" })).toBe(true);
    expect(areaOmitsLabel({ id: "R127" })).toBe(true);
    expect(areaOmitsLabel({ id: "ESR117", shortName: "R117" })).toBe(false);
  });
});

describe("applyDesignatorPolicy", () => {
  it("forces ESR94 to AREA:3 ACTIVE:1 without NOAIW/LABEL", () => {
    const raw = {
      id: "ESR94",
      shortName: "R94",
      name: "SÖRENTORP",
      category: "R",
      areaTypeCode: "4F",
      coordinates: [
        [17.99, 59.39],
        [18.0, 59.39],
        [18.0, 59.4],
        [17.99, 59.39],
      ],
      limits: [0, 15] as [number, number],
      activation: { type: "AUP" as const, key: "ESR94" },
      directives: ["NOAIW"],
      label: { lat: 59.39, lon: 17.99, text: "SÖRENTORP" },
      mapDefaultVisible: true,
      noaiw: true,
      provenance: { source: "enr51" as const },
      rawBlock: "",
      section: "other" as const,
    } satisfies AreaRecord;
    const out = applyDesignatorPolicy(raw);
    expect(out.areaTypeCode).toBe("3");
    expect(out.activation).toEqual({ type: "ALWAYS" });
    expect(out.noaiw).toBe(false);
    expect(out.directives).not.toContain("NOAIW");
    expect(out.label).toBeUndefined();
  });
});

describe("mentionsUasActivity", () => {
  it("flags body text like SUP 101/2026 (UAS + BVLOS, clean subject)", () => {
    const subject =
      "Temporary danger areas - Between Östersund, Sundsvall and Kramfors";
    const body =
      "ESD811 Ragunda and ESD812 Koviken are established for UAS flying beyond visual line of sight (BVLOS).";
    expect(mentionsUasActivity(subject)).toBe(false);
    expect(mentionsUasActivity(body)).toBe(true);
  });

  it("flags subject-line UAS titles", () => {
    expect(
      mentionsUasActivity("Temporary danger area - ESD865 Mölndal UAS"),
    ).toBe(true);
  });

  it("does not flag ordinary military R SUPs", () => {
    expect(
      mentionsUasActivity(
        "Temporary restricted area ESR791 Möja established for military aviation operations.",
      ),
    ).toBe(false);
  });
});

describe("isUasOnlyText", () => {
  it("still recognizes classic UAS-only wording", () => {
    expect(isUasOnlyText("EXCLUDED. ONLY UAS operations.")).toBe(true);
    expect(isUasOnlyText("// 19/26 - Valid to 31 DEC 2026\n// EXCLUDED. ONLY UAS (BVLOS)")).toBe(
      true,
    );
  });

  it("flags ESR113-style drone-prohibition R areas (UAV only)", () => {
    expect(
      isUasOnlyText(
        "ESR113 STOCKHOLM\nDrönarflygning är förbjuden.\nDrone flying is prohibited.",
      ),
    ).toBe(true);
    expect(
      isUasOnlyText(
        "ESR127 SOLNA\nFlygning med drönare är förbjuden.\nFlying with drones is prohibited.",
      ),
    ).toBe(true);
    expect(isUasOnlyText("//ESR113 Stockholm (UAV only)")).toBe(true);
  });

  it("does not treat military/ops SUPs that mention UAV/UAS as UAS-only", () => {
    expect(
      isUasOnlyText(
        "Military activities including aviation operations with UAS up to 400 ft AGL. Permission obtainable from STOCKHOLM ACC.",
      ),
    ).toBe(false);
    // SUP 101-style: UAS operating inside a real D area — affects everyone → select.
    expect(
      isUasOnlyText(
        "ESD811 Ragunda and ESD812 Koviken are established for UAS flying beyond visual line of sight (BVLOS).",
      ),
    ).toBe(false);
    expect(
      isUasOnlyText(
        "Temporary restricted area ESR791 Möja established for military aviation operations with UAV.",
      ),
    ).toBe(false);
  });
});

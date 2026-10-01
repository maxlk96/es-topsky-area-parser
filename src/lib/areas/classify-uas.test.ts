import { describe, expect, it } from "vitest";
import { isUasOnlyText, mentionsUasActivity } from "./classify";

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

  it("does not treat military R that merely include UAS as UAS-only", () => {
    expect(
      isUasOnlyText(
        "Military activities including aviation operations with UAS up to 400 ft AGL. Permission obtainable from STOCKHOLM ACC.",
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  activationLabel,
  hasAupActivation,
  isNoAupActivation,
  shouldEmitNoAupActivationComment,
  stripTempoGroupHeaders,
  withAupActivation,
} from "./activation";
import type { AreaRecord } from "./types";

function area(over: Partial<AreaRecord> = {}): AreaRecord {
  return {
    id: "ESD309",
    shortName: "D309",
    name: "ARGUS",
    category: "D",
    areaTypeCode: "4F",
    coordinates: [
      [20, 59],
      [20.1, 59],
      [20.1, 59.1],
      [20, 59],
    ],
    activation: { type: "MANUAL" },
    directives: ["NOAIW"],
    mapDefaultVisible: true,
    noaiw: true,
    provenance: { source: "topsky", supNumber: "299/25", validTo: "31 DEC 2026" },
    rawBlock: "//ESD309 ARGUS\nAREA:4F:  D309\n",
    section: "tempo",
    ...over,
  };
}

describe("activation helpers", () => {
  it("detects AUP vs no-AUP", () => {
    expect(isNoAupActivation(area())).toBe(true);
    expect(hasAupActivation(area())).toBe(false);
    expect(activationLabel(area())).toBe("no AUP");
    expect(
      hasAupActivation(area({ activation: { type: "AUP", key: "ESD309" } })),
    ).toBe(true);
    expect(
      activationLabel(area({ activation: { type: "ALWAYS" } })),
    ).toBe("always");
  });

  it("emits // NO AUP ACTIVATION only when there is no ACTIVE: line", () => {
    expect(shouldEmitNoAupActivationComment(area())).toBe(true);
    expect(
      shouldEmitNoAupActivationComment(
        area({ activation: { type: "NONE" } }),
      ),
    ).toBe(true);
    // ACTIVE:1 / schedule / AUP → never the comment
    expect(
      shouldEmitNoAupActivationComment(
        area({ activation: { type: "ALWAYS" } }),
      ),
    ).toBe(false);
    expect(
      shouldEmitNoAupActivationComment(
        area({ activation: { type: "SCHEDULE", raw: ["ACTIVE:0315:0815:1234567:0000:2359"] } }),
      ),
    ).toBe(false);
    expect(
      shouldEmitNoAupActivationComment(
        area({ activation: { type: "AUP", key: "ESD309" } }),
      ),
    ).toBe(false);
  });

  it("toggles AUP on/off and clears rawBlock", () => {
    const on = withAupActivation(area(), true);
    expect(on.activation).toEqual({ type: "AUP", key: "ESD309" });
    expect(on.rawBlock).toBe("");
    const off = withAupActivation(on, false);
    expect(off.activation?.type).toBe("MANUAL");
    expect(off.rawBlock).toBe("");
  });

  it("strips leading SUP / NO AUP group headers from rawBlock", () => {
    const raw = `// 299/25 - Valid to 31 DEC 2026
// NO AUP ACTIVATION

//ESD309 ARGUS
AREA:4F:  D309
`;
    expect(stripTempoGroupHeaders(raw)).toBe(`//ESD309 ARGUS
AREA:4F:  D309
`);
  });
});

import { describe, expect, it } from "vitest";
import { shouldEmitNoAupActivationComment } from "@/lib/areas/activation";
import { formatAreaBlock, formatTempoAreaBlocks } from "@/lib/areas/write-topsky";
import { extractAreaSections, parseSupHtml } from "./parse-sup";

const MULTI_SUP_HTML = `
<html><body>
Temporary restricted areas – ESR794 FAGERSANNA and ESR797 MOHOLM
Temporary restricted areas ESR794 Fagersanna and ESR797 Moholm established for military aviation operations.
ESR794 FAGERSANNA
Vertical limit
583931N 0142354E – 582842N 0141905E – 581758N 0141711E – 581727N 0141655E –
581656N 0141705E – 581611N 0141718E – 581435N 0140950E – 582240N 0140147E –
582540N 0140622E – 583508N 0140654E – 583931N 0142354E.
4000 ft AMSL
SFC
ESR797 MOHOLM
Vertical limit
584202N 0140358E – 583319N 0135511E – 582850N 0141012E – 583420N 0142135E –
583815N 0142320E – 584202N 0140358E.
4000 ft AMSL
SFC
</body></html>
`;

/** SUP 179/2026-style: purpose is “military operations” only (no aviation). */
const SUP_179_MILITARY_OPS_HTML = `
<html><body>
Temporary restricted area – ESR527 STENSHUVUD
Temporary restricted area ESR527 Stenshuvud established for military operations.
Flight within the area prohibited for all non-participating ACFT.
The following traffic on mission is exempted after permission from Malmö ACC:
Military flights, Police, Ambulance.
ESR527 STENSHUVUD
Vertical limit
554000N 0142000E – 554000N 0143000E – 553500N 0143000E – 553500N 0142000E –
554000N 0142000E.
4500 ft AMSL
SFC
</body></html>
`;

describe("multi-area SUP parse", () => {
  it("extracts separate geometry sections (not title-only mentions)", () => {
    const text = MULTI_SUP_HTML.replace(/<[^>]+>/g, " ");
    const sections = extractAreaSections(text);
    expect(sections.map((s) => s.id).sort()).toEqual(["ESR794", "ESR797"]);
    expect(sections.find((s) => s.id === "ESR794")!.name.toUpperCase()).toBe(
      "FAGERSANNA",
    );
  });

  it("returns one AreaRecord per lateral limit polygon", () => {
    const areas = parseSupHtml(MULTI_SUP_HTML, {
      amdtId: "test",
      supNumber: "191/2026",
      href: "AIP SUP 191-2026/ES-SUP-en-GB.html",
    });
    expect(areas).toHaveLength(2);
    const a794 = areas.find((a) => a.id === "ESR794")!;
    const a797 = areas.find((a) => a.id === "ESR797")!;
    expect(a794.name).toBe("FAGERSANNA");
    expect(a797.name).toBe("MOHOLM");
    // Must not merge both rings into one blob
    expect(a794.coordinates.length).toBeLessThan(15);
    expect(a797.coordinates.length).toBeLessThan(10);
    expect(a794.coordinates.length).toBeGreaterThanOrEqual(4);
    expect(a797.coordinates.length).toBeGreaterThanOrEqual(4);
    // Rings should not share the same first vertex set
    expect(a794.coordinates[0]).not.toEqual(a797.coordinates[0]);
    // Military aviation operations → NOAIW + AUP
    expect(a794.noaiw).toBe(true);
    expect(a794.directives).toContain("NOAIW");
    expect(a794.activation).toEqual({ type: "AUP", key: "ESR794" });
    expect(a797.noaiw).toBe(true);
  });

  it("SUP 179-style military operations gets AUP but not NOAIW", () => {
    const areas = parseSupHtml(SUP_179_MILITARY_OPS_HTML, {
      amdtId: "test",
      supNumber: "179/2026",
      href: "AIP SUP 179-2026/ES-SUP-en-GB.html",
    });
    expect(areas).toHaveLength(1);
    const a = areas[0]!;
    expect(a.id).toBe("ESR527");
    expect(a.noaiw).toBe(false);
    expect(a.directives).not.toContain("NOAIW");
    expect(a.activation).toEqual({ type: "AUP", key: "ESR527" });
    expect(a.areaTypeCode).toBe("4F");
  });

  it("SUP 186-style military activities (ESR739) gets AUP but not NOAIW", () => {
    const html = `
<html><body>
Temporary restricted area – ESR739 HYTTEFALLET
Temporary restricted area ESR739 Hyttefallet established for military activities.
Flight within the area prohibited for all non-participating ACFT.
The following traffic on mission is exempted after permission from Östgöta APP:
Military flights, Police, Ambulance.
ESR739 HYTTEFALLET
Vertical limit
584500N 0151000E – 584500N 0152000E – 584000N 0152000E – 584000N 0151000E –
584500N 0151000E.
4500 ft AMSL
SFC
</body></html>
`;
    const areas = parseSupHtml(html, {
      amdtId: "test",
      supNumber: "186/2026",
      href: "AIP SUP 186-2026/ES-SUP-en-GB.html",
    });
    expect(areas).toHaveLength(1);
    const a = areas[0]!;
    expect(a.id).toBe("ESR739");
    expect(a.noaiw).toBe(false);
    expect(a.directives).not.toContain("NOAIW");
    expect(a.activation).toEqual({ type: "AUP", key: "ESR739" });
    expect(a.areaTypeCode).toBe("4F");
    // Export must emit ACTIVE:AUP — never // NO AUP ACTIVATION.
    expect(shouldEmitNoAupActivationComment(a)).toBe(false);
    const block = formatAreaBlock(a);
    expect(block).toMatch(/^ACTIVE:AUP:ESR739$/m);
    expect(block).not.toContain("// NO AUP ACTIVATION");
    const tempo = formatTempoAreaBlocks([a]);
    expect(tempo).toMatch(/ACTIVE:AUP:ESR739/);
    expect(tempo).not.toContain("// NO AUP ACTIVATION");
  });
});

/**
 * Detect AIP lateral limits that follow the national FIR / state border.
 * Those arcs cannot be reconstructed from coordinate lists alone — ESAA
 * keeps dense hand-traced points in TopSkyAreas.txt. Auto-reparse must
 * leave such areas untouched.
 */
export function hasFirBorderLateralLimits(text: string): boolean {
  if (!text) return false;
  return (
    /FIR\s*BDRY/i.test(text) ||
    /along\s+the\s+FIR\b/i.test(text) ||
    /FIR\s+(?:boundary|border|gräns)/i.test(text) ||
    /along\s+the\s+(?:Swedish\s+)?(?:FIR|national)\s+(?:boundary|border)/i.test(
      text,
    ) ||
    /riksgräns|statsgräns|FIR-gräns/i.test(text)
  );
}

export const FIR_BORDER_EXCLUSION = "fir_border" as const;

export const FIR_BORDER_NOTE =
  "FIR / border arc — manual geometry only (not reparsed)";

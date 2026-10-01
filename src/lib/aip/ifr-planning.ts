import { normalizeDesignator } from "@/lib/areas/names";
import { shortFromDesignator } from "@/lib/areas/classify";

/**
 * IFR flight-planning-only buffer areas (FBZ) — not for TopSky ops / VATSIM.
 * Max: ESD184Z / ESD185Z (D184Z / D185Z) must not be included.
 */
export const IFR_PLANNING_EXCLUSION = "ifr_planning_only" as const;

export const IFR_PLANNING_NOTE =
  "IFR flight planning only — not for TopSky / VATSIM";

/** Known designators (with/without ES, optional Z already on id). */
const IFR_PLANNING_IDS = new Set(
  ["ESD184Z", "ESD185Z", "D184Z", "D185Z"].map((id) =>
    normalizeDesignator(id.startsWith("ES") ? id : `ES${id}`),
  ),
);

export function isIfrPlanningOnlyDesignator(id: string): boolean {
  const raw = id.trim().toUpperCase();
  const full = normalizeDesignator(raw.startsWith("ES") ? raw : `ES${raw}`);
  if (IFR_PLANNING_IDS.has(full)) return true;
  const short = shortFromDesignator(full).toUpperCase();
  return short === "D184Z" || short === "D185Z";
}

/** AIP remark: “For IFR flight planning purposes only” / Swedish equivalent. */
export function isIfrPlanningOnlyText(text: string): boolean {
  if (!text) return false;
  return (
    /IFR\s+flight\s+planning\s+purposes?\s+only/i.test(text) ||
    /Endast\s+f(?:ö|o)r\s+f(?:ä|a)rdplanering\s+IFR/i.test(text) ||
    /for\s+IFR\s+flight\s+planning\s+purposes\s+only/i.test(text)
  );
}

export function isIfrPlanningOnlyArea(area: {
  id: string;
  shortName?: string;
  exclusionReason?: string;
  provenance?: { rawComment?: string };
}): boolean {
  if (area.exclusionReason === IFR_PLANNING_EXCLUSION) return true;
  if (isIfrPlanningOnlyDesignator(area.id)) return true;
  if (area.shortName && isIfrPlanningOnlyDesignator(area.shortName)) return true;
  return isIfrPlanningOnlyText(area.provenance?.rawComment ?? "");
}

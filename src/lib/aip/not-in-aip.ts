import { shortFromDesignator } from "@/lib/areas/classify";
import { normalizeDesignator } from "@/lib/areas/names";

/**
 * Designators present in some TopSky baselines but not in AIP ENR 5.1.
 * Max: ESR111 / R111 must not appear in working set or export.
 *
 * Note: ESD140 Bornholm West is also absent from ENR 5.1 (only D138/D139)
 * but is intentionally kept as legacy TopSky — not listed here.
 */
export const NOT_IN_AIP_EXCLUSION = "not_in_aip" as const;

export const NOT_IN_AIP_NOTE = "Not present in AIP — excluded from TopSky";

/** Full designators to strip from parse / working set / export. */
export const NOT_IN_AIP_DESIGNATORS = ["ESR111"] as const;

const NOT_IN_AIP_IDS = new Set(
  NOT_IN_AIP_DESIGNATORS.map((id) => normalizeDesignator(id)),
);

export function isNotInAipDesignator(id: string): boolean {
  const raw = id.trim().toUpperCase();
  const full = normalizeDesignator(raw.startsWith("ES") ? raw : `ES${raw}`);
  if (NOT_IN_AIP_IDS.has(full)) return true;
  const short = shortFromDesignator(full).toUpperCase();
  return short === "R111";
}

export function isNotInAipArea(area: {
  id: string;
  shortName?: string;
  exclusionReason?: string;
}): boolean {
  if (area.exclusionReason === NOT_IN_AIP_EXCLUSION) return true;
  if (isNotInAipDesignator(area.id)) return true;
  if (area.shortName && isNotInAipDesignator(area.shortName)) return true;
  return false;
}

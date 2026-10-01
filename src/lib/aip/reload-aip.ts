import { FIR_BORDER_EXCLUSION } from "@/lib/aip/fir-border";
import {
  IFR_PLANNING_EXCLUSION,
  isIfrPlanningOnlyArea,
} from "@/lib/aip/ifr-planning";
import { isNotInAipArea, isNotInAipDesignator } from "@/lib/aip/not-in-aip";
import { applyDesignatorPolicy, mentionsUasActivity } from "@/lib/areas/classify";
import { isExpired } from "@/lib/areas/validity";
import { normalizeDesignator } from "@/lib/areas/names";
import type { AreaRecord } from "@/lib/areas/types";

/**
 * Merge ENR 5.1 permanent R/D with tempo SUP candidates.
 * Same designator: prefer a non-expired SUP (tempo override), else ENR 5.1.
 * Does not invent names; preserves needsReview.
 * FIR-border / IFR-planning-only areas stay excluded — never overwrite baseline.
 */
export function mergeAipReloadCandidates(
  enr51: AreaRecord[],
  sups: AreaRecord[],
  opts?: { now?: Date },
): AreaRecord[] {
  const now = opts?.now ?? new Date();
  const byId = new Map<string, AreaRecord>();

  for (const a of enr51) {
    const id = normalizeDesignator(a.id);
    if (isNotInAipDesignator(id) || isNotInAipArea(a)) continue;
    // Keep IFR-planning-only (ESD184Z/ESD185Z) as excluded stubs for Verify —
    // never as drawable/acceptables.
    if (isIfrPlanningOnlyArea(a) || a.exclusionReason === IFR_PLANNING_EXCLUSION) {
      byId.set(id, {
        ...a,
        id,
        shortName: a.shortName || id.replace(/^ES/i, ""),
        coordinates: [],
        exclusionReason: IFR_PLANNING_EXCLUSION,
        mapDefaultVisible: false,
      });
      continue;
    }
    byId.set(
      id,
      applyDesignatorPolicy({
        ...a,
        id,
        shortName: a.shortName || id.replace(/^ES/i, ""),
      }),
    );
  }

  for (const a of sups) {
    if (a.exclusionReason === "uas_only") continue;
    if (isNotInAipDesignator(a.id) || isNotInAipArea(a)) continue;
    if (a.exclusionReason === IFR_PLANNING_EXCLUSION || isIfrPlanningOnlyArea(a)) {
      continue; // never import IFR-planning-only from SUP
    }
    if (mentionsUasActivity(`${a.name} ${a.provenance.rawComment || ""}`)) continue;
    if (isExpired(a, now)) continue;
    const id = normalizeDesignator(a.id);
    const prev = byId.get(id);
    // Baseline FIR-border / IFR-planning geometry — do not let SUP reparse replace it.
    if (prev?.exclusionReason === FIR_BORDER_EXCLUSION) continue;
    if (prev?.exclusionReason === IFR_PLANNING_EXCLUSION) continue;
    if (a.exclusionReason === FIR_BORDER_EXCLUSION) {
      byId.set(id, {
        ...a,
        id,
        shortName: a.shortName || id.replace(/^ES/i, ""),
        coordinates: [],
        exclusionReason: FIR_BORDER_EXCLUSION,
      });
      continue;
    }
    byId.set(
      id,
      applyDesignatorPolicy({
        ...a,
        id,
        shortName: a.shortName || id.replace(/^ES/i, ""),
        provenance: {
          ...a.provenance,
          rawComment: prev
            ? `${a.provenance.rawComment || ""} · overrides ENR 5.1`.slice(0, 500)
            : a.provenance.rawComment,
        },
      }),
    );
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

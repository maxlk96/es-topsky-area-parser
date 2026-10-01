import { isTempoSupArea } from "@/lib/areas/stale-tempo";
import { normalizeDesignator } from "@/lib/areas/names";
import type { AreaRecord, DiffItem } from "@/lib/areas/types";

/** Diff note when a permanent TopSky R/D is absent from ENR 5.1 / 5.2. */
export const ORPHAN_RD_NOTE =
  "Not in AIP ENR 5.1/5.2 — propose remove from TopSky";

/**
 * Permanent published R/D (not tempo SUP, not PCA/TRA/system).
 * Tempo SUP areas keep their own stale-tempo prune path.
 */
export function isPermanentRdArea(area: AreaRecord): boolean {
  if (area.category !== "R" && area.category !== "D") return false;
  if (isTempoSupArea(area)) return false;
  if (area.section === "tempo") return false;
  if (area.provenance.source === "sup" || area.provenance.source === "notam") {
    return false;
  }
  // Swedish R/D designators only (ESR… / ESD…).
  const id = normalizeDesignator(area.id);
  return /^ES[RD]\d/i.test(id);
}

/** ENR 5.1 / 5.2 designators from a reload candidate list (incl. excluded stubs). */
export function enrPermanentRdIdSet(aipAreas: AreaRecord[]): Set<string> {
  const ids = new Set<string>();
  for (const a of aipAreas) {
    const src = a.provenance?.source;
    if (src !== "enr51" && src !== "enr52") continue;
    if (a.category !== "R" && a.category !== "D") continue;
    ids.add(normalizeDesignator(a.id));
  }
  return ids;
}

/**
 * Active permanent TopSky R/D that do not appear in AIP ENR 5.1/5.2.
 * e.g. ESR111 (wrong id for Sörentorp), ESD140 Bornholm West.
 */
export function findOrphanPermanentRd(
  working: AreaRecord[],
  aipAreas: AreaRecord[],
): AreaRecord[] {
  const aipIds = enrPermanentRdIdSet(aipAreas);
  const out: AreaRecord[] = [];
  const seen = new Set<string>();
  for (const area of working) {
    if (!isPermanentRdArea(area)) continue;
    const id = normalizeDesignator(area.id);
    if (aipIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(area);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Verify/diff rows: status `removed` — Accept drops from working set + export. */
export function orphanRdDiffItems(orphans: AreaRecord[]): DiffItem[] {
  return orphans.map((area) => ({
    status: "removed" as const,
    candidate: {
      ...area,
      // Keep topsky provenance so the row groups under baseline / Not in AIP.
      provenance: {
        ...area.provenance,
        source: area.provenance.source || "topsky",
        rawComment:
          `${area.provenance.rawComment || ""} · ${ORPHAN_RD_NOTE}`.trim(),
      },
    },
    existing: area,
    notes: [ORPHAN_RD_NOTE],
  }));
}

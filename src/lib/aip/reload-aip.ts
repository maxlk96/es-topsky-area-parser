import { mentionsUasActivity } from "@/lib/areas/classify";
import { isExpired } from "@/lib/areas/validity";
import { normalizeDesignator } from "@/lib/areas/names";
import type { AreaRecord } from "@/lib/areas/types";

/**
 * Merge ENR 5.1 permanent R/D with tempo SUP candidates.
 * Same designator: prefer a non-expired SUP (tempo override), else ENR 5.1.
 * Does not invent names; preserves needsReview.
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
    byId.set(id, { ...a, id, shortName: a.shortName || id.replace(/^ES/i, "") });
  }

  for (const a of sups) {
    if (a.exclusionReason === "uas_only") continue;
    if (mentionsUasActivity(`${a.name} ${a.provenance.rawComment || ""}`)) continue;
    if (isExpired(a, now)) continue;
    const id = normalizeDesignator(a.id);
    const prev = byId.get(id);
    byId.set(id, {
      ...a,
      id,
      shortName: a.shortName || id.replace(/^ES/i, ""),
      provenance: {
        ...a.provenance,
        rawComment: prev
          ? `${a.provenance.rawComment || ""} · overrides ENR 5.1`.slice(0, 500)
          : a.provenance.rawComment,
      },
    });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

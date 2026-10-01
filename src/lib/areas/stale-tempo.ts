import { formatSupNumberShort } from "@/lib/aip/sup-catalogue";
import type { AreaRecord, DiffItem } from "./types";
import { isExpired, parseLooseDate } from "./validity";

export type StaleTempoReason = "validity_ended" | "sup_not_in_amdt";

export type StaleTempoHit = {
  area: AreaRecord;
  reason: StaleTempoReason;
};

/** Canonical short SUP key: `146/2026` and `146/26` → `146/26`. */
export function supCatalogueKey(supNumber: string): string {
  return formatSupNumberShort(supNumber);
}

/** Build a set of short SUP keys from AMDT catalogue rows. */
export function catalogueSupKeySet(
  rows: { number: string }[] | undefined | null,
): Set<string> | null {
  if (!rows?.length) return null;
  return new Set(rows.map((r) => supCatalogueKey(r.number)));
}

/**
 * Tempo R/D tied to an AIP SUP (section tempo with SUP header, or Accept from SUP).
 * Permanent ENR / OTHER blocks are never stale-tempo candidates.
 */
export function isTempoSupArea(area: AreaRecord): boolean {
  if (area.category !== "R" && area.category !== "D") return false;
  if (area.provenance.source === "enr51" || area.provenance.source === "enr52") {
    return false;
  }
  if (area.provenance.source === "sup") return !!area.provenance.supNumber;
  if (area.section === "tempo" && area.provenance.supNumber) return true;
  return false;
}

export function staleTempoReason(
  area: AreaRecord,
  opts: { now?: Date; catalogueKeys?: Set<string> | null },
): StaleTempoReason | null {
  if (!isTempoSupArea(area)) return null;
  const now = opts.now ?? new Date();
  if (isExpired(area, now)) return "validity_ended";
  const keys = opts.catalogueKeys;
  const sup = area.provenance.supNumber;
  if (keys && sup && !keys.has(supCatalogueKey(sup))) {
    return "sup_not_in_amdt";
  }
  return null;
}

export function findStaleTempoAreas(
  areas: AreaRecord[],
  opts: { now?: Date; catalogueKeys?: Set<string> | null } = {},
): StaleTempoHit[] {
  const out: StaleTempoHit[] = [];
  for (const area of areas) {
    const reason = staleTempoReason(area, opts);
    if (reason) out.push({ area, reason });
  }
  return out;
}

export function pruneStaleTempoAreas(
  areas: AreaRecord[],
  opts: { now?: Date; catalogueKeys?: Set<string> | null } = {},
): { kept: AreaRecord[]; removed: StaleTempoHit[] } {
  const removed = findStaleTempoAreas(areas, opts);
  if (!removed.length) return { kept: areas, removed };
  const drop = new Set(
    removed.map((h) => h.area.id.toUpperCase() + "\0" + (h.area.provenance.supNumber || "")),
  );
  const kept = areas.filter(
    (a) =>
      !drop.has(a.id.toUpperCase() + "\0" + (a.provenance.supNumber || "")),
  );
  return { kept, removed };
}

export function staleReasonNote(reason: StaleTempoReason): string {
  return reason === "validity_ended"
    ? "Validity ended — removed from working set / export"
    : "SUP not in AMDT catalogue — removed from working set / export";
}

/** Diff rows so Verify shows what was auto-dropped (status: expired). */
export function staleTempoDiffItems(hits: StaleTempoHit[]): DiffItem[] {
  return hits.map(({ area, reason }) => ({
    status: "expired" as const,
    candidate: area,
    notes: [
      staleReasonNote(reason),
      area.provenance.supNumber
        ? `SUP ${formatSupNumberShort(area.provenance.supNumber)}`
        : "AIP SUP",
    ],
  }));
}

/**
 * True when an EXCLUDED UAS stub should be dropped (expired Valid-to, or SUP
 * absent from the loaded AMDT catalogue).
 */
export function isStaleExcludedStub(
  stub: string,
  opts: { now?: Date; catalogueKeys?: Set<string> | null } = {},
): boolean {
  const m = stub.match(
    /\/\/\s*(\d+)\s*\/\s*(\d+)\s*-\s*Valid to\s+([^\n]+)/i,
  );
  if (!m) {
    const bare = stub.match(/\/\/\s*(\d+)\s*\/\s*(\d+)\b/);
    if (!bare) return false;
    const key = supCatalogueKey(`${bare[1]}/${bare[2]}`);
    const keys = opts.catalogueKeys;
    return !!(keys && !keys.has(key));
  }
  const key = supCatalogueKey(`${m[1]}/${m[2]}`);
  const keys = opts.catalogueKeys;
  if (keys && !keys.has(key)) return true;
  const now = opts.now ?? new Date();
  const to = parseLooseDate(m[3].trim(), { endOfDay: true });
  if (!to) return false;
  return now.getTime() > to.getTime();
}

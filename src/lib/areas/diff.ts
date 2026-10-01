import { isUasOnlyText } from "./classify";
import { normalizeDesignator } from "./names";
import type { AreaRecord, DiffItem } from "./types";
import { isExpired, isUpcoming } from "./validity";

function fingerprint(area: AreaRecord): string {
  const coords = area.coordinates
    .map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`)
    .join("|");
  const lim = area.limits ? `${area.limits[0]}:${area.limits[1]}` : "-";
  return `${normalizeDesignator(area.id)}|${lim}|${coords}`;
}

export function diffCandidates(
  existing: AreaRecord[],
  candidates: AreaRecord[],
  opts?: { now?: Date; supIds?: Set<string> },
): DiffItem[] {
  const now = opts?.now ?? new Date();
  const byId = new Map(
    existing.map((a) => [normalizeDesignator(a.id), a]),
  );
  const items: DiffItem[] = [];

  for (const candidate of candidates) {
    const notes: string[] = [];
    const candId = normalizeDesignator(candidate.id);
    const normalized = candId !== candidate.id.toUpperCase()
      ? { ...candidate, id: candId }
      : candidate;
    const blob = `${normalized.provenance.rawComment ?? ""} ${normalized.name} ${normalized.exclusionReason ?? ""}`;
    if (normalized.exclusionReason === "uas_only" || isUasOnlyText(blob)) {
      items.push({
        status: "excluded",
        candidate: { ...normalized, exclusionReason: "uas_only" },
        notes: ["UAS-only — not relevant for VATSIM"],
      });
      continue;
    }
    if (opts?.supIds?.has(candId) && normalized.provenance.source === "notam") {
      items.push({
        status: "duplicate_of_sup",
        candidate: normalized,
        notes: ["Already defined in AIP SUP"],
      });
      continue;
    }
    if (isExpired(normalized, now)) {
      items.push({ status: "expired", candidate: normalized, notes: ["Validity ended"] });
      continue;
    }
    if (isUpcoming(normalized, now)) {
      notes.push("Upcoming — not yet in force");
    }
    if (normalized.needsReview === "missing_name") {
      notes.push("needs_review: missing AIP name (designator-only)");
    }
    if (normalized.provenance.source === "enr51") {
      notes.push("ENR 5.1 permanent");
    }

    const ex = byId.get(candId);
    if (!ex) {
      items.push({ status: "new", candidate: normalized, notes });
      continue;
    }
    if (fingerprint(ex) === fingerprint(normalized)) {
      items.push({
        status: "present",
        candidate: normalized,
        existing: ex,
        notes: notes.length ? notes : ["Match within tolerance"],
      });
    } else {
      if (
        ex.limits &&
        normalized.limits &&
        ex.limits.join(":") !== normalized.limits.join(":")
      ) {
        notes.push(`LIMITS ${ex.limits.join(":")} → ${normalized.limits.join(":")}`);
      }
      if (ex.coordinates.length !== normalized.coordinates.length) {
        notes.push(
          `Coord count ${ex.coordinates.length} → ${normalized.coordinates.length}`,
        );
      }
      items.push({ status: "changed", candidate: normalized, existing: ex, notes });
    }
  }
  return items;
}

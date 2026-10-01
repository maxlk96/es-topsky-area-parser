import { isUasOnlyText } from "./classify";
import type { AreaRecord, DiffItem } from "./types";
import { isExpired, isUpcoming } from "./validity";

function fingerprint(area: AreaRecord): string {
  const coords = area.coordinates
    .map(([lon, lat]) => `${lat.toFixed(5)},${lon.toFixed(5)}`)
    .join("|");
  const lim = area.limits ? `${area.limits[0]}:${area.limits[1]}` : "-";
  return `${area.id}|${lim}|${coords}`;
}

export function diffCandidates(
  existing: AreaRecord[],
  candidates: AreaRecord[],
  opts?: { now?: Date; supIds?: Set<string> },
): DiffItem[] {
  const now = opts?.now ?? new Date();
  const byId = new Map(existing.map((a) => [a.id.toUpperCase(), a]));
  const items: DiffItem[] = [];

  for (const candidate of candidates) {
    const notes: string[] = [];
    const blob = `${candidate.provenance.rawComment ?? ""} ${candidate.name} ${candidate.exclusionReason ?? ""}`;
    if (candidate.exclusionReason === "uas_only" || isUasOnlyText(blob)) {
      items.push({
        status: "excluded",
        candidate: { ...candidate, exclusionReason: "uas_only" },
        notes: ["UAS-only — not relevant for VATSIM"],
      });
      continue;
    }
    if (opts?.supIds?.has(candidate.id.toUpperCase()) && candidate.provenance.source === "notam") {
      items.push({
        status: "duplicate_of_sup",
        candidate,
        notes: ["Already defined in AIP SUP"],
      });
      continue;
    }
    if (isExpired(candidate, now)) {
      items.push({ status: "expired", candidate, notes: ["Validity ended"] });
      continue;
    }
    if (isUpcoming(candidate, now)) {
      notes.push("Upcoming — not yet in force");
    }

    const ex = byId.get(candidate.id.toUpperCase());
    if (!ex) {
      items.push({ status: "new", candidate, notes });
      continue;
    }
    if (fingerprint(ex) === fingerprint(candidate)) {
      items.push({ status: "present", candidate, existing: ex, notes: ["Match within tolerance"] });
    } else {
      if (ex.limits && candidate.limits && ex.limits.join(":") !== candidate.limits.join(":")) {
        notes.push(`LIMITS ${ex.limits.join(":")} → ${candidate.limits.join(":")}`);
      }
      if (ex.coordinates.length !== candidate.coordinates.length) {
        notes.push(`Coord count ${ex.coordinates.length} → ${candidate.coordinates.length}`);
      }
      items.push({ status: "changed", candidate, existing: ex, notes });
    }
  }
  return items;
}

import {
  FIR_BORDER_EXCLUSION,
  FIR_BORDER_NOTE,
} from "@/lib/aip/fir-border";
import { activationLabel } from "./activation";
import { isUasOnlyText } from "./classify";
import { normalizeDesignator } from "./names";
import type { AreaRecord, DiffItem } from "./types";
import { isExpired, isUpcoming } from "./validity";

/** ~100 m — AIP compact seconds vs TopSky sub-second noise. */
const COORD_TOLERANCE_NM = 0.055;

function openRing(coords: [number, number][]): [number, number][] {
  if (coords.length < 2) return coords;
  const [fLon, fLat] = coords[0];
  const [lLon, lLat] = coords[coords.length - 1];
  if (Math.abs(fLon - lLon) < 1e-9 && Math.abs(fLat - lLat) < 1e-9) {
    return coords.slice(0, -1);
  }
  return coords;
}

function haversineNm(a: [number, number], b: [number, number]): number {
  const R = 3440.065;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dlat = toR(b[1] - a[1]);
  const dlon = toR(b[0] - a[0]);
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dlon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

function limitsKey(area: AreaRecord): string {
  return area.limits ? `${area.limits[0]}:${area.limits[1]}` : "-";
}

function circlesMatch(
  a?: AreaRecord["boundCircle"],
  b?: AreaRecord["boundCircle"],
): boolean | undefined {
  if (!a || !b) return undefined;
  const centerNm = haversineNm([a.lon, a.lat], [b.lon, b.lat]);
  const radiusDiff = Math.abs(a.radiusNm - b.radiusNm);
  return centerNm <= COORD_TOLERANCE_NM && radiusDiff <= 0.03;
}

/**
 * Compare existing TopSky vs AIP candidate. Returns human-readable change reasons.
 * Close-ring duplicates and sub-tolerance vertex noise are ignored.
 */
export function explainAreaChanges(
  existing: AreaRecord,
  candidate: AreaRecord,
): string[] {
  const reasons: string[] = [];

  if (!!existing.noaiw !== !!candidate.noaiw) {
    reasons.push(
      candidate.noaiw ? "NOAIW added" : "NOAIW removed",
    );
  }

  const limEx = limitsKey(existing);
  const limCand = limitsKey(candidate);
  if (limEx !== limCand) {
    reasons.push(`LIMITS ${limEx} → ${limCand}`);
  }

  const nameEx = (existing.name || "").toLocaleUpperCase("sv-SE");
  const nameCand = (candidate.name || "").toLocaleUpperCase("sv-SE");
  if (nameEx && nameCand && nameEx !== nameCand) {
    reasons.push(`Name ${existing.name} → ${candidate.name}`);
  }

  const circleEq = circlesMatch(existing.boundCircle, candidate.boundCircle);
  if (circleEq === true) {
    // Densified rings may differ; circle definition matches.
    return reasons;
  }
  if (circleEq === false) {
    const a = existing.boundCircle!;
    const b = candidate.boundCircle!;
    reasons.push(
      `Circle r ${a.radiusNm.toFixed(2)} NM → ${b.radiusNm.toFixed(2)} NM` +
        (haversineNm([a.lon, a.lat], [b.lon, b.lat]) > COORD_TOLERANCE_NM
          ? " (centre moved)"
          : ""),
    );
    return reasons;
  }

  const ringA = openRing(existing.coordinates);
  const ringB = openRing(candidate.coordinates);
  if (ringA.length !== ringB.length) {
    reasons.push(`Coords ${ringA.length} → ${ringB.length} vertices`);
    return reasons;
  }
  if (ringA.length === 0) return reasons;

  let maxNm = 0;
  for (let i = 0; i < ringA.length; i++) {
    maxNm = Math.max(maxNm, haversineNm(ringA[i], ringB[i]));
  }
  if (maxNm > COORD_TOLERANCE_NM) {
    if (maxNm < 1) {
      reasons.push(`Geometry shift ~${Math.round(maxNm * 1852)} m`);
    } else {
      reasons.push(`Geometry shift ~${maxNm.toFixed(1)} NM`);
    }
  }
  return reasons;
}

export function areasEquivalent(existing: AreaRecord, candidate: AreaRecord): boolean {
  return explainAreaChanges(existing, candidate).length === 0;
}

const DIFF_STATUS_ORDER: Record<string, number> = {
  changed: 0,
  new: 1,
  excluded: 2,
  expired: 3,
  duplicate_of_sup: 4,
  present: 5,
};

/** Put actionable rows first so AIP reload noise (present) sinks. */
export function sortDiffItems(items: DiffItem[]): DiffItem[] {
  return [...items].sort((a, b) => {
    const oa = DIFF_STATUS_ORDER[a.status] ?? 9;
    const ob = DIFF_STATUS_ORDER[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    return a.candidate.id.localeCompare(b.candidate.id);
  });
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
    if (
      normalized.exclusionReason === FIR_BORDER_EXCLUSION ||
      /FIR\s*BDRY|along\s+the\s+FIR\b/i.test(
        normalized.provenance.rawComment ?? "",
      )
    ) {
      items.push({
        status: "excluded",
        candidate: {
          ...normalized,
          exclusionReason: FIR_BORDER_EXCLUSION,
          coordinates: [],
        },
        existing: byId.get(candId),
        notes: [FIR_BORDER_NOTE],
      });
      continue;
    }
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
      // Published ENR 5.1 geometry (not a SUP). Do not say "permanent" —
      // that was read as ACTIVE:1 / no AUP (e.g. ESD171 Härnön is AUP).
      notes.push("ENR 5.1");
    } else if (normalized.provenance.source === "sup") {
      notes.push(
        normalized.provenance.supNumber
          ? `SUP ${normalized.provenance.supNumber}`
          : "AIP SUP",
      );
    } else if (normalized.provenance.source === "vatiris_pca") {
      notes.push("vatiris echarts PCA");
    }
    if (
      (normalized.category === "R" || normalized.category === "D") &&
      normalized.activation
    ) {
      const act = activationLabel(normalized);
      if (act === "AUP" || act === "AUP group") notes.push("AUP activation");
      else if (act === "always") notes.push("ACTIVE:1 (not AUP)");
      else if (act === "no AUP") notes.push("no AUP (manual)");
      else if (act === "schedule") notes.push("scheduled ACTIVE");
    }

    const ex = byId.get(candId);
    if (!ex) {
      items.push({
        status: "new",
        candidate: normalized,
        notes: [...notes, "Not in loaded TopSky baseline"],
      });
      continue;
    }

    const changeReasons = explainAreaChanges(ex, normalized);
    if (changeReasons.length === 0) {
      items.push({
        status: "present",
        candidate: normalized,
        existing: ex,
        notes: notes.length ? notes : ["Match within tolerance"],
      });
    } else {
      items.push({
        status: "changed",
        candidate: normalized,
        existing: ex,
        notes: [...notes, ...changeReasons],
      });
    }
  }
  return items;
}

import {
  FIR_BORDER_EXCLUSION,
  FIR_BORDER_NOTE,
} from "@/lib/aip/fir-border";
import {
  IFR_PLANNING_EXCLUSION,
  IFR_PLANNING_NOTE,
  isIfrPlanningOnlyArea,
} from "@/lib/aip/ifr-planning";
import {
  NOT_IN_AIP_EXCLUSION,
  NOT_IN_AIP_NOTE,
  isNotInAipArea,
} from "@/lib/aip/not-in-aip";
import { supNumberKey } from "@/lib/aip/sup-catalogue";
import { activationLabel } from "./activation";
import { applyDesignatorPolicy, isUasOnlyText } from "./classify";
import { normalizeDesignator } from "./names";
import type { AreaRecord, DiffItem } from "./types";
import { isExpired, isUpcoming } from "./validity";

/** Newest-first SUP sort key; treats 2-digit years as 20xx. */
function supSortKey(number: string | undefined): [number, number] {
  const [y, n] = supNumberKey(number || "");
  const year = y > 0 && y < 100 ? 2000 + y : y;
  return [year, n];
}

/** ~100 m — AIP compact seconds vs TopSky sub-second noise. */
const COORD_TOLERANCE_NM = 0.055;
/**
 * Metre→NM AIP circles (2000 m ≈ 1.08 NM) often stored as 1.1 / 1.2 in TopSky.
 * Centres must still match; radius may drift by this much without a real change.
 */
const CIRCLE_RADIUS_TOLERANCE_NM = 0.15;

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
  return (
    centerNm <= COORD_TOLERANCE_NM &&
    radiusDiff <= CIRCLE_RADIUS_TOLERANCE_NM
  );
}

/** Ring densified from a circle (or TopSky without parsed BOUND:C) vs AIP circle. */
function ringMatchesCircle(
  ring: [number, number][],
  circle: NonNullable<AreaRecord["boundCircle"]>,
): boolean {
  const open = openRing(ring);
  if (open.length < 3) return false;
  const centre: [number, number] = [circle.lon, circle.lat];
  const c = ringCentroid(open);
  if (!c || haversineNm(c, centre) > 0.12) return false;
  const r = maxRadiusNm(open, centre);
  return Math.abs(r - circle.radiusNm) <= CIRCLE_RADIUS_TOLERANCE_NM;
}

/** Fold Swedish letters for name equality (HÄRNÖN ≈ HÄRNON / HARNON). */
function normName(s: string): string {
  return s
    .toLocaleUpperCase("sv-SE")
    .replace(/[ÅÄ]/g, "A")
    .replace(/Ö/g, "O")
    .replace(/[ÉÈÊ]/g, "E")
    .replace(/\s+/g, " ")
    .trim();
}

function ringCentroid(ring: [number, number][]): [number, number] | null {
  if (!ring.length) return null;
  let lon = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lon / ring.length, lat / ring.length];
}

function maxRadiusNm(
  ring: [number, number][],
  center: [number, number],
): number {
  let max = 0;
  for (const p of ring) max = Math.max(max, haversineNm(center, p));
  return max;
}

/** Approx distance from point to segment AB (NM), local equirectangular. */
function distPointToSegNm(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const lat0 = ((a[1] + b[1] + p[1]) / 3) * (Math.PI / 180);
  const kx = 60 * Math.cos(lat0); // NM per deg lon
  const ky = 60; // NM per deg lat
  const ax = a[0] * kx;
  const ay = a[1] * ky;
  const bx = b[0] * kx;
  const by = b[1] * ky;
  const px = p[0] * kx;
  const py = p[1] * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 < 1e-12 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function maxDistToRingNm(
  points: [number, number][],
  ring: [number, number][],
): number {
  if (!ring.length) return Infinity;
  let max = 0;
  for (const p of points) {
    let min = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      min = Math.min(min, distPointToSegNm(p, a, b));
    }
    max = Math.max(max, min);
  }
  return max;
}

/**
 * True when rings represent the same shape within tolerance — including
 * AIP vs TopSky densification (different vertex counts).
 */
function ringsEquivalent(
  a: [number, number][],
  b: [number, number][],
): boolean {
  const ringA = openRing(a);
  const ringB = openRing(b);
  if (!ringA.length && !ringB.length) return true;
  if (!ringA.length || !ringB.length) return false;

  if (ringA.length === ringB.length) {
    let maxNm = 0;
    for (let i = 0; i < ringA.length; i++) {
      maxNm = Math.max(maxNm, haversineNm(ringA[i]!, ringB[i]!));
    }
    if (maxNm <= COORD_TOLERANCE_NM) return true;
  }

  const cA = ringCentroid(ringA);
  const cB = ringCentroid(ringB);
  if (!cA || !cB) return false;
  if (haversineNm(cA, cB) > 0.2) return false;
  const rA = maxRadiusNm(ringA, cA);
  const rB = maxRadiusNm(ringB, cB);
  if (Math.abs(rA - rB) > 0.15) return false;
  // Each vertex must lie on (near) an edge of the other ring.
  const h = Math.max(
    maxDistToRingNm(ringA, ringB),
    maxDistToRingNm(ringB, ringA),
  );
  return h <= 0.08;
}

/**
 * Geometry / limits / name only — the airspace footprint Max cares about for
 * "already correct" TopSky blocks.
 */
function explainFootprintChanges(
  existing: AreaRecord,
  candidate: AreaRecord,
): string[] {
  const reasons: string[] = [];

  const limEx = limitsKey(existing);
  const limCand = limitsKey(candidate);
  if (limEx !== limCand) {
    reasons.push(`LIMITS ${limEx} → ${limCand}`);
  }

  const nameEx = normName(existing.name || "");
  const nameCand = normName(candidate.name || "");
  if (nameEx && nameCand && nameEx !== nameCand) {
    reasons.push(`Name ${existing.name} → ${candidate.name}`);
  }

  // LABEL coords are not compared: Accept keeps baseline LABEL.

  const circleEq = circlesMatch(existing.boundCircle, candidate.boundCircle);
  if (circleEq === true) return reasons;
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

  // One side has BOUND:C, the other only a densified ring (common when TopSky
  // BOUND:C parse fails or ENR supplies circle + ring).
  if (
    existing.boundCircle &&
    ringMatchesCircle(candidate.coordinates, existing.boundCircle)
  ) {
    return reasons;
  }
  if (
    candidate.boundCircle &&
    ringMatchesCircle(existing.coordinates, candidate.boundCircle)
  ) {
    return reasons;
  }

  if (ringsEquivalent(existing.coordinates, candidate.coordinates)) {
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
    maxNm = Math.max(maxNm, haversineNm(ringA[i]!, ringB[i]!));
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

function explainPolicyChanges(
  existing: AreaRecord,
  candidate: AreaRecord,
): string[] {
  const reasons: string[] = [];
  if (!!existing.noaiw !== !!candidate.noaiw) {
    reasons.push(candidate.noaiw ? "NOAIW added" : "NOAIW removed");
  }
  const typeEx = (existing.areaTypeCode || "").trim();
  const typeCand = (candidate.areaTypeCode || "").trim();
  if (typeEx && typeCand && typeEx !== typeCand) {
    reasons.push(`AREA:${typeEx} → AREA:${typeCand}`);
  }
  // ACTIVE/AUP/ALWAYS never compared — ESAA ops activation is authoritative.
  return reasons;
}

/**
 * Compare existing TopSky vs AIP candidate. Returns human-readable change reasons.
 * Functionally identical footprints (geometry/limits/name) are no-ops even when
 * AREA type / NOAIW / ACTIVE differ — do not "fix" already-correct TopSky.
 * When the footprint really changes, policy diffs are included too.
 */
export function explainAreaChanges(
  existing: AreaRecord,
  candidate: AreaRecord,
): string[] {
  const footprint = explainFootprintChanges(existing, candidate);
  if (footprint.length === 0) return [];
  return [...explainPolicyChanges(existing, candidate), ...footprint];
}

export function areasEquivalent(existing: AreaRecord, candidate: AreaRecord): boolean {
  return explainAreaChanges(existing, candidate).length === 0;
}

const DIFF_STATUS_ORDER: Record<string, number> = {
  changed: 0,
  new: 1,
  removed: 2,
  excluded: 3,
  expired: 4,
  duplicate_of_sup: 5,
  present: 6,
};

/** Coarse source groups for stacked verify/diff (AIP → SUP → PCA). */
const DIFF_SOURCE_ORDER: Record<string, number> = {
  enr51: 0,
  enr52: 1,
  sup: 2,
  notam: 3,
  vatiris_pca: 4,
  topsky: 5,
  manual: 6,
};

export function diffSourceGroupKey(
  item: Pick<DiffItem, "candidate" | "status">,
): string {
  if (item.status === "removed") return "orphan_rd";
  const s = item.candidate.provenance?.source || "other";
  if (s === "enr51") return "enr51";
  if (s === "enr52") return "enr52";
  if (s === "sup" || s === "notam") return "sup";
  if (s === "vatiris_pca") return "pca";
  return s;
}

export function diffSourceGroupLabel(key: string): string {
  switch (key) {
    case "enr51":
      return "ENR 5.1";
    case "enr52":
      return "ENR 5.2";
    case "sup":
      return "AIP SUP";
    case "pca":
      return "PCA (echarts)";
    case "orphan_rd":
      return "Not in AIP (remove)";
    default:
      return key;
  }
}

/**
 * Group by source. Within AIP SUP: sort by SUP number (newest first) —
 * not primarily by included vs excluded status. Other sources: status then id.
 */
export function sortDiffItems(items: DiffItem[]): DiffItem[] {
  return [...items].sort((a, b) => {
    // Removals (orphan R/D) group together after ENR / SUP / PCA.
    const ga = diffSourceGroupKey(a);
    const gb = diffSourceGroupKey(b);
    const groupOrder = (g: string) =>
      g === "enr51"
        ? 0
        : g === "enr52"
          ? 1
          : g === "sup"
            ? 2
            : g === "pca"
              ? 3
              : g === "orphan_rd"
                ? 4
                : 5;
    const goa = groupOrder(ga);
    const gob = groupOrder(gb);
    if (goa !== gob) return goa - gob;

    const sa =
      DIFF_SOURCE_ORDER[a.candidate.provenance?.source || ""] ?? 9;
    const sb =
      DIFF_SOURCE_ORDER[b.candidate.provenance?.source || ""] ?? 9;
    if (sa !== sb) return sa - sb;

    const aSup = a.candidate.provenance?.supNumber;
    const bSup = b.candidate.provenance?.supNumber;
    if (aSup || bSup) {
      const [ay, an] = supSortKey(aSup);
      const [by, bn] = supSortKey(bSup);
      if (by !== ay) return by - ay;
      if (bn !== an) return bn - an;
      // Same SUP: id only — don't bunch excluded after new.
      return a.candidate.id.localeCompare(b.candidate.id);
    }

    const oa = DIFF_STATUS_ORDER[a.status] ?? 9;
    const ob = DIFF_STATUS_ORDER[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    return a.candidate.id.localeCompare(b.candidate.id);
  });
}

/**
 * Accumulate verify/diff rows: newer batch upserts by designator
 * (same id replaced; other sources kept). Always re-sort.
 */
export function mergeDiffItems(
  previous: DiffItem[],
  incoming: DiffItem[],
): DiffItem[] {
  const byId = new Map<string, DiffItem>();
  for (const d of previous) {
    // Never keep stale present/excluded noise in the verify panel.
    if (!isActionableDiffStatus(d.status) && d.status !== "excluded") {
      continue;
    }
    // Keep excluded only for UAS stub export bookkeeping — not for display.
    byId.set(normalizeDesignator(d.candidate.id), d);
  }
  for (const d of incoming) {
    const id = normalizeDesignator(d.candidate.id);
    if (d.status === "present") {
      // Explicit match: drop any prior row for this designator.
      byId.delete(id);
      continue;
    }
    byId.set(id, d);
  }
  return sortDiffItems([...byId.values()]);
}

/** Same upsert for map amber candidate overlays. */
export function mergeCandidateAreas(
  previous: AreaRecord[],
  incoming: AreaRecord[],
): AreaRecord[] {
  const byId = new Map<string, AreaRecord>();
  for (const a of previous) byId.set(normalizeDesignator(a.id), a);
  for (const a of incoming) byId.set(normalizeDesignator(a.id), a);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
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
    const normalized = applyDesignatorPolicy(
      candId !== candidate.id.toUpperCase()
        ? { ...candidate, id: candId }
        : candidate,
    );
    const blob = `${normalized.provenance.rawComment ?? ""} ${normalized.name} ${normalized.exclusionReason ?? ""}`;
    if (isNotInAipArea(normalized)) {
      items.push({
        status: "excluded",
        candidate: {
          ...normalized,
          exclusionReason: NOT_IN_AIP_EXCLUSION,
          coordinates: [],
        },
        existing: byId.get(candId),
        notes: [NOT_IN_AIP_NOTE],
      });
      continue;
    }
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
    if (isIfrPlanningOnlyArea(normalized)) {
      items.push({
        status: "excluded",
        candidate: {
          ...normalized,
          exclusionReason: IFR_PLANNING_EXCLUSION,
          coordinates: [],
        },
        existing: byId.get(candId),
        notes: [IFR_PLANNING_NOTE],
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
    // Unchanged vs baseline → omit entirely (Verify/Diff = real diffs only).
    if (changeReasons.length === 0) continue;
    items.push({
      status: "changed",
      candidate: normalized,
      existing: ex,
      notes: [...notes, ...changeReasons],
    });
  }
  return items;
}

/** Statuses that belong in the Verify/Diff panel. */
export const ACTIONABLE_DIFF_STATUSES = [
  "new",
  "changed",
  "removed",
] as const;

export type ActionableDiffStatus = (typeof ACTIONABLE_DIFF_STATUSES)[number];

export function isActionableDiffStatus(
  status: DiffItem["status"],
): status is ActionableDiffStatus {
  return (
    status === "new" || status === "changed" || status === "removed"
  );
}

/** Drop present / excluded / expired noise from accumulated verify rows. */
export function filterActionableDiffs(items: DiffItem[]): DiffItem[] {
  return items.filter((d) => isActionableDiffStatus(d.status));
}

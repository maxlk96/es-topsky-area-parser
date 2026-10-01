/**
 * Partial-arc densify for AIP lateral limits
 * ("clockwise along an arc of R NM radius centred on …").
 * TopSky COORD_AF / kilojuliett equivalent — not a full circle.
 */

import { closeRing, clampCircleSpacing, parseCompactCoord } from "./coords";

const R_EARTH_NM = 3440.065;

const COMPACT_POINT =
  "\\d{6,7}(?:\\.\\d+)?[NS]\\s+\\d{7,8}(?:\\.\\d+)?[EW]";

/** Arc spacing° by radius — aim for ESAA-style ~8–12° along the arc. */
export function defaultArcSpacingForRadius(radiusNm: number): number {
  const r = Number.isFinite(radiusNm) ? Math.abs(radiusNm) : 5;
  if (r <= 3) return 10;
  if (r <= 8) return 8;
  if (r <= 16) return 10;
  return 12;
}

export function initialBearingDeg(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
): number {
  const φ1 = (fromLat * Math.PI) / 180;
  const φ2 = (toLat * Math.PI) / 180;
  const Δλ = ((toLon - fromLon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distNm: number,
): { lat: number; lon: number } {
  const δ = distNm / R_EARTH_NM;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
      Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return {
    lat: (φ2 * 180) / Math.PI,
    lon: ((((λ2 * 180) / Math.PI + 540) % 360) - 180),
  };
}

/**
 * Densify a circular arc from start→end about centre.
 * Returns [lon,lat][] including start and end (COORD_AF-style Spacing°).
 */
export function densifyArc(
  center: { lat: number; lon: number },
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
  radiusNm: number,
  clockwise: boolean,
  spacingDeg?: number,
): [number, number][] {
  const spacing = clampCircleSpacing(
    spacingDeg ?? defaultArcSpacingForRadius(radiusNm),
  );
  const a0 = initialBearingDeg(center.lat, center.lon, start.lat, start.lon);
  const a1 = initialBearingDeg(center.lat, center.lon, end.lat, end.lon);

  let span: number;
  if (clockwise) {
    span = (a1 - a0 + 360) % 360;
  } else {
    span = (a0 - a1 + 360) % 360;
  }
  // Degenerate / full-circle slip: keep at least the endpoints
  if (span < 1e-6) {
    return [
      [start.lon, start.lat],
      [end.lon, end.lat],
    ];
  }

  const nSteps = Math.max(1, Math.round(span / spacing));
  const step = span / nSteps;
  const pts: [number, number][] = [[start.lon, start.lat]];
  for (let i = 1; i < nSteps; i++) {
    const brng = clockwise
      ? (a0 + i * step) % 360
      : (a0 - i * step + 360) % 360;
    const p = destinationPoint(center.lat, center.lon, brng, radiusNm);
    pts.push([p.lon, p.lat]);
  }
  pts.push([end.lon, end.lat]);
  return pts;
}

export function hasPartialArcLateral(text: string): boolean {
  return /along\s+an\s+arc\s+of/i.test(text);
}

/**
 * Expand AIP lateral-limit prose into a closed lon/lat ring.
 * Partial arcs densify between bearings; centre from "centred on" is not
 * emitted as a vertex unless it also appears as a later polygon point
 * (sector / pie-slice areas like ESR15A).
 */
function samePoint(
  a: [number, number],
  b: { lat: number; lon: number },
  eps = 1e-5,
): boolean {
  return Math.abs(a[0] - b.lon) < eps && Math.abs(a[1] - b.lat) < eps;
}

/** Rotate open ring so `idx` is first (ESAA pie-slice: centre first). */
function rotateOpenRing(
  open: [number, number][],
  idx: number,
): [number, number][] {
  if (idx <= 0 || idx >= open.length) return open;
  return [...open.slice(idx), ...open.slice(0, idx)];
}

export function expandAipLateralCoords(text: string): [number, number][] {
  const tokenRe = new RegExp(
    `(clockwise|anti-?clockwise|counter-?clockwise)\\s+along\\s+an\\s+arc\\s+of\\s+([\\d.]+)\\s*NM\\s+radius\\s+centr(?:ed|ered)\\s+on\\s+(${COMPACT_POINT})|(${COMPACT_POINT})`,
    "gi",
  );
  const tokens = [...text.matchAll(tokenRe)];
  const out: [number, number][] = [];
  const arcCenters: { lat: number; lon: number }[] = [];
  let pendingArc: {
    clockwise: boolean;
    radiusNm: number;
    center: { lat: number; lon: number };
  } | null = null;

  for (const m of tokens) {
    if (m[1]) {
      const center = parseCompactCoord(m[3].replace(/\s+/g, " "));
      if (!center) continue;
      pendingArc = {
        clockwise: !/anti|counter/i.test(m[1]),
        radiusNm: Number(m[2]),
        center,
      };
      arcCenters.push(center);
      continue;
    }
    const pt = parseCompactCoord((m[4] || "").replace(/\s+/g, " "));
    if (!pt) continue;
    if (pendingArc) {
      const prev = out[out.length - 1];
      if (!prev) {
        out.push([pt.lon, pt.lat]);
        pendingArc = null;
        continue;
      }
      const arcPts = densifyArc(
        pendingArc.center,
        { lon: prev[0], lat: prev[1] },
        pt,
        pendingArc.radiusNm,
        pendingArc.clockwise,
      );
      // first point already in out
      for (let i = 1; i < arcPts.length; i++) out.push(arcPts[i]!);
      pendingArc = null;
    } else {
      out.push([pt.lon, pt.lat]);
    }
  }

  // Sector / pie-slice (centre also a polygon vertex): ESAA style puts centre first.
  if (arcCenters.length === 1) {
    const c = arcCenters[0]!;
    const idx = out.findIndex((p) => samePoint(p, c));
    if (idx > 0) {
      return closeRing(rotateOpenRing(out, idx));
    }
  }

  return closeRing(out);
}

/** Convert AIP compact ICAO coords like `604027N 0154854E` → TopSky / decimal. */

export function parseCompactCoord(token: string): { lat: number; lon: number } | null {
  const m = token
    .trim()
    .match(
      /^(\d{2,4})(\d{2})(\d{2}(?:\.\d+)?)([NS])\s+(\d{3,5})(\d{2})(\d{2}(?:\.\d+)?)([EW])$/i,
    );
  if (!m) return null;
  const latDeg = Number(m[1]);
  const latMin = Number(m[2]);
  const latSec = Number(m[3]);
  const lonDeg = Number(m[5]);
  const lonMin = Number(m[6]);
  const lonSec = Number(m[7]);
  let lat = latDeg + latMin / 60 + latSec / 3600;
  let lon = lonDeg + lonMin / 60 + lonSec / 3600;
  if (m[4].toUpperCase() === "S") lat = -lat;
  if (m[8].toUpperCase() === "W") lon = -lon;
  return { lat, lon };
}

export function parseTopSkyCoordPair(line: string): { lat: number; lon: number } | null {
  const trimmed = line.trim();
  // ESAA file often omits leading zeros: N066.26.8.428 E018.56.56.216
  // Accept 1–2 digit minutes / seconds (not only zero-padded \d{2}).
  const space = trimmed.match(
    /^([NS])(\d{2,3})\.(\d{1,2})\.(\d{1,2}(?:\.\d+)?)\s+([EW])(\d{2,3})\.(\d{1,2})\.(\d{1,2}(?:\.\d+)?)$/i,
  );
  if (space) {
    let lat =
      Number(space[2]) + Number(space[3]) / 60 + Number(space[4]) / 3600;
    let lon =
      Number(space[6]) + Number(space[7]) / 60 + Number(space[8]) / 3600;
    if (space[1].toUpperCase() === "S") lat = -lat;
    if (space[5].toUpperCase() === "W") lon = -lon;
    return { lat, lon };
  }
  // Colon form N060.40.27.000:E015.48.54.000 (also unpadded)
  const colon = trimmed.match(
    /^([NS])(\d{2,3})\.(\d{1,2})\.(\d{1,2}(?:\.\d+)?):([EW])(\d{2,3})\.(\d{1,2})\.(\d{1,2}(?:\.\d+)?)$/i,
  );
  if (colon) {
    let lat =
      Number(colon[2]) + Number(colon[3]) / 60 + Number(colon[4]) / 3600;
    let lon =
      Number(colon[6]) + Number(colon[7]) / 60 + Number(colon[8]) / 3600;
    if (colon[1].toUpperCase() === "S") lat = -lat;
    if (colon[5].toUpperCase() === "W") lon = -lon;
    return { lat, lon };
  }
  return null;
}

function pad3(n: number): string {
  return String(Math.floor(n)).padStart(3, "0");
}
function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, "0");
}

/**
 * Convert decimal degrees → ESAA TopSky `Nddd.mm.ss.mmm Eddd.mm.ss.mmm`.
 * Carries rounding so seconds never become 60 (TopSky rejects that as invalid).
 * Latitude degrees are zero-padded to 3 digits to match the live sectorfile.
 */
export function toTopSkyCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";

  const toDms = (absDeg: number): [number, number, number] => {
    // Work in integer thousandths of a second to avoid float edge cases.
    let totalMs = Math.round(Math.abs(absDeg) * 3600 * 1000);
    let sMs = totalMs % 60000;
    totalMs = (totalMs - sMs) / 60000;
    let m = totalMs % 60;
    let d = (totalMs - m) / 60;
    // sMs is 0..59999 → whole seconds 0..59 after /1000 floor; we emit .000
    let s = Math.floor(sMs / 1000);
    if (s >= 60) {
      s = 0;
      m += 1;
    }
    if (m >= 60) {
      m = 0;
      d += 1;
    }
    return [d, m, s];
  };

  const [latD, latM, latS] = toDms(lat);
  const [lonD, lonM, lonS] = toDms(lon);
  const latStr = `${ns}${pad3(latD)}.${pad2(latM)}.${pad2(latS)}.000`;
  const lonStr = `${ew}${pad3(lonD)}.${pad2(lonM)}.${pad2(lonS)}.000`;
  return `${latStr} ${lonStr}`;
}

export function closeRing(coords: [number, number][]): [number, number][] {
  if (coords.length < 3) return coords;
  const [fLon, fLat] = coords[0];
  const [lLon, lLat] = coords[coords.length - 1];
  if (Math.abs(fLon - lLon) < 1e-9 && Math.abs(fLat - lLat) < 1e-9) return coords;
  return [...coords, [fLon, fLat]];
}

/** Signed shoelace area (lon=x, lat=y). Positive ⇒ counter-clockwise. */
export function ringSignedArea(ring: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/**
 * GeoJSON / MapLibre exterior rings should be counter-clockwise.
 * Fixes odd fill artefacts when rings are clockwise or reversed.
 */
export function ensureOuterRingCcw(ring: [number, number][]): [number, number][] {
  const closed = closeRing(ring);
  if (closed.length < 4) return closed;
  if (ringSignedArea(closed) >= 0) return closed;
  const open = closed.slice(0, -1).reverse();
  return closeRing(open);
}

/** Common ESAA / TopSky Spacing° presets (vertex radial step). */
export const CIRCLE_SPACING_PRESETS = [5, 10, 12, 15, 20, 30] as const;

export function clampCircleSpacing(spacingDeg: number): number {
  if (!Number.isFinite(spacingDeg)) return 10;
  return Math.max(0.1, Math.min(120, spacingDeg));
}

/** Even step count from Spacing° so rings do not drift to 35/34 vertices. */
export function circleStepCount(spacingDeg: number): number {
  const spacing = clampCircleSpacing(spacingDeg);
  return Math.max(3, Math.round(360 / spacing));
}

export function spacingFromSteps(steps: number): number {
  const n = Math.max(3, Math.round(steps));
  return clampCircleSpacing(360 / n);
}

/** Infer Spacing° from an existing densified ring (open or closed). */
export function inferSpacingFromRing(coords: [number, number][]): number | undefined {
  if (coords.length < 3) return undefined;
  const [fLon, fLat] = coords[0];
  const [lLon, lLat] = coords[coords.length - 1];
  const closed =
    Math.abs(fLon - lLon) < 1e-9 && Math.abs(fLat - lLat) < 1e-9;
  const open = closed ? coords.length - 1 : coords.length;
  if (open < 3) return undefined;
  return spacingFromSteps(open);
}

/** Densify a full circle to lon/lat ring. Spacing in degrees (TopSky COORD_CIRCLE Spacing). */
export function densifyCircle(
  lat: number,
  lon: number,
  radiusNm: number,
  spacingDeg: number,
): [number, number][] {
  const nSteps = circleStepCount(spacingDeg);
  const step = 360 / nSteps;
  const R_EARTH_NM = 3440.065;
  const latRad = (lat * Math.PI) / 180;
  const angular = radiusNm / R_EARTH_NM;
  const pts: [number, number][] = [];
  for (let i = 0; i < nSteps; i++) {
    const brng = ((i * step) * Math.PI) / 180;
    const destLat = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
        Math.cos(latRad) * Math.sin(angular) * Math.cos(brng),
    );
    const destLon =
      ((lon * Math.PI) / 180) +
      Math.atan2(
        Math.sin(brng) * Math.sin(angular) * Math.cos(latRad),
        Math.cos(angular) - Math.sin(latRad) * Math.sin(destLat),
      );
    pts.push([(destLon * 180) / Math.PI, (destLat * 180) / Math.PI]);
  }
  return closeRing(pts);
}

/**
 * Auto Spacing° from circle radius (NM) — ESAA TopSkyAreas practice:
 * tiny → coarser; ~1 NM → 10° (36 verts); larger → gradually coarser.
 */
export function defaultSpacingForRadius(radiusNm: number): number {
  const r = Number.isFinite(radiusNm) ? Math.abs(radiusNm) : 1;
  if (r <= 0.7) return 15;
  if (r <= 1.5) return 10;
  if (r <= 3) return 12;
  if (r <= 6) return 10;
  if (r <= 12) return 15;
  if (r <= 25) return 20;
  return 30;
}

/** Alias used by UI / Accept — always pick Spacing° from radius. */
export function autoSpacingForRadius(radiusNm: number): number {
  return defaultSpacingForRadius(radiusNm);
}

/** Re-build polygon ring for a circle area at a chosen Spacing°. */
export function redensifyBoundCircle(
  bound: { lat: number; lon: number; radiusNm: number },
  spacingDeg: number,
): { coordinates: [number, number][]; circleSpacingDeg: number } {
  const circleSpacingDeg = clampCircleSpacing(spacingDeg);
  return {
    coordinates: densifyCircle(
      bound.lat,
      bound.lon,
      bound.radiusNm,
      circleSpacingDeg,
    ),
    circleSpacingDeg,
  };
}

/** Densify using auto Spacing° from radius. */
export function redensifyBoundCircleAuto(bound: {
  lat: number;
  lon: number;
  radiusNm: number;
}): { coordinates: [number, number][]; circleSpacingDeg: number } {
  return redensifyBoundCircle(bound, autoSpacingForRadius(bound.radiusNm));
}

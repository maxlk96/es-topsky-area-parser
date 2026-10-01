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

export function toTopSkyCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const alat = Math.abs(lat);
  const alon = Math.abs(lon);
  const latD = Math.floor(alat);
  const latM = Math.floor((alat - latD) * 60);
  const latS = ((alat - latD) * 60 - latM) * 60;
  const lonD = Math.floor(alon);
  const lonM = Math.floor((alon - lonD) * 60);
  const lonS = ((alon - lonD) * 60 - lonM) * 60;
  const latStr = `${ns}${pad2(latD)}.${pad2(latM)}.${pad2(Math.round(latS))}.000`;
  const lonStr = `${ew}${pad3(lonD)}.${pad2(lonM)}.${pad2(Math.round(lonS))}.000`;
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
 * Heuristic Spacing° by radius NM — aligned to ESAA TopSkyAreas practice
 * (most ~1–2 NM circles use 10° / 36 vertices; tiny often 15°).
 */
export function defaultSpacingForRadius(radiusNm: number): number {
  if (radiusNm <= 0.7) return 15;
  if (radiusNm <= 1.5) return 10;
  if (radiusNm <= 3) return 12;
  if (radiusNm <= 8) return 15;
  if (radiusNm <= 20) return 20;
  return 30;
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

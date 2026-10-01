/** Vertical limits: TopSky LIMITS uses hundreds of feet (Developer Guide). */

export function feetToLimitsUnit(ft: number): number {
  return Math.round(ft / 100);
}

export function parseAipVerticalToken(token: string): number | null {
  const t = token.trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (t === "GND" || t === "SFC" || t === "GROUND") return 0;
  if (t === "UNL" || t === "UNLIM" || t === "UNLIMITED") return 999;
  const fl = t.match(/^FL\s*(\d{1,3})$/);
  if (fl) return Number(fl[1]);
  const ft = t.match(/^(\d+(?:\.\d+)?)\s*(?:FT|FEET)?(?:\s*(?:AMSL|ASL|AGL))?$/);
  if (ft) return feetToLimitsUnit(Number(ft[1]));
  const bare = t.match(/^(\d{1,3})$/);
  if (bare) return Number(bare[1]);
  return null;
}

export function parseLimitsLine(line: string): [number, number] | null {
  const m = line.trim().match(/^LIMITS:(-?\d+):(-?\d+)\s*$/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

export function formatLimits(lo: number, hi: number): string {
  return `LIMITS:${lo}:${hi}`;
}

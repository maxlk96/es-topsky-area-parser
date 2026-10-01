/** Vertical limits: TopSky LIMITS uses hundreds of feet (Developer Guide). */

export function feetToLimitsUnit(ft: number): number {
  return Math.round(ft / 100);
}

/**
 * Match AIP vertical tokens. Prefer `400 ft SFC` as one token so bare `SFC`
 * is not also captured as GND/0 (ESR130 Malmö: 400 ft SFC – 1200 ft AMSL).
 */
export const AIP_VERTICAL_TOKEN_RE =
  /\b(FL\s*\d{1,3}|UNL|UNLIM|UNLIMITED|\d{3,5}\s*ft(?:\s*(?:AMSL|ASL|AGL|SFC))?|GND|GROUND|SFC)\b/gi;

export function parseAipVerticalToken(token: string): number | null {
  const t = token.trim().toUpperCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (t === "GND" || t === "SFC" || t === "GROUND") return 0;
  if (t === "UNL" || t === "UNLIM" || t === "UNLIMITED") return 999;
  const fl = t.match(/^FL\s*(\d{1,3})$/);
  if (fl) return Number(fl[1]);
  // "400 FT SFC" / "1200 FT AMSL" / "2500 FT" → hundreds of feet
  const ft = t.match(
    /^(\d+(?:\.\d+)?)\s*(?:FT|FEET)(?:\s*(?:AMSL|ASL|AGL|SFC))?$/,
  );
  if (ft) return feetToLimitsUnit(Number(ft[1]));
  const bare = t.match(/^(\d{1,3})$/);
  if (bare) return Number(bare[1]);
  return null;
}

/** Extract [lower, upper] LIMITS units from AIP prose (ENR / SUP). */
export function extractAipLimitPair(text: string): [number, number] | undefined {
  const tokens = [...text.matchAll(AIP_VERTICAL_TOKEN_RE)].map((m) => m[1]);
  const nums = tokens
    .map(parseAipVerticalToken)
    .filter((n): n is number => n != null);
  if (nums.length >= 2) return [Math.min(...nums), Math.max(...nums)];
  if (nums.length === 1) return [0, nums[0]];
  return undefined;
}

export function parseLimitsLine(line: string): [number, number] | null {
  const m = line.trim().match(/^LIMITS:(-?\d+):(-?\d+)\s*$/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

export function formatLimits(lo: number, hi: number): string {
  return `LIMITS:${lo}:${hi}`;
}

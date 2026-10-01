import { shortFromDesignator } from "./classify";

/** True when name is empty or only the designator / short id (R41A, ESR41A). */
export function isDesignatorOnlyName(
  name: string | undefined | null,
  shortName: string,
  id: string,
): boolean {
  const n = (name || "").trim().toUpperCase();
  if (!n) return true;
  const short = shortName.trim().toUpperCase();
  const full = id.trim().toUpperCase();
  const fromId = shortFromDesignator(full).toUpperCase();
  return n === short || n === full || n === fromId;
}

/**
 * Clean //ESR2 Vidsel GND-UNL style comment tails into a display name.
 * Does not invent names — returns empty if nothing useful remains.
 */
export function cleanCommentName(raw: string): string {
  let s = raw.trim();
  // Strip common altitude / validity tails after the place name
  s = s.replace(/\s+GND\s*[-–/]?\s*UNL.*$/i, "");
  s = s.replace(/\s+GND\b.*$/i, "");
  s = s.replace(/\s+SFC\b.*$/i, "");
  s = s.replace(/\s+FL\s*\d+.*$/i, "");
  s = s.replace(/\s+\d{1,5}\s*[-–]\s*\d{1,5}.*$/i, "");
  s = s.replace(/\s+Valid\b.*$/i, "");
  return s.trim();
}

/** Prefer LABEL text, then cleaned comment name; uppercase for TopSky convention. */
export function resolveAreaName(opts: {
  labelText?: string;
  commentName?: string;
  shortName: string;
  id: string;
}): { name: string; fromAip: boolean } {
  const label = (opts.labelText || "").trim();
  if (label && !isDesignatorOnlyName(label, opts.shortName, opts.id)) {
    return { name: label.toLocaleUpperCase("sv-SE"), fromAip: true };
  }
  const comment = cleanCommentName(opts.commentName || "");
  if (comment && !isDesignatorOnlyName(comment, opts.shortName, opts.id)) {
    return { name: comment.toLocaleUpperCase("sv-SE"), fromAip: true };
  }
  // Keep whatever non-empty label/comment we have even if designator-like,
  // otherwise fall back to shortName (caller flags needsReview for R/D).
  if (label) return { name: label.toLocaleUpperCase("sv-SE"), fromAip: false };
  if (comment) return { name: comment.toLocaleUpperCase("sv-SE"), fromAip: false };
  return { name: opts.shortName.trim(), fromAip: false };
}

import { shortFromDesignator } from "./classify";

/** ESR03 → ESR3 (ENR leading zeros); ESR117 / ESD309 unchanged. */
export function normalizeDesignator(id: string): string {
  return id.replace(/^(ES[RD])0+(\d)/i, "$1$2").toUpperCase();
}

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
 * Strip accidental markup / file corruption from place names.
 * e.g. ESAA LABEL `NYN<\xe4SHAMN` → `NYNäSHAMN`.
 */
export function sanitizePlaceName(raw: string): string {
  return raw.replace(/[<>{}|\\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Clean //ESR2 Vidsel GND-UNL style comment tails into a display name.
 * Does not invent names — returns empty if nothing useful remains.
 */
export function cleanCommentName(raw: string): string {
  let s = sanitizePlaceName(raw);
  // Strip common altitude / validity tails after the place name
  s = s.replace(/\s+GND\s*[-–/]?\s*UNL.*$/i, "");
  s = s.replace(/\s+GND\b.*$/i, "");
  s = s.replace(/\s+SFC\b.*$/i, "");
  s = s.replace(/\s+FL\s*\d+.*$/i, "");
  s = s.replace(/\s+\d{1,5}\s*[-–]\s*\d{1,5}.*$/i, "");
  s = s.replace(/\s+Valid\b.*$/i, "");
  return s.trim();
}

function scoreName(name: string): number {
  if (!name) return -1;
  let score = name.length;
  // Penalize leftover junk (shouldn't remain after sanitize, but be safe)
  if (/[<>{}]/.test(name)) score -= 50;
  // Prefer names that look like words, not designators
  if (/^R?\d+[A-Z]?$/i.test(name) || /^ES[RD]/i.test(name)) score -= 20;
  return score;
}

/** Prefer LABEL text, then cleaned comment name; uppercase for TopSky convention. */
export function resolveAreaName(opts: {
  labelText?: string;
  commentName?: string;
  shortName: string;
  id: string;
}): { name: string; fromAip: boolean; fixedCorruption: boolean } {
  const labelRaw = (opts.labelText || "").trim();
  const label = sanitizePlaceName(labelRaw);
  const comment = cleanCommentName(opts.commentName || "");
  const labelHadJunk = Boolean(labelRaw && labelRaw !== label);

  const labelOk =
    label && !isDesignatorOnlyName(label, opts.shortName, opts.id);
  const commentOk =
    comment && !isDesignatorOnlyName(comment, opts.shortName, opts.id);

  // Corrupted LABEL (e.g. NYN<\xe4SHAMN): prefer clean //ES comment when available.
  if (labelHadJunk && commentOk) {
    return {
      name: comment.toLocaleUpperCase("sv-SE"),
      fromAip: true,
      fixedCorruption: true,
    };
  }

  if (labelOk && commentOk) {
    // Pick the higher-quality AIP string
    const pick = scoreName(comment) > scoreName(label) ? comment : label;
    return {
      name: pick.toLocaleUpperCase("sv-SE"),
      fromAip: true,
      fixedCorruption: labelHadJunk,
    };
  }
  if (labelOk) {
    return {
      name: label.toLocaleUpperCase("sv-SE"),
      fromAip: true,
      fixedCorruption: labelHadJunk,
    };
  }
  if (commentOk) {
    return {
      name: comment.toLocaleUpperCase("sv-SE"),
      fromAip: true,
      fixedCorruption: false,
    };
  }
  if (label) {
    return {
      name: label.toLocaleUpperCase("sv-SE"),
      fromAip: false,
      fixedCorruption: labelHadJunk,
    };
  }
  if (comment) {
    return {
      name: comment.toLocaleUpperCase("sv-SE"),
      fromAip: false,
      fixedCorruption: false,
    };
  }
  return {
    name: opts.shortName.trim(),
    fromAip: false,
    fixedCorruption: false,
  };
}

import type { AreaRecord } from "./types";

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

/** True calendar year (not an HHMM like 1600 / 2359). */
export function looksLikeYear(n: number): boolean {
  return n >= 1990 && n <= 2100;
}

/**
 * Parse "31 DEC 2026", "22 OCT 1200" (+ defaultYear for HHMM), or ISO.
 * HHMM tokens (incl. 2000 = 20:00) must not be treated as years when
 * `timeIsHhmm` is set — aviation hours overlap the 1990–2100 year range.
 */
export function parseLooseDate(
  s: string,
  opts?: { defaultYear?: number; endOfDay?: boolean; timeIsHhmm?: boolean },
): Date | null {
  const raw = s.trim();
  if (!raw) return null;

  const m = raw.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})(?:\s+(\d{2}):?(\d{2}))?$/i);
  if (m) {
    const day = Number(m[1]);
    const mi = MONTHS[m[2].toUpperCase()];
    if (mi == null) return null;
    const third = Number(m[3]);
    let year: number;
    let hour = 0;
    let minute = 0;

    if (opts?.timeIsHhmm) {
      if (opts.defaultYear == null) return null;
      year = opts.defaultYear;
      hour = Math.floor(third / 100);
      minute = third % 100;
    } else if (looksLikeYear(third)) {
      year = third;
      if (m[4] != null && m[5] != null) {
        hour = Number(m[4]);
        minute = Number(m[5]);
      } else if (opts?.endOfDay) {
        hour = 23;
        minute = 59;
      }
    } else if (opts?.defaultYear != null) {
      year = opts.defaultYear;
      hour = Math.floor(third / 100);
      minute = third % 100;
    } else {
      return null;
    }

    if (hour > 23 || minute > 59) return null;
    return new Date(Date.UTC(year, mi, day, hour, minute, opts?.endOfDay ? 59 : 0));
  }

  const iso = Date.parse(raw);
  if (!Number.isNaN(iso)) return new Date(iso);
  return null;
}

export function yearHintFromMeta(meta: {
  supNumber?: string;
  href?: string;
  amdtId?: string;
}): number | undefined {
  const fromSup = meta.supNumber?.match(/\/(\d{4})\b/)?.[1];
  if (fromSup && looksLikeYear(Number(fromSup))) return Number(fromSup);
  const fromHref = meta.href?.match(/(20\d{2})/)?.[1];
  if (fromHref && looksLikeYear(Number(fromHref))) return Number(fromHref);
  const fromAmdt = meta.amdtId?.match(/(20\d{2})/)?.[1];
  if (fromAmdt && looksLikeYear(Number(fromAmdt))) return Number(fromAmdt);
  return undefined;
}

export function yearHintFromText(text: string): number | undefined {
  // Prefer "AIP SUP nnn/2026" or publication "01 OCT 2026"
  const supYear = text.match(/AIP\s+SUP\s+\d+\/(\d{4})/i)?.[1];
  if (supYear && looksLikeYear(Number(supYear))) return Number(supYear);
  const pub = text.match(
    /\b(\d{1,2})\s+[A-Z]{3}\s+(20\d{2})\b/i,
  )?.[2];
  if (pub && looksLikeYear(Number(pub))) return Number(pub);
  return undefined;
}

export type ValidityWindow = {
  validFrom?: string;
  validTo?: string;
  fromDate?: Date;
  toDate?: Date;
};

/**
 * Parse SUP hours / period. Handles:
 * - "from 21 OCT 2026 to 22 OCT 2026"
 * - "07 OCT 2026 – 31 AUG 2027" (explicit years, possibly spanning years)
 * - "21 OCT 1600 – 22 OCT 1200" (HHMM; year from SUP / publication)
 */
export function parseValidityWindow(
  chunk: string,
  fullText: string,
  meta: { amdtId?: string; supNumber?: string; href?: string },
): ValidityWindow {
  const year =
    yearHintFromMeta(meta) ?? yearHintFromText(fullText) ?? yearHintFromText(chunk);

  // Full year forms first (catalogue-style from/to)
  const period = fullText.match(
    /from\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s+to\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})/i,
  );
  if (period) {
    const fromDate = parseLooseDate(period[1]);
    const toDate = parseLooseDate(period[2], { endOfDay: true });
    return {
      validFrom: period[1],
      validTo: period[2],
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    };
  }

  // Explicit calendar years on both sides: "07 OCT 2026 – 31 AUG 2027"
  // Must run before HHMM handling — 2027 as HHMM + SUP year would become AUG 2026.
  const yearRange =
    chunk.match(
      /(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s*[–-]\s*(\d{1,2}\s+[A-Z]{3}\s+20\d{2})/i,
    ) ||
    fullText.match(
      /(\d{1,2}\s+[A-Z]{3}\s+20\d{2})\s*[–-]\s*(\d{1,2}\s+[A-Z]{3}\s+20\d{2})/i,
    );
  if (yearRange) {
    const fromDate = parseLooseDate(yearRange[1]);
    const toDate = parseLooseDate(yearRange[2], { endOfDay: true });
    return {
      validFrom: yearRange[1],
      validTo: yearRange[2],
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    };
  }

  // Per-area or document Hours: DD MON HHMM – DD MON HHMM (no years)
  const hours =
    chunk.match(
      /(\d{1,2}\s+[A-Z]{3}\s+\d{4})\s*[–-]\s*(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i,
    ) ||
    fullText.match(
      /Hours?\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})\s*[–-]\s*(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i,
    );

  if (hours && year != null) {
    const endTok = hours[2].match(/(\d{4})\s*$/)?.[1];
    const startTok = hours[1].match(/(\d{4})\s*$/)?.[1];
    // Safety: if both look like years, treat as calendar range (should have matched above)
    if (
      startTok &&
      endTok &&
      looksLikeYear(Number(startTok)) &&
      looksLikeYear(Number(endTok))
    ) {
      const fromDate = parseLooseDate(hours[1]);
      const toDate = parseLooseDate(hours[2], { endOfDay: true });
      return {
        validFrom: hours[1],
        validTo: hours[2],
        fromDate: fromDate ?? undefined,
        toDate: toDate ?? undefined,
      };
    }

    const fromDate = parseLooseDate(hours[1], {
      defaultYear: year,
      timeIsHhmm: true,
    });
    const toDate = parseLooseDate(hours[2], {
      defaultYear: year,
      timeIsHhmm: true,
    });
    // Store canonical calendar strings for display / re-parse
    const validFrom = formatDayMonYear(fromDate) ?? hours[1];
    const validTo = formatDayMonYear(toDate) ?? hours[2];
    return {
      validFrom,
      validTo,
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    };
  }

  // Bare "Valid to DD MON YYYY"
  const onlyTo = fullText.match(
    /Valid to\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})/i,
  )?.[1];
  if (onlyTo) {
    return {
      validTo: onlyTo,
      toDate: parseLooseDate(onlyTo, { endOfDay: true }) ?? undefined,
    };
  }

  return {};
}

function formatDayMonYear(d: Date | null | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  const months = Object.keys(MONTHS);
  const mon = months.find((k) => MONTHS[k] === d.getUTCMonth()) ?? "JAN";
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${mon} ${d.getUTCFullYear()}`;
}

/**
 * Expired only after the validity end has passed.
 * Upcoming (now < start) and active (start ≤ now ≤ end) are NOT expired.
 */
function resolveProvenanceDate(
  raw: string,
  area: AreaRecord,
  endOfDay: boolean,
): Date | null {
  const year =
    yearHintFromMeta({
      supNumber: area.provenance.supNumber,
      href: area.provenance.href,
      amdtId: area.provenance.amdtId,
    }) ?? undefined;
  // Canonical "DD MON YYYY" from parseValidityWindow
  const asYear = parseLooseDate(raw, { endOfDay });
  if (asYear) return asYear;
  // Legacy HHMM leftovers
  return parseLooseDate(raw, {
    defaultYear: year,
    timeIsHhmm: true,
    endOfDay,
  });
}

export function isExpired(area: AreaRecord, now: Date): boolean {
  const toRaw = area.provenance.validTo;
  if (!toRaw) return false;
  const to = resolveProvenanceDate(toRaw, area, true);
  if (!to) return false;
  // Expired only after end — not before start.
  return now.getTime() > to.getTime();
}

/** Optional helper for UI: true when the window has not started yet. */
export function isUpcoming(area: AreaRecord, now: Date): boolean {
  const fromRaw = area.provenance.validFrom;
  if (!fromRaw) return false;
  const from = resolveProvenanceDate(fromRaw, area, false);
  if (!from) return false;
  return now.getTime() < from.getTime();
}

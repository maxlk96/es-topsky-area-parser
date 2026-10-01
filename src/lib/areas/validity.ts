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

const MON = Object.keys(MONTHS).join("|");

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
  const pub = text.match(/\b(\d{1,2})\s+[A-Z]{3}\s+(20\d{2})\b/i)?.[2];
  if (pub && looksLikeYear(Number(pub))) return Number(pub);
  return undefined;
}

export type ValidityWindow = {
  validFrom?: string;
  validTo?: string;
  fromDate?: Date;
  toDate?: Date;
  /** All parsed Hours/period ranges (when the SUP has several). */
  windows?: { validFrom: string; validTo: string; fromDate: Date; toDate: Date }[];
};

type DatedWindow = {
  validFrom: string;
  validTo: string;
  fromDate: Date;
  toDate: Date;
};

function formatDayMonYear(d: Date | null | undefined): string | undefined {
  if (!d || Number.isNaN(d.getTime())) return undefined;
  const months = Object.keys(MONTHS);
  const mon = months.find((k) => MONTHS[k] === d.getUTCMonth()) ?? "JAN";
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${day} ${mon} ${d.getUTCFullYear()}`;
}

function makeWindow(fromDate: Date, toDate: Date): DatedWindow | null {
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  let from = fromDate;
  let to = toDate;
  // Overnight / crossed wrong: if end before start and same-ish season, bump end year
  if (to.getTime() < from.getTime()) {
    to = new Date(
      Date.UTC(
        to.getUTCFullYear() + 1,
        to.getUTCMonth(),
        to.getUTCDate(),
        to.getUTCHours(),
        to.getUTCMinutes(),
        to.getUTCSeconds(),
      ),
    );
  }
  const validFrom = formatDayMonYear(from);
  const validTo = formatDayMonYear(to);
  if (!validFrom || !validTo) return null;
  return { validFrom, validTo, fromDate: from, toDate: to };
}

function dateFromParts(
  day: number,
  monTok: string,
  year: number,
  opts?: { hour?: number; minute?: number; endOfDay?: boolean },
): Date | null {
  const mi = MONTHS[monTok.toUpperCase()];
  if (mi == null) return null;
  const hour = opts?.endOfDay ? 23 : (opts?.hour ?? 0);
  const minute = opts?.endOfDay ? 59 : (opts?.minute ?? 0);
  return new Date(Date.UTC(year, mi, day, hour, minute, opts?.endOfDay ? 59 : 0));
}

/** Pull the Tider/Hours body when present (ignore preamble "Updated hours …"). */
export function extractHoursSection(text: string): string | null {
  const m = text.match(
    /Tider\s*\/\s*Hours\s*([\s\S]*?)(?:–\s*S\s*L\s*U\s*T|S\s*L\s*U\s*T\s*\/\s*E\s*N\s*D|SLUT\s*\/\s*END|$)/i,
  );
  return m?.[1]?.trim() ? m[1] : null;
}

/**
 * Parse every date-range window in an Hours block (and similar free text).
 * Daily MON–FRI / HHMM schedules are ignored for expiry — only calendar ranges matter.
 */
export function parseAllValidityWindows(
  hoursText: string,
  year: number,
): DatedWindow[] {
  const windows: DatedWindow[] = [];
  const seen = new Set<string>();
  const add = (w: DatedWindow | null) => {
    if (!w) return;
    const key = `${w.fromDate.toISOString()}|${w.toDate.toISOString()}`;
    if (seen.has(key)) return;
    seen.add(key);
    windows.push(w);
  };

  const lines = hoursText
    .split(/\n+/)
    .map((l) => l.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);

  const scan = (line: string) => {
    // Explicit years both sides: 07 OCT 2026 – 31 AUG 2027
    const yearRange = line.match(
      new RegExp(
        `(\\d{1,2})\\s+(${MON})\\s+(20\\d{2})\\s*[–-]\\s*(\\d{1,2})\\s+(${MON})\\s+(20\\d{2})`,
        "i",
      ),
    );
    if (yearRange) {
      const from = dateFromParts(Number(yearRange[1]), yearRange[2], Number(yearRange[3]));
      const to = dateFromParts(Number(yearRange[4]), yearRange[5], Number(yearRange[6]), {
        endOfDay: true,
      });
      if (from && to) add(makeWindow(from, to));
      return;
    }

    // DD MON HHMM – DD MON HHMM (e.g. 28 APR 0600 – 01 MAY 2200)
    const hhmmRange = line.match(
      new RegExp(
        `(\\d{1,2})\\s+(${MON})\\s+(\\d{4})\\s*[–-]\\s*(\\d{1,2})\\s+(${MON})\\s+(\\d{4})`,
        "i",
      ),
    );
    if (hhmmRange) {
      const startTok = Number(hhmmRange[3]);
      const endTok = Number(hhmmRange[6]);
      if (looksLikeYear(startTok) && looksLikeYear(endTok)) {
        // Actually years — handled above usually
        const from = dateFromParts(Number(hhmmRange[1]), hhmmRange[2], startTok);
        const to = dateFromParts(Number(hhmmRange[4]), hhmmRange[5], endTok, {
          endOfDay: true,
        });
        if (from && to) add(makeWindow(from, to));
        return;
      }
      const from = dateFromParts(Number(hhmmRange[1]), hhmmRange[2], year, {
        hour: Math.floor(startTok / 100),
        minute: startTok % 100,
      });
      const to = dateFromParts(Number(hhmmRange[4]), hhmmRange[5], year, {
        hour: Math.floor(endTok / 100),
        minute: endTok % 100,
      });
      if (from && to) add(makeWindow(from, to));
      return;
    }

    // DD MON – DD MON … (e.g. 30 MAR – 27 APR, MON – FRI 0600 – 1730)
    // Avoid matching "MON – FRI" by requiring month tokens.
    const monRange = line.match(
      new RegExp(
        `(\\d{1,2})\\s+(${MON})(?:\\s+(20\\d{2}))?\\s*[–-]\\s*(\\d{1,2})\\s+(${MON})(?:\\s+(20\\d{2}))?`,
        "i",
      ),
    );
    if (monRange) {
      const y1 = monRange[3] ? Number(monRange[3]) : year;
      const y2 = monRange[6] ? Number(monRange[6]) : year;
      const from = dateFromParts(Number(monRange[1]), monRange[2], y1);
      const to = dateFromParts(Number(monRange[4]), monRange[5], y2, { endOfDay: true });
      if (from && to) add(makeWindow(from, to));
      return;
    }

    // Same-month: 28 – 31 DEC [HHMM…]
    const sameMon = line.match(
      new RegExp(`(\\d{1,2})\\s*[–-]\\s*(\\d{1,2})\\s+(${MON})(?:\\s+(20\\d{2}))?`, "i"),
    );
    if (sameMon) {
      const y = sameMon[4] ? Number(sameMon[4]) : year;
      const from = dateFromParts(Number(sameMon[1]), sameMon[3], y);
      const to = dateFromParts(Number(sameMon[2]), sameMon[3], y, { endOfDay: true });
      if (from && to) add(makeWindow(from, to));
    }
  };

  for (const line of lines) scan(line);
  // Also scan whole blob once for single-line Hours blobs
  if (!windows.length) scan(hoursText.replace(/\s+/g, " ").trim());

  windows.sort((a, b) => a.fromDate.getTime() - b.fromDate.getTime());
  return windows;
}

function spanWindows(windows: DatedWindow[]): ValidityWindow {
  if (!windows.length) return {};
  const fromDate = windows.reduce(
    (min, w) => (w.fromDate < min ? w.fromDate : min),
    windows[0].fromDate,
  );
  const toDate = windows.reduce(
    (max, w) => (w.toDate > max ? w.toDate : max),
    windows[0].toDate,
  );
  return {
    validFrom: formatDayMonYear(fromDate),
    validTo: formatDayMonYear(toDate),
    fromDate,
    toDate,
    windows,
  };
}

/**
 * Parse SUP hours / period. Handles multi-window Hours (e.g. SUP 83/2026) by
 * taking the overall span of all windows for validFrom/validTo.
 *
 * Also handles:
 * - "from 21 OCT 2026 to 22 OCT 2026"
 * - "07 OCT 2026 – 31 AUG 2027"
 * - "21 OCT 1600 – 22 OCT 1200"
 */
export function parseValidityWindow(
  chunk: string,
  fullText: string,
  meta: { amdtId?: string; supNumber?: string; href?: string },
): ValidityWindow {
  const year =
    yearHintFromMeta(meta) ?? yearHintFromText(fullText) ?? yearHintFromText(chunk);

  // Prefer the dedicated Tider/Hours section — ignore preamble "Updated hours …"
  const hoursSection = extractHoursSection(fullText) ?? extractHoursSection(chunk);
  if (hoursSection && year != null) {
    const windows = parseAllValidityWindows(hoursSection, year);
    if (windows.length) return spanWindows(windows);
  }

  // Multi-window hunt in chunk/fullText when no labelled Hours section
  if (year != null) {
    const blob = `${chunk}\n${fullText}`;
    const windows = parseAllValidityWindows(blob, year);
    // Only trust multi-parse when we found 2+ ranges (avoid grabbing "Updated hours" alone as truth)
    if (windows.length >= 2) return spanWindows(windows);
    if (windows.length === 1 && hoursSection) return spanWindows(windows);
  }

  // Catalogue-style from/to with years
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
      windows:
        fromDate && toDate
          ? [
              {
                validFrom: period[1],
                validTo: period[2],
                fromDate,
                toDate,
              },
            ]
          : undefined,
    };
  }

  // Explicit calendar years on both sides: "07 OCT 2026 – 31 AUG 2027"
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

  // Single Hours: DD MON HHMM – DD MON HHMM
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
    return {
      validFrom: formatDayMonYear(fromDate) ?? hours[1],
      validTo: formatDayMonYear(toDate) ?? hours[2],
      fromDate: fromDate ?? undefined,
      toDate: toDate ?? undefined,
    };
  }

  // Bare "Valid to DD MON YYYY"
  const onlyTo = fullText.match(/Valid to\s+(\d{1,2}\s+[A-Z]{3}\s+20\d{2})/i)?.[1];
  if (onlyTo) {
    return {
      validTo: onlyTo,
      toDate: parseLooseDate(onlyTo, { endOfDay: true }) ?? undefined,
    };
  }

  // Catalogue from/to without requiring Hours (e.g. period line only)
  if (year != null) {
    const windows = parseAllValidityWindows(`${chunk}\n${fullText}`, year);
    if (windows.length === 1) return spanWindows(windows);
  }

  return {};
}

/**
 * Expired only after the validity end has passed.
 * Upcoming (now < start) and active (start ≤ now ≤ end) are NOT expired.
 * For multi-window SUPs, validTo is the latest window end — expired only when
 * all windows have ended.
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
  const asYear = parseLooseDate(raw, { endOfDay });
  if (asYear) return asYear;
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
  return now.getTime() > to.getTime();
}

/** True when now is before the earliest validity window start. */
export function isUpcoming(area: AreaRecord, now: Date): boolean {
  const fromRaw = area.provenance.validFrom;
  if (!fromRaw) return false;
  const from = resolveProvenanceDate(fromRaw, area, false);
  if (!from) return false;
  return now.getTime() < from.getTime();
}

/** True when now falls inside at least one parsed window (or overall span if none listed). */
export function isWithinAnyWindow(area: AreaRecord, now: Date): boolean {
  const windows = area.provenance.validityWindows;
  if (windows?.length) {
    return windows.some((w) => {
      const from = resolveProvenanceDate(w.from, area, false);
      const to = resolveProvenanceDate(w.to, area, true);
      if (!from || !to) return false;
      const t = now.getTime();
      return t >= from.getTime() && t <= to.getTime();
    });
  }
  if (isExpired(area, now) || isUpcoming(area, now)) return false;
  return !!(area.provenance.validFrom || area.provenance.validTo);
}

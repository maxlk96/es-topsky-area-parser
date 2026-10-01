import { toTopSkyCoord, closeRing } from "./coords";
import { formatLimits } from "./limits";
import type { AreaRecord } from "./types";

export function formatAreaBlock(area: AreaRecord): string {
  const lines: string[] = [];
  const designator = area.id.toUpperCase();
  const labelText = (area.label?.text || area.name).toUpperCase();
  lines.push(`//${designator} ${labelText}`);
  // Two leading spaces for R/D AMS sort
  const pad =
    area.category === "R" || area.category === "D" ? "  " : area.category === "PCA" ? " " : "";
  lines.push(`AREA:${area.areaTypeCode}:${pad}${area.shortName}`);
  if (area.noaiw) lines.push("NOAIW");
  if (area.activation?.type === "AUP" && area.activation.key) {
    lines.push(`ACTIVE:AUP:${area.activation.key}`);
  } else if (area.activation?.type === "AUP_GROUP" && area.activation.key) {
    lines.push(`ACTIVE:AUP_GROUP:${area.activation.key}`);
  } else if (area.activation?.type === "ALWAYS") {
    lines.push("ACTIVE:1");
  }
  // MANUAL / NONE → no ACTIVE line
  if (area.label) {
    const latLon = toTopSkyCoord(area.label.lat, area.label.lon).split(" ");
    lines.push(`LABEL:${latLon[0]}:${latLon[1]}:${labelText}`);
  }
  if (area.limits) {
    lines.push(formatLimits(area.limits[0], area.limits[1]));
  }
  if (area.boundCircle) {
    const c = toTopSkyCoord(area.boundCircle.lat, area.boundCircle.lon).split(" ");
    lines.push(`BOUND:C:${c[0]}:${c[1]}:${area.boundCircle.radiusNm}`);
  }
  const ring = closeRing(area.coordinates);
  for (const [lon, lat] of ring) {
    lines.push(toTopSkyCoord(lat, lon));
  }
  lines.push("");
  return lines.join("\n");
}

const TEMPO_START = "//      START OF TEMPO R AND D AREAS";
const TEMPO_END = "//      END OF TEMPO R AND D AREAS";

/** Surgical replace of tempo section; remove expired; insert accepted new blocks. */
export function mergeTempoSection(
  originalText: string,
  workingAreas: AreaRecord[],
  opts?: { now?: Date },
): string {
  const now = opts?.now ?? new Date();
  const text = originalText.replace(/\r\n/g, "\n");
  const startIdx = text.indexOf("START OF TEMPO R AND D AREAS");
  const endIdx = text.indexOf("END OF TEMPO R AND D AREAS");
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    // append tempo section
    const tempoBlocks = workingAreas
      .filter((a) => a.section === "tempo" || a.provenance.source === "sup" || a.provenance.source === "notam")
      .filter((a) => !isExpired(a, now))
      .map(formatAreaBlock)
      .join("\n");
    return `${text.trimEnd()}\n\n${TEMPO_START}\n${tempoBlocks}${TEMPO_END}\n`;
  }

  // Find line starts
  const before = text.slice(0, text.lastIndexOf("\n", startIdx) + 1);
  const afterStartLine = text.indexOf("\n", startIdx);
  const endLineStart = text.lastIndexOf("\n", endIdx) + 1;
  const after = text.slice(text.indexOf("\n", endIdx) + 1);

  const tempoAreas = workingAreas.filter(
    (a) =>
      (a.section === "tempo" ||
        a.provenance.source === "sup" ||
        a.provenance.source === "notam" ||
        a.provenance.source === "topsky") &&
      (a.category === "R" || a.category === "D") &&
      a.mapDefaultVisible,
  );

  // Prefer areas explicitly marked tempo, else those that were in tempo section
  const inTempo = workingAreas.filter((a) => a.section === "tempo" && !isExpired(a, now));

  const blocks = (inTempo.length ? inTempo : tempoAreas.filter((a) => !isExpired(a, now)))
    .map((a) => {
      // Prefer preserving rawBlock for untouched topsky areas
      if (a.provenance.source === "topsky" && a.rawBlock && !a.exclusionReason) {
        return a.rawBlock.trimEnd() + "\n";
      }
      return formatAreaBlock(a);
    })
    .join("\n");

  void before;
  void afterStartLine;
  void endLineStart;

  const head = text.slice(0, afterStartLine + 1);
  const tail = text.slice(endLineStart);
  return `${head}\n${blocks}\n${tail}`;
}

export function isExpired(area: AreaRecord, now: Date): boolean {
  const to = area.provenance.validTo;
  if (!to) return false;
  const d = parseLooseDate(to);
  if (!d) return false;
  return d.getTime() < now.getTime();
}

function parseLooseDate(s: string): Date | null {
  // 31 DEC 2026 / 2026-12-31 / 26DEC31
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);
  const m = s.match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/i);
  if (m) {
    const months: Record<string, number> = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
    };
    const mi = months[m[2].toUpperCase()];
    if (mi != null) return new Date(Date.UTC(Number(m[3]), mi, Number(m[1]), 23, 59, 59));
  }
  return null;
}

export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

import { toTopSkyCoord, closeRing } from "./coords";
import { formatLimits } from "./limits";
import type { AreaLabel, AreaRecord } from "./types";
import { isExpired } from "./validity";

export { isExpired } from "./validity";

export function formatLabelLine(label: AreaLabel): string {
  const latLon = toTopSkyCoord(label.lat, label.lon).split(" ");
  const text = (label.text || "").toUpperCase();
  return `LABEL:${latLon[0]}:${latLon[1]}:${text}`;
}

/**
 * Replace an existing LABEL line in a block. Never inserts a LABEL if none exists
 * (Stockholm / other unlabeled areas must stay unlabeled).
 */
export function patchLabelInBlock(block: string, label: AreaLabel): string {
  if (!/(^|\n)LABEL:/i.test(block)) return block;
  return block.replace(/(^|\n)LABEL:.*$/im, `$1${formatLabelLine(label)}`);
}

/**
 * Patch LABEL coordinates for labelEdited areas across the whole file.
 * Skips areas with no LABEL line in their block — never invents labels.
 */
export function applyLabelEdits(fileText: string, areas: AreaRecord[]): string {
  let text = fileText.replace(/\r\n/g, "\n");
  for (const area of areas) {
    if (!area.labelEdited || !area.label) continue;
    text = patchLabelForAreaInFile(text, area);
  }
  return text;
}

function patchLabelForAreaInFile(text: string, area: AreaRecord): string {
  const id = area.id.toUpperCase();
  // Prefer designator comment header //ESR… / //ESD…
  const headerRe = new RegExp(`//${id}\\b[^\\n]*\\n`, "i");
  const headerMatch = headerRe.exec(text);
  let start = headerMatch?.index ?? -1;
  if (start < 0) {
    // Fall back to AREA: line containing short name
    const areaRe = new RegExp(
      `^AREA:[^:\\n]+:\\s*${escapeRegExp(area.shortName)}\\s*$`,
      "im",
    );
    const m = areaRe.exec(text);
    if (!m || m.index == null) return text;
    start = m.index;
  }
  // Block ends at the next //ES… designator comment (not at this block's AREA: line).
  const rest = text.slice(start);
  const endRel = rest.search(/\n\/\/ES[A-Z0-9]/i);
  const block = endRel >= 0 ? rest.slice(0, endRel) : rest;
  if (!/(^|\n)LABEL:/i.test(block)) return text; // unlabeled — leave untouched
  const patched = patchLabelInBlock(block, area.label!);
  return text.slice(0, start) + patched + text.slice(start + block.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
  // Only emit LABEL when the area already has one (or newly accepted SUP with label).
  if (area.label) {
    lines.push(formatLabelLine({ ...area.label, text: labelText }));
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
        if (a.labelEdited && a.label) {
          // Patch LABEL only — never insert if the baseline block had none.
          return patchLabelInBlock(a.rawBlock, a.label).trimEnd() + "\n";
        }
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

export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

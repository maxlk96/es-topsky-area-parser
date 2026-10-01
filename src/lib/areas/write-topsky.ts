import { areaOmitsLabel } from "./classify";
import { closeRing, parseTopSkyCoordPair, toTopSkyCoord } from "./coords";
import { formatLimits } from "./limits";
import type { AreaLabel, AreaRecord } from "./types";
import { isExpired } from "./validity";

export { isExpired } from "./validity";

/** TopSky LABEL / //ES comment text: ALL CAPS, keep ÅÄÖ (sv-SE). */
export function toTopSkyName(text: string): string {
  return text
    .replace(/[<>{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("sv-SE");
}

export function formatLabelLine(label: AreaLabel): string {
  const latLon = toTopSkyCoord(label.lat, label.lon).split(" ");
  const text = toTopSkyName(label.text || "");
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
 * Update `//ESR41A OLD` comment and existing LABEL text. Never invents a LABEL line.
 */
export function patchNameInBlock(
  block: string,
  id: string,
  name: string,
  label?: AreaLabel | null,
): string {
  const idUp = id.toUpperCase();
  let out = block;
  const headerRe = new RegExp(`^(//${escapeRegExp(idUp)})(\\b[^\\n]*)`, "im");
  if (headerRe.test(out)) {
    out = out.replace(headerRe, `$1 ${name}`);
  }
  if (label && /(^|\n)LABEL:/i.test(out)) {
    out = patchLabelInBlock(out, { ...label, text: name });
  }
  return out;
}

/**
 * Patch LABEL coordinates for labelEdited areas across the whole file.
 * Skips areas with no LABEL line in their block — never invents labels.
 */
export function applyLabelEdits(fileText: string, areas: AreaRecord[]): string {
  let text = fileText.replace(/\r\n/g, "\n");
  for (const area of areas) {
    if (!area.labelEdited || !area.label) continue;
    text = patchBlockInFile(text, area, (block) =>
      patchLabelInBlock(block, area.label!),
    );
  }
  return text;
}

/**
 * Patch //ES… NAME comments and LABEL text for nameEdited areas.
 * Unlabeled areas: header/name only — never invents LABEL.
 */
export function applyNameEdits(fileText: string, areas: AreaRecord[]): string {
  let text = fileText.replace(/\r\n/g, "\n");
  for (const area of areas) {
    if (!area.nameEdited) continue;
    text = patchBlockInFile(text, area, (block) =>
      patchNameInBlock(block, area.id, area.name, area.label),
    );
  }
  return text;
}

function findAreaBlock(
  text: string,
  area: AreaRecord,
): { start: number; block: string } | null {
  const id = area.id.toUpperCase();
  const headerRe = new RegExp(`//${id}\\b[^\\n]*\\n`, "i");
  const headerMatch = headerRe.exec(text);
  let start = headerMatch?.index ?? -1;
  if (start < 0) {
    const areaRe = new RegExp(
      `^AREA:[^:\\n]+:\\s*${escapeRegExp(area.shortName)}\\s*$`,
      "im",
    );
    const m = areaRe.exec(text);
    if (!m || m.index == null) return null;
    start = m.index;
  }
  const rest = text.slice(start);
  // Stop at next //ES… designator OR tempo section markers (not "//      START…").
  const ends = [
    rest.search(/\n\/\/ES[A-Z0-9]/i),
    rest.search(/\n\/\/\s*START OF TEMPO/i),
    rest.search(/\n\/\/\s*END OF TEMPO/i),
  ].filter((n) => n >= 0);
  const endRel = ends.length ? Math.min(...ends) : -1;
  const block = endRel >= 0 ? rest.slice(0, endRel) : rest;
  return { start, block };
}

function patchBlockInFile(
  text: string,
  area: AreaRecord,
  patch: (block: string) => string,
): string {
  const found = findAreaBlock(text, area);
  if (!found) return text;
  const patched = patch(found.block);
  if (patched === found.block) return text;
  return text.slice(0, found.start) + patched + text.slice(found.start + found.block.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when Accept/AIP/redensify cleared rawBlock — full block must be rewritten on export. */
export function needsFullBlockRewrite(area: AreaRecord): boolean {
  if (area.exclusionReason) return false;
  if (!(area.category === "R" || area.category === "D")) return false;
  // Omit-label areas with an active LABEL still in rawBlock must be rewritten.
  if (
    areaOmitsLabel(area) &&
    area.rawBlock &&
    /(^|\n)(?!\/\/)LABEL:/im.test(area.rawBlock)
  ) {
    return true;
  }
  // Untouched baseline: keep rawBlock as-is (label/name patched separately).
  if (area.provenance.source === "topsky" && area.rawBlock) return false;
  // Accepted ENR/SUP, regenerated circles, or any empty-rawBlock working copy.
  return !area.rawBlock || area.provenance.source !== "topsky";
}

/**
 * Replace permanent (non-tempo) R/D blocks with accepted AIP/ENR geometry.
 * Tempo is handled by mergeTempoSection; this covers Reload-from-AIP Accepts
 * that stay in section "other".
 */
export function applyAcceptedAreaBlocks(
  fileText: string,
  areas: AreaRecord[],
): string {
  let text = fileText.replace(/\r\n/g, "\n");
  const toWrite = areas.filter(
    (a) => a.section !== "tempo" && needsFullBlockRewrite(a),
  );
  const missing: AreaRecord[] = [];

  for (const area of toWrite) {
    const found = findAreaBlock(text, area);
    // Permanent ENR section: no SUP Valid-to headers.
    const block = formatAreaBlock(area, { includeSupHeader: false }).trimEnd() + "\n";
    if (!found) {
      missing.push(area);
      continue;
    }
    text =
      text.slice(0, found.start) +
      block +
      text.slice(found.start + found.block.length);
  }

  if (missing.length) {
    const insertBlocks =
      missing
        .map((a) => formatAreaBlock(a, { includeSupHeader: false }).trimEnd())
        .join("\n\n") + "\n\n";
    const tempoMark = text.indexOf("START OF TEMPO R AND D AREAS");
    if (tempoMark >= 0) {
      const lineStart = text.lastIndexOf("\n", tempoMark) + 1;
      text = text.slice(0, lineStart) + insertBlocks + text.slice(lineStart);
    } else {
      text = text.trimEnd() + "\n\n" + insertBlocks;
    }
  }

  return text;
}

/** ESAA tempo convention: `182/2025` → `182/25`. */
export function formatSupNumberShort(supNumber: string): string {
  const m = String(supNumber).match(/(\d+)\s*[/-]\s*(\d+)/);
  if (!m) return String(supNumber).trim();
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (b >= 2000) return `${a}/${String(b).slice(-2)}`;
  if (a >= 2000) return `${b}/${String(a).slice(-2)}`;
  return `${a}/${b}`;
}

/** `// 182/25 - Valid to 31 AUG 2026` */
export function formatSupValidityLine(area: AreaRecord): string | undefined {
  const sup = area.provenance.supNumber;
  const validTo = area.provenance.validTo?.trim();
  if (!sup || !validTo) return undefined;
  return `// ${formatSupNumberShort(sup)} - Valid to ${validTo}`;
}

/** UAS stub: validity line + `// EXCLUDED. ONLY UAS (BVLOS)`. */
export function formatExcludedSupStub(area: AreaRecord): string {
  const lines: string[] = [];
  const validity = formatSupValidityLine(area);
  if (validity) lines.push(validity);
  else if (area.provenance.supNumber) {
    lines.push(`// ${formatSupNumberShort(area.provenance.supNumber)}`);
  }
  lines.push("// EXCLUDED. ONLY UAS (BVLOS)");
  lines.push("");
  return lines.join("\n");
}

/** Pull existing EXCLUDED stubs from a tempo section (preserve on rewrite). */
export function extractExcludedStubsFromTempo(tempoText: string): string[] {
  const re =
    /\/\/\s*(\d+\/\d+)\s*-\s*Valid to[^\n]*\n\/\/\s*EXCLUDED\. ONLY UAS[^\n]*/gi;
  const out: string[] = [];
  for (const m of tempoText.matchAll(re)) {
    out.push(`${m[0].replace(/\s+$/g, "")}\n`);
  }
  return out;
}

export function formatAreaBlock(
  area: AreaRecord,
  opts?: { includeSupHeader?: boolean },
): string {
  const includeSupHeader = opts?.includeSupHeader !== false;
  const lines: string[] = [];
  if (includeSupHeader) {
    const validity = formatSupValidityLine(area);
    if (validity) lines.push(validity);
    // ESAA: comment when SUP area has no AUP activation line
    if (
      area.provenance.supNumber &&
      (area.activation?.type === "MANUAL" ||
        area.activation?.type === "NONE" ||
        !area.activation)
    ) {
      lines.push("// NO AUP ACTIVATION");
    }
  }
  const designator = area.id.toUpperCase();
  const labelText = toTopSkyName(area.label?.text || area.name);
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
  if (areaOmitsLabel(area)) {
    // Explicit marker so ops don't re-add a LABEL on these blocks (e.g. ESR94).
    lines.push("// NO LABEL");
    // ESAA style: keep a commented LABEL at circle centre for reference only.
    const ref =
      area.boundCircle != null
        ? {
            lat: area.boundCircle.lat,
            lon: area.boundCircle.lon,
            text: labelText,
          }
        : area.label
          ? { ...area.label, text: labelText }
          : null;
    if (ref) lines.push(`//${formatLabelLine(ref)}`);
  } else if (area.label) {
    // Only emit LABEL when the area already has one (or newly accepted SUP with label).
    lines.push(formatLabelLine({ ...area.label, text: labelText }));
  }
  if (area.limits) {
    lines.push(formatLimits(area.limits[0], area.limits[1]));
  }
  if (area.boundCircle) {
    const c = toTopSkyCoord(area.boundCircle.lat, area.boundCircle.lon).split(" ");
    const r = Number(area.boundCircle.radiusNm.toFixed(2));
    lines.push(`BOUND:C:${c[0]}:${c[1]}:${r}`);
  }
  const ring = closeRing(area.coordinates);
  for (const [lon, lat] of ring) {
    lines.push(toTopSkyCoord(lat, lon));
  }
  lines.push("");
  return lines.join("\n");
}

/** Group rewritten SUP areas so one `// NNN/YY - Valid to` heads the group. */
export function formatTempoAreaBlocks(areas: AreaRecord[]): string {
  const groups = new Map<string, AreaRecord[]>();
  const order: string[] = [];
  for (const a of areas) {
    const key = a.provenance.supNumber
      ? `sup:${formatSupNumberShort(a.provenance.supNumber)}`
      : `id:${a.id.toUpperCase()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(a);
  }
  const chunks: string[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    const first = group[0]!;
    if (first.provenance.supNumber) {
      const validity = formatSupValidityLine(first);
      if (validity) chunks.push(validity);
      const noAup = group.every(
        (a) =>
          a.activation?.type === "MANUAL" ||
          a.activation?.type === "NONE" ||
          !a.activation,
      );
      if (noAup) chunks.push("// NO AUP ACTIVATION");
      if (validity || noAup) chunks.push("");
    }
    for (const a of group) {
      chunks.push(formatAreaBlock(a, { includeSupHeader: false }).trimEnd());
      chunks.push("");
    }
  }
  return chunks.join("\n");
}

/** Rewrite a space-form coord or LABEL line that still has seconds=60 / unpadded Ndd. */
function sanitizeCoordBearingLine(line: string): string {
  const trimmed = line.trim();
  if (/^LABEL:/i.test(trimmed)) {
    const parts = trimmed.split(":");
    if (parts.length >= 4) {
      const text = toTopSkyName(parts.slice(3).join(":"));
      const pair = parseTopSkyCoordPair(`${parts[1]} ${parts[2]}`);
      if (pair) {
        const [latTok, lonTok] = toTopSkyCoord(pair.lat, pair.lon).split(" ");
        return `LABEL:${latTok}:${lonTok}:${text}`;
      }
      // Coords odd but text junk (e.g. NYN<äSHAMN) — still clean the name.
      if (text !== parts.slice(3).join(":")) {
        return `LABEL:${parts[1]}:${parts[2]}:${text}`;
      }
    }
    return line;
  }
  // Plain vertex: Nddd.mm.ss.mmm Eddd.mm.ss.mmm
  if (/^[NS]\d/i.test(trimmed) && /\s+[EW]\d/i.test(trimmed)) {
    const pair = parseTopSkyCoordPair(trimmed);
    if (pair) return toTopSkyCoord(pair.lat, pair.lon);
  }
  // BOUND:C:lat:lon:radius — fix centre tokens only
  if (/^BOUND:C:/i.test(trimmed)) {
    const parts = trimmed.split(":");
    if (parts.length >= 5) {
      const pair = parseTopSkyCoordPair(`${parts[2]} ${parts[3]}`);
      if (pair) {
        const [latTok, lonTok] = toTopSkyCoord(pair.lat, pair.lon).split(" ");
        return `BOUND:C:${latTok}:${lonTok}:${parts.slice(4).join(":")}`;
      }
    }
  }
  return line;
}

/**
 * Final pass before download: trim EOL spaces, drop whitespace-only lines,
 * and rewrite any LABEL/coord lines that still contain seconds=60 (legacy).
 */
export function sanitizeExportedTopSkyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.replace(/[ \t]+$/g, "");
    if (line.length === 0) {
      // Keep true blank separators; drop space-only lines.
      if (raw.length === 0) out.push("");
      continue;
    }
    line = sanitizeCoordBearingLine(line);
    out.push(line);
  }
  // Collapse runs of >2 blank lines
  const collapsed: string[] = [];
  let blanks = 0;
  for (const line of out) {
    if (line === "") {
      blanks++;
      if (blanks <= 2) collapsed.push(line);
    } else {
      blanks = 0;
      collapsed.push(line);
    }
  }
  return collapsed.join("\n").replace(/\n*$/, "\n");
}

const TEMPO_START = "//      START OF TEMPO R AND D AREAS";
const TEMPO_END = "//      END OF TEMPO R AND D AREAS";

/** Surgical replace of tempo section; remove expired; insert accepted new blocks. */
export function mergeTempoSection(
  originalText: string,
  workingAreas: AreaRecord[],
  opts?: { now?: Date; excludedStubs?: AreaRecord[] },
): string {
  const now = opts?.now ?? new Date();
  const text = originalText.replace(/\r\n/g, "\n");
  const startIdx = text.indexOf("START OF TEMPO R AND D AREAS");
  const endIdx = text.indexOf("END OF TEMPO R AND D AREAS");

  const tempoAreas = workingAreas.filter(
    (a) =>
      a.exclusionReason !== "uas_only" &&
      (a.section === "tempo" ||
        a.provenance.source === "sup" ||
        a.provenance.source === "notam" ||
        a.provenance.source === "topsky") &&
      (a.category === "R" || a.category === "D"),
  );
  const inTempo = workingAreas.filter(
    (a) =>
      a.section === "tempo" &&
      !isExpired(a, now) &&
      a.exclusionReason !== "uas_only",
  );
  const activeTempo = (
    inTempo.length ? inTempo : tempoAreas.filter((a) => !isExpired(a, now) && a.mapDefaultVisible)
  );

  const preserved: AreaRecord[] = [];
  const rewritten: AreaRecord[] = [];
  for (const a of activeTempo) {
    if (!needsFullBlockRewrite(a) && a.rawBlock) preserved.push(a);
    else rewritten.push(a);
  }

  const preservedBlocks = preserved
    .map((a) => {
      let block = a.rawBlock;
      if (a.nameEdited) {
        block = patchNameInBlock(block, a.id, a.name, a.label);
      } else if (a.labelEdited && a.label) {
        block = patchLabelInBlock(block, a.label);
      }
      return block.trimEnd() + "\n";
    })
    .join("\n");

  const rewrittenBlocks = formatTempoAreaBlocks(rewritten);

  // EXCLUDED stubs: new from scan/diffs + untouched stubs from original tempo.
  const excludedFromWork = [
    ...workingAreas.filter((a) => a.exclusionReason === "uas_only"),
    ...(opts?.excludedStubs ?? []),
  ];

  let originalTempo = "";
  if (startIdx >= 0 && endIdx > startIdx) {
    originalTempo = text.slice(startIdx, endIdx);
  }
  const preservedExcluded = extractExcludedStubsFromTempo(originalTempo).filter(
    (stub) => {
      const m = stub.match(/\/\/\s*(\d+\/\d+)\s*-/i);
      if (!m) return true;
      const key = m[1];
      // Replaced by a newly emitted excluded stub for the same SUP.
      const hasNew = excludedFromWork.some(
        (a) =>
          a.provenance.supNumber &&
          formatSupNumberShort(a.provenance.supNumber) === key,
      );
      if (hasNew) return false;
      // SUP now has active areas — drop the old EXCLUDED stub.
      const becameActive = activeTempo.some(
        (a) =>
          a.provenance.supNumber &&
          formatSupNumberShort(a.provenance.supNumber) === key,
      );
      return !becameActive;
    },
  );

  // Dedupe new excluded stubs by SUP short number
  const seenEx = new Set<string>();
  const newExcludedBlocks: string[] = [];
  for (const a of excludedFromWork) {
    const key = a.provenance.supNumber
      ? formatSupNumberShort(a.provenance.supNumber)
      : a.id;
    if (seenEx.has(key)) continue;
    seenEx.add(key);
    newExcludedBlocks.push(formatExcludedSupStub(a).trimEnd() + "\n");
  }

  const blocks = [
    preservedBlocks,
    rewrittenBlocks,
    ...newExcludedBlocks,
    ...preservedExcluded.map((s) => s.trimEnd() + "\n"),
  ]
    .filter((b) => b && b.trim())
    .join("\n");

  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    return sanitizeExportedTopSkyText(
      `${text.trimEnd()}\n\n${TEMPO_START}\n${blocks}\n${TEMPO_END}\n`,
    );
  }

  const afterStartLine = text.indexOf("\n", startIdx);
  const endLineStart = text.lastIndexOf("\n", endIdx) + 1;
  const head = text.slice(0, afterStartLine + 1);
  const tail = text.slice(endLineStart);
  return sanitizeExportedTopSkyText(`${head}\n${blocks}\n${tail}`);
}

export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

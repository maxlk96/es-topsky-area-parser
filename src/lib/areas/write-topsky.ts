import {
  formatSupNumberShort,
  supNumberKey,
} from "@/lib/aip/sup-catalogue";
import { isStaleExcludedStub, staleTempoReason } from "./stale-tempo";
import {
  shouldEmitNoAupActivationComment,
  stripTempoGroupHeaders,
} from "./activation";
import { areaOmitsLabel, omitLabelDesignators, shortFromDesignator } from "./classify";
import { closeRing, parseTopSkyCoordPair, toTopSkyCoord } from "./coords";
import { formatLimits } from "./limits";
import { designatorOrderKey, normalizeDesignator } from "./names";
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
  // Stop at next area designator (//ESR… or PCA //A1), section //// rules, or
  // named section titles. Never swallow TEMPO / DANGER / PCA / SOARING banners.
  const ends = [
    rest.search(/\n\/\/ES[A-Z0-9]/i),
    rest.search(/\n\/\/[A-Z]+\d+[A-Z]?\b/i), // PCA //A1 / //A11
    rest.search(/\n\/{10,}/), // ////… section rule
    rest.search(/\n\/\/\s*START OF TEMPO/i),
    rest.search(/\n\/\/\s*END OF TEMPO/i),
    rest.search(/\n\/\/\s+MILITARY EXERCISE\b/i),
    rest.search(/\n\/\/\s+SOARING SECTORS\b/i),
    rest.search(/\n\/\/\s+DANGER AREAS\b/i),
  ].filter((n) => n >= 0);
  const endRel = ends.length ? Math.min(...ends) : -1;
  const raw = endRel >= 0 ? rest.slice(0, endRel) : rest;
  return { start, block: stripTrailingSectionBannerLines(raw) };
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

/** True when Accept/AIP/PCA/redensify cleared rawBlock — full block must be rewritten on export. */
export function needsFullBlockRewrite(area: AreaRecord): boolean {
  if (area.exclusionReason) return false;
  const rewritable =
    area.category === "R" ||
    area.category === "D" ||
    area.category === "PCA";
  if (!rewritable) return false;
  // Max: R94/R102/R127 — always rewrite so `// NO LABEL` is emitted (no active LABEL).
  if (areaOmitsLabel(area)) return true;
  // Untouched baseline: keep rawBlock as-is (label/name patched separately).
  if (area.provenance.source === "topsky" && area.rawBlock) return false;
  // Accepted ENR/SUP/PCA, regenerated circles, or any empty-rawBlock working copy.
  return !area.rawBlock || area.provenance.source !== "topsky";
}

/**
 * Ensure known omit-label designators (incl. fully commented UAV stubs like ESR127)
 * have `// NO LABEL` and no active LABEL line in the exported file.
 */
export function ensureOmitLabelMarkers(fileText: string): string {
  let text = fileText.replace(/\r\n/g, "\n");
  for (const id of omitLabelDesignators()) {
    const shortName = shortFromDesignator(id);
    const found = findAreaBlock(text, {
      id,
      shortName,
    } as AreaRecord);
    if (!found) continue;
    let block = found.block;
    block = block.replace(/(^|\n)(?!\/\/)LABEL:/gim, "$1//LABEL:");
    if (/\/\/\s*NO LABEL\b/i.test(block)) {
      if (block !== found.block) {
        text =
          text.slice(0, found.start) +
          block +
          text.slice(found.start + found.block.length);
      }
      continue;
    }
    if (/^(?:\/\/)?AREA:/im.test(block)) {
      block = block.replace(/^((?:\/\/)?AREA:[^\n]*\n)/im, "$1// NO LABEL\n");
    } else {
      block = block.replace(/^(\/\/[^\n]*\n)/, "$1// NO LABEL\n");
    }
    text =
      text.slice(0, found.start) +
      block +
      text.slice(found.start + found.block.length);
  }
  return text;
}

/**
 * Insert position for a new permanent R/D block: keep AIP/ESAA section order.
 * Never place before START OF TEMPO when the permanent section lives after END OF TEMPO
 * (live ESAA file has TEMPO first — that bug floated ESR94 to the top of the file).
 */
export function findPermanentRdInsertIndex(
  text: string,
  area: AreaRecord,
): number {
  const key = designatorOrderKey(area.id);
  const startTempo = findSectionBannerSpan(
    text,
    "START OF TEMPO R AND D AREAS",
  );
  const endTempo = findSectionBannerSpan(text, "END OF TEMPO R AND D AREAS");
  const pca = findSectionBannerSpan(text, "MILITARY EXERCISE AREAS (PCA)");

  const zones: [number, number][] = [];
  const tempoFirst =
    !!startTempo && !!endTempo && endTempo.start > startTempo.end;
  if (tempoFirst) {
    // ESAA live layout: TEMPO → permanent R/D → PCA
    zones.push([endTempo!.end, pca?.start ?? text.length]);
  } else if (startTempo) {
    // Older / test layout: permanent before TEMPO
    zones.push([0, startTempo.start]);
    if (endTempo) zones.push([endTempo.end, pca?.start ?? text.length]);
  } else if (endTempo) {
    zones.push([endTempo.end, pca?.start ?? text.length]);
  } else {
    zones.push([0, pca?.start ?? text.length]);
  }

  let insertAt = zones[0]?.[0] ?? 0;
  let sawPredecessor = false;

  for (const [zs, ze] of zones) {
    const slice = text.slice(zs, ze);
    const re = /\/\/(ES[RD]\d+[A-Z]*)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice))) {
      const otherId = normalizeDesignator(m[1]!);
      const otherKey = designatorOrderKey(otherId);
      const abs = zs + m.index;
      if (otherKey < key) {
        const found = findAreaBlock(text, {
          id: otherId,
          shortName: shortFromDesignator(otherId),
        } as AreaRecord);
        if (found) {
          insertAt = found.start + found.block.length;
          // Prefer sitting after trailing blank lines of the predecessor block.
          while (
            insertAt < text.length &&
            (text[insertAt] === "\n" || text[insertAt] === "\r")
          ) {
            insertAt++;
          }
          sawPredecessor = true;
        }
      } else if (otherKey > key) {
        if (!sawPredecessor) insertAt = abs;
        return insertAt;
      }
    }
  }

  if (!sawPredecessor && tempoFirst && endTempo) {
    insertAt = endTempo.end;
  }
  // Guard: never insert into/before the leading TEMPO section on ESAA layout.
  if (tempoFirst && startTempo && insertAt <= startTempo.start) {
    insertAt = endTempo!.end;
  }
  return insertAt;
}

/**
 * Replace permanent (non-tempo) R/D/PCA blocks with accepted AIP/echarts geometry.
 * Tempo is handled by mergeTempoSection; this covers Reload-from-AIP / PCA Accepts
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
    // Permanent / PCA section: no SUP Valid-to headers.
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
    const pcaMissing = missing.filter((a) => a.category === "PCA");
    const otherMissing = missing.filter((a) => a.category !== "PCA");

    if (pcaMissing.length) {
      const insertBlocks =
        pcaMissing
          .map((a) => formatAreaBlock(a, { includeSupHeader: false }).trimEnd())
          .join("\n\n") + "\n\n";
      const pcaBanner = findSectionBannerSpan(
        text,
        "MILITARY EXERCISE AREAS (PCA)",
      );
      if (pcaBanner) {
        // After the full PCA banner — never mid-banner.
        text =
          text.slice(0, pcaBanner.end) +
          insertBlocks +
          text.slice(pcaBanner.end);
      } else {
        text = text.trimEnd() + "\n\n" + insertBlocks;
      }
    }

    if (otherMissing.length) {
      // Insert one-by-one in designator order into the permanent R/D section
      // (after END OF TEMPO on live ESAA — not before START OF TEMPO).
      const sorted = [...otherMissing].sort((a, b) =>
        designatorOrderKey(a.id).localeCompare(designatorOrderKey(b.id)),
      );
      for (const area of sorted) {
        const block =
          formatAreaBlock(area, { includeSupHeader: false }).trimEnd() +
          "\n\n";
        const at = findPermanentRdInsertIndex(text, area);
        text = text.slice(0, at) + block + text.slice(at);
      }
    }
  }

  return ensureOmitLabelMarkers(text);
}

export { formatSupNumberShort } from "@/lib/aip/sup-catalogue";

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
    // ESAA: only when there is no ACTIVE: line at all (not ACTIVE:1 / schedule).
    if (area.provenance.supNumber && shouldEmitNoAupActivationComment(area)) {
      lines.push("// NO AUP ACTIVATION");
    }
  }
  const designator = area.id.toUpperCase();
  const labelText = toTopSkyName(area.label?.text || area.name);
  // PCA headers in ESAA are bare `//A1` (name lives on LABEL).
  if (area.category === "PCA") {
    lines.push(`//${designator}`);
  } else {
    lines.push(`//${designator} ${labelText}`);
  }
  // Two leading spaces for R/D AMS sort; one space for PCA.
  const pad =
    area.category === "R" || area.category === "D" ? "  " : area.category === "PCA" ? " " : "";
  lines.push(`AREA:${area.areaTypeCode}:${pad}${area.shortName}`);
  if (area.noaiw) lines.push("NOAIW");
  // Preserve extra ops flags (PCA often has NOAPW / NOSAP).
  for (const d of area.directives || []) {
    const t = d.trim().toUpperCase();
    if (!t || t === "NOAIW") continue;
    if (/^(NOAPW|NOSAP|NOMSAW|NOCLAMRAM|NOTCT)\b/.test(t)) {
      lines.push(t.split(/\s+/)[0]!);
    }
  }
  if (area.activation?.type === "AUP" && area.activation.key) {
    lines.push(`ACTIVE:AUP:${area.activation.key}`);
  } else if (area.activation?.type === "AUP_GROUP" && area.activation.key) {
    lines.push(`ACTIVE:AUP_GROUP:${area.activation.key}`);
  } else if (area.activation?.type === "ALWAYS") {
    lines.push("ACTIVE:1");
  } else if (area.activation?.type === "SCHEDULE" && area.activation.raw?.length) {
    for (const r of area.activation.raw) {
      if (/^ACTIVE:/i.test(r.trim())) lines.push(r.trim());
    }
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

/** Compare SUP numbers newest-first (year, then serial). 2-digit years → 20xx. */
function compareSupNumberDesc(a: string, b: string): number {
  const norm = (s: string): [number, number] => {
    const [y, n] = supNumberKey(s);
    return [y > 0 && y < 100 ? 2000 + y : y, n];
  };
  const [ay, an] = norm(a);
  const [by, bn] = norm(b);
  if (by !== ay) return by - ay;
  return bn - an;
}

/**
 * Emit tempo blocks grouped by SUP, ordered by SUP number (newest first).
 * One `// NNN/YY - Valid to` (+ optional `// NO AUP ACTIVATION`) heads each group.
 */
export function formatTempoAreaBlocks(areas: AreaRecord[]): string {
  const groups = new Map<string, AreaRecord[]>();
  for (const a of areas) {
    const key = a.provenance.supNumber
      ? `sup:${formatSupNumberShort(a.provenance.supNumber)}`
      : `id:${a.id.toUpperCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const order = [...groups.keys()].sort((ka, kb) => {
    const sa = ka.startsWith("sup:") ? ka.slice(4) : "";
    const sb = kb.startsWith("sup:") ? kb.slice(4) : "";
    if (sa && sb) return compareSupNumberDesc(sa, sb);
    if (sa) return -1;
    if (sb) return 1;
    return ka.localeCompare(kb);
  });
  const chunks: string[] = [];
  for (const key of order) {
    const group = groups.get(key)!;
    const first = group[0]!;
    if (first.provenance.supNumber) {
      const validity = formatSupValidityLine(first);
      if (validity) chunks.push(validity);
      // Group comment only if every area lacks any ACTIVE: line (manual).
      // ACTIVE:1 / schedule / AUP → never emit // NO AUP ACTIVATION.
      const noAup = group.every((a) => shouldEmitNoAupActivationComment(a));
      if (noAup) chunks.push("// NO AUP ACTIVATION");
      if (validity || noAup) chunks.push("");
    }
    for (const a of group) {
      if (!needsFullBlockRewrite(a) && a.rawBlock) {
        let block = stripTrailingSectionBannerLines(
          stripTempoGroupHeaders(a.rawBlock),
        );
        if (a.nameEdited) {
          block = patchNameInBlock(block, a.id, a.name, a.label);
        } else if (a.labelEdited && a.label) {
          block = patchLabelInBlock(block, a.label);
        }
        // Activation toggles clear rawBlock; if raw still present, sync ACTIVE lines.
        block = syncActivationInBlock(block, a);
        chunks.push(block.trimEnd());
      } else {
        chunks.push(formatAreaBlock(a, { includeSupHeader: false }).trimEnd());
      }
      chunks.push("");
    }
  }
  return chunks.join("\n");
}

/** Keep ACTIVE:AUP lines in a preserved rawBlock aligned with working activation. */
function syncActivationInBlock(block: string, area: AreaRecord): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const withoutActive = lines.filter(
    (l) => !/^ACTIVE:(AUP|AUP_GROUP|1)\b/i.test(l.trim()),
  );
  const insertAt = withoutActive.findIndex((l) => /^AREA:/i.test(l.trim()));
  if (insertAt < 0) return block;
  const activeLines: string[] = [];
  if (area.activation?.type === "AUP" && area.activation.key) {
    activeLines.push(`ACTIVE:AUP:${area.activation.key}`);
  } else if (area.activation?.type === "AUP_GROUP" && area.activation.key) {
    activeLines.push(`ACTIVE:AUP_GROUP:${area.activation.key}`);
  } else if (area.activation?.type === "ALWAYS") {
    activeLines.push("ACTIVE:1");
  }
  // MANUAL / NONE → no ACTIVE line (paired with // NO AUP ACTIVATION at group head)
  let pos = insertAt + 1;
  // Keep NOAIW immediately after AREA when present
  if (pos < withoutActive.length && /^NOAIW\b/i.test(withoutActive[pos]!.trim())) {
    pos += 1;
  }
  withoutActive.splice(pos, 0, ...activeLines);
  return withoutActive.join("\n");
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

export const TEMPO_START_BANNER = `/////////////////////////////////////////////////////////////////////
//
//      START OF TEMPO R AND D AREAS
//
/////////////////////////////////////////////////////////////////////`;

export const TEMPO_END_BANNER = `/////////////////////////////////////////////////////////////////////
//
//      END OF TEMPO R AND D AREAS
//
/////////////////////////////////////////////////////////////////////`;

/**
 * True for lines that form ESAA section banners (//// rules, blank `//`,
 * indented titles like `//      START OF TEMPO…` / SOARING / DANGER / PCA).
 * Not area/SUP body comments.
 */
export function isSectionBannerLine(line: string): boolean {
  const t = line.replace(/\s+$/g, "");
  if (!t.startsWith("//")) return false;
  if (/^\/\/\s*ES[A-Z0-9]/i.test(t)) return false;
  if (/^\/\/\s*A\d/i.test(t)) return false;
  if (/^\/\/\s*\d+\s*\/\s*\d+/i.test(t)) return false;
  if (/^\/\/\s*EXCLUDED\b/i.test(t)) return false;
  if (/^\/\/\s*NO AUP\b/i.test(t)) return false;
  if (/^\/\/\s*NO LABEL\b/i.test(t)) return false;
  if (/^\/\/\s*LABEL:/i.test(t)) return false;
  return (
    /^\/{10,}/.test(t) ||
    /^\/\/\s*$/.test(t) ||
    /^\/\/\s{2,}\S/.test(t) ||
    /^\/\/\s+(START|END)\s+OF\b/i.test(t) ||
    /^\/\/\s+MILITARY EXERCISE\b/i.test(t) ||
    /^\/\/\s+SOARING SECTORS\b/i.test(t) ||
    /^\/\/\s+DANGER AREAS\b/i.test(t)
  );
}

/** Drop trailing //// / // banner crumbs that were swallowed into an area block. */
export function stripTrailingSectionBannerLines(block: string): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  let end = lines.length;
  while (end > 0 && isSectionBannerLine(lines[end - 1]!)) end -= 1;
  if (end === lines.length) return block.replace(/\r\n/g, "\n");
  return lines.slice(0, end).join("\n");
}

/**
 * Span of the full contiguous comment banner containing `markerSubstring`
 * (e.g. START OF TEMPO…), including //// rules above and below.
 * `end` is the index after the banner’s last newline (or EOF).
 */
export function findSectionBannerSpan(
  text: string,
  markerSubstring: string,
): { start: number; end: number } | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const markerIdx = normalized.indexOf(markerSubstring);
  if (markerIdx < 0) return null;

  const lineStarts: number[] = [0];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === "\n") lineStarts.push(i + 1);
  }
  let markerLine = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i]! <= markerIdx) markerLine = i;
    else break;
  }

  const lines = normalized.split("\n");
  let lo = markerLine;
  let hi = markerLine;
  while (lo > 0 && isSectionBannerLine(lines[lo - 1]!)) lo -= 1;
  while (hi + 1 < lines.length && isSectionBannerLine(lines[hi + 1]!)) hi += 1;

  const start = lineStarts[lo]!;
  const end =
    hi + 1 < lineStarts.length ? lineStarts[hi + 1]! : normalized.length;
  return { start, end };
}

function supKeyFromExcludedStub(stub: string): string | undefined {
  return stub.match(/\/\/\s*(\d+\/\d+)\s*-/i)?.[1];
}

/**
 * Build tempo body: active areas + EXCLUDED stubs interleaved by SUP number
 * (newest first) — not bunched included-then-excluded.
 */
export function formatTempoSectionBody(
  activeTempo: AreaRecord[],
  excludedBlocks: { supKey: string; text: string }[],
): string {
  type Entry = { sortKey: string; text: string };
  const entries: Entry[] = [];

  // Active groups → one entry each (formatTempoAreaBlocks already sorts).
  const activeText = formatTempoAreaBlocks(activeTempo);
  if (activeText.trim()) {
    // Split back into per-SUP chunks on Valid-to headers for interleave.
    const parts = activeText.split(/(?=^\/\/\s*\d+\/\d+\s*-\s*Valid to)/m);
    for (const part of parts) {
      const trimmed = part.trimEnd();
      if (!trimmed) continue;
      const m = trimmed.match(/^\/\/\s*(\d+\/\d+)\s*-/i);
      entries.push({
        sortKey: m?.[1] || `~${entries.length}`,
        text: trimmed + "\n",
      });
    }
  }

  for (const ex of excludedBlocks) {
    entries.push({
      sortKey: ex.supKey || `~ex${entries.length}`,
      text: ex.text.trimEnd() + "\n",
    });
  }

  entries.sort((a, b) => {
    const aNum = /^\d+\//.test(a.sortKey);
    const bNum = /^\d+\//.test(b.sortKey);
    if (aNum && bNum) return compareSupNumberDesc(a.sortKey, b.sortKey);
    if (aNum) return -1;
    if (bNum) return 1;
    return a.sortKey.localeCompare(b.sortKey);
  });

  return entries
    .map((e) => e.text)
    .filter((t) => t.trim())
    .join("\n");
}

/**
 * Surgical replace of tempo section; remove expired / AMDT-missing SUP areas;
 * insert accepted new blocks.
 */
export function mergeTempoSection(
  originalText: string,
  workingAreas: AreaRecord[],
  opts?: {
    now?: Date;
    excludedStubs?: AreaRecord[];
    /** When set, drop tempo SUPs absent from the selected AMDT catalogue. */
    catalogueKeys?: Set<string> | null;
  },
): string {
  const now = opts?.now ?? new Date();
  const catalogueKeys = opts?.catalogueKeys ?? null;
  const text = originalText.replace(/\r\n/g, "\n");
  const startBanner = findSectionBannerSpan(
    text,
    "START OF TEMPO R AND D AREAS",
  );
  const endBanner = findSectionBannerSpan(text, "END OF TEMPO R AND D AREAS");

  const dropStale = (a: AreaRecord) =>
    !!staleTempoReason(a, { now, catalogueKeys });

  const tempoAreas = workingAreas.filter(
    (a) =>
      a.exclusionReason !== "uas_only" &&
      !dropStale(a) &&
      (a.section === "tempo" ||
        a.provenance.source === "sup" ||
        a.provenance.source === "notam" ||
        a.provenance.source === "topsky") &&
      (a.category === "R" || a.category === "D"),
  );
  const inTempo = workingAreas.filter(
    (a) =>
      a.section === "tempo" &&
      !dropStale(a) &&
      a.exclusionReason !== "uas_only",
  );
  const activeTempo = inTempo.length
    ? inTempo
    : tempoAreas.filter((a) => a.mapDefaultVisible);

  // EXCLUDED stubs: new from scan/diffs + untouched stubs from original tempo.
  const excludedFromWork = [
    ...workingAreas.filter((a) => a.exclusionReason === "uas_only"),
    ...(opts?.excludedStubs ?? []),
  ];

  let originalTempo = "";
  if (startBanner && endBanner && endBanner.start > startBanner.end) {
    originalTempo = text.slice(startBanner.end, endBanner.start);
  } else if (startBanner && endBanner) {
    originalTempo = text.slice(startBanner.start, endBanner.end);
  }

  const preservedExcluded = extractExcludedStubsFromTempo(originalTempo).filter(
    (stub) => {
      if (isStaleExcludedStub(stub, { now, catalogueKeys })) return false;
      const key = supKeyFromExcludedStub(stub);
      if (!key) return true;
      const hasNew = excludedFromWork.some(
        (a) =>
          a.provenance.supNumber &&
          formatSupNumberShort(a.provenance.supNumber) === key,
      );
      if (hasNew) return false;
      const becameActive = activeTempo.some(
        (a) =>
          a.provenance.supNumber &&
          formatSupNumberShort(a.provenance.supNumber) === key,
      );
      return !becameActive;
    },
  );

  // Drop new EXCLUDED stubs for gone/expired SUPs too.
  const excludedFromWorkFresh = excludedFromWork.filter(
    (a) => !staleTempoReason(a, { now, catalogueKeys }),
  );

  const seenEx = new Set<string>();
  const excludedBlocks: { supKey: string; text: string }[] = [];
  for (const a of excludedFromWorkFresh) {
    const key = a.provenance.supNumber
      ? formatSupNumberShort(a.provenance.supNumber)
      : a.id;
    if (seenEx.has(key)) continue;
    seenEx.add(key);
    excludedBlocks.push({
      supKey: key,
      text: formatExcludedSupStub(a).trimEnd() + "\n",
    });
  }
  for (const stub of preservedExcluded) {
    const key = supKeyFromExcludedStub(stub) || stub.slice(0, 40);
    if (seenEx.has(key)) continue;
    seenEx.add(key);
    excludedBlocks.push({
      supKey: key,
      text: stub.trimEnd() + "\n",
    });
  }

  const blocks = formatTempoSectionBody(activeTempo, excludedBlocks);

  if (!startBanner || !endBanner || endBanner.start < startBanner.end) {
    return sanitizeExportedTopSkyText(
      `${text.trimEnd()}\n\n${TEMPO_START_BANNER}\n\n${blocks}\n${TEMPO_END_BANNER}\n`,
    );
  }

  // Keep each banner as one contiguous block; only rewrite the interior.
  const head = text.slice(0, startBanner.end);
  const tail = text.slice(endBanner.start);
  return sanitizeExportedTopSkyText(`${head}\n${blocks}\n${tail}`);
}

export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

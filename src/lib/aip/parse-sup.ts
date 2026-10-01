import centroid from "@turf/centroid";
import { polygon } from "@turf/helpers";
import {
  inferAreaTypeFromRemarks,
  isUasOnlyText,
  shortFromDesignator,
} from "@/lib/areas/classify";
import {
  closeRing,
  densifyCircle,
  defaultSpacingForRadius,
  parseCompactCoord,
} from "@/lib/areas/coords";
import { parseAipVerticalToken } from "@/lib/areas/limits";
import { isDesignatorOnlyName } from "@/lib/areas/names";
import type { AreaRecord } from "@/lib/areas/types";
import { parseValidityWindow } from "@/lib/areas/validity";
import {
  FIR_BORDER_EXCLUSION,
  hasFirBorderLateralLimits,
} from "@/lib/aip/fir-border";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|div|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n");
}

type AreaSection = {
  id: string;
  name: string;
  chunk: string;
  score: number;
};

/**
 * Split a SUP body into per-designator geometry sections.
 * Title lines that only name areas (no coords) are skipped; the later
 * "ESR794 FAGERSANNA … coords …" blocks are kept. Prevents merging every
 * polygon in a multi-area SUP into one self-intersecting fill.
 */
/** Reject words that look like AIP table chrome, not place names. */
function looksLikePlaceName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false;
  if (/^(and|och|the|area|areas|temporary|restricted|danger|vertical|limit|limits|hours|tider|from|to|gnd|sfc|unl|ams|ft|fl)$/i.test(n)) {
    return false;
  }
  if (/^\d+$/.test(n)) return false;
  return true;
}

/** Best-effort AIP name near a designator (title / geometry header). */
export function extractNameNearDesignator(text: string, id: string): string | undefined {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    // TEMPORARY RESTRICTED AREA - ESR534 BRUNNA
    new RegExp(
      `(?:TEMPORARY\\s+)?(?:RESTRICTED|DANGER)\\s+AREA\\s*[-–:]?\\s*${esc}\\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9][A-Za-zÅÄÖåäö0-9 /-]{0,40})`,
      "i",
    ),
    // ESR534 BRUNNA (geometry header)
    new RegExp(
      `\\b${esc}\\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9][A-Za-zÅÄÖåäö0-9/-]{0,40})(?=[\\s.,;:]|$)`,
      "i",
    ),
    // Brunna (ESR534) / BRUNNA, ESR534
    new RegExp(
      `([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9/-]{1,40})\\s*[(,]\\s*${esc}\\b`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let name = m[1].trim().replace(/\s+(and|och)$/i, "").trim();
    // Truncate at bilingual slash leftovers: "Brunna / Temporary"
    name = name.split(/\s*\/\s*/)[0]?.trim() || name;
    if (looksLikePlaceName(name) && !isDesignatorOnlyName(name, shortFromDesignator(id), id)) {
      return name;
    }
  }
  return undefined;
}

export function extractAreaSections(text: string): AreaSection[] {
  // No trailing \b — in JS, Å/Ä/Ö are non-word chars so \b would cut "ORNÖ" to "ORN".
  const re =
    /\b(ES[RD]\d{2,4}[A-Z]?)\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9/-]{1,40})(?=[\s.,;:]|$)/gi;
  const hits = [...text.matchAll(re)];
  const found: AreaSection[] = [];
  for (let i = 0; i < hits.length; i++) {
    const id = hits[i][1].toUpperCase();
    let name = hits[i][2].trim();
    // Drop trailing "and" / "och" leftovers from bilingual titles
    name = name.replace(/\s+(and|och)$/i, "").trim();
    if (!looksLikePlaceName(name)) continue;
    const start = hits[i].index ?? 0;
    const end = i + 1 < hits.length ? (hits[i + 1].index ?? text.length) : text.length;
    const chunk = text.slice(start, end);
    const coordCount = [
      ...chunk.matchAll(/(\d{6,7}(?:\.\d+)?[NS]\s+\d{7,8}(?:\.\d+)?[EW])/gi),
    ].length;
    const hasCircle = /circle with radius/i.test(chunk);
    if (coordCount < 3 && !hasCircle) continue;
    // Prefer a richer name from the full document when the local token is weak
    const better = extractNameNearDesignator(text, id);
    if (better && better.length > name.length) name = better;
    found.push({
      id,
      name,
      chunk,
      score: coordCount + (hasCircle ? 10 : 0),
    });
  }
  const byId = new Map<string, AreaSection>();
  for (const f of found) {
    const prev = byId.get(f.id);
    if (!prev || f.score > prev.score) byId.set(f.id, f);
  }
  return [...byId.values()];
}

function parseCoordsFromChunk(chunk: string): [number, number][] {
  const tokens = [
    ...chunk.matchAll(/(\d{6,7}(?:\.\d+)?[NS]\s+\d{7,8}(?:\.\d+)?[EW])/gi),
  ].map((m) => m[1]);
  const coordinates: [number, number][] = [];
  for (const tok of tokens) {
    const c = parseCompactCoord(tok.replace(/\s+/g, " "));
    if (c) coordinates.push([c.lon, c.lat]);
  }
  return closeRing(coordinates);
}

function parseCircleFromChunk(chunk: string): AreaRecord["boundCircle"] {
  const circle = chunk.match(
    /circle with radius\s+([\d.]+)\s*NM\s+centr(?:ed|ered)\s+on\s+(\d{6,7}[NS])\s+(\d{7,8}[EW])/i,
  );
  if (!circle) return undefined;
  const c = parseCompactCoord(`${circle[2]} ${circle[3]}`);
  const radiusNm = Number(circle[1]);
  if (!c || Number.isNaN(radiusNm)) return undefined;
  return { lat: c.lat, lon: c.lon, radiusNm };
}

function parseLimitsFromChunk(chunk: string, fallbackText: string): [number, number] | undefined {
  const vertChunk =
    chunk.match(/Vertical limits?([\s\S]{0,400})/i)?.[1] ??
    chunk.match(/Gräns i höjdled([\s\S]{0,400})/i)?.[1] ??
    chunk;
  const vertTokens = [
    ...vertChunk.matchAll(
      /\b(FL\s*\d{1,3}|GND|SFC|UNL|\d{3,5}\s*ft(?:\s*AMSL)?)\b/gi,
    ),
  ].map((m) => m[1]);
  let nums = vertTokens
    .map(parseAipVerticalToken)
    .filter((n): n is number => n != null);
  if (nums.length < 1) {
    const fb = [
      ...fallbackText.matchAll(
        /\b(FL\s*\d{1,3}|GND|SFC|UNL|\d{3,5}\s*ft(?:\s*AMSL)?)\b/gi,
      ),
    ].map((m) => parseAipVerticalToken(m[1]));
    nums = fb.filter((n): n is number => n != null);
  }
  if (nums.length >= 2) return [Math.min(...nums), Math.max(...nums)];
  if (nums.length === 1) return [0, nums[0]];
  return undefined;
}

function buildAreaFromSection(
  section: { id: string; name: string; chunk: string },
  text: string,
  meta: { amdtId?: string; supNumber?: string; href?: string },
): AreaRecord | null {
  const id = section.id.toUpperCase();
  const shortName = shortFromDesignator(id);
  const category = id.startsWith("ESD") ? "D" : "R";
  const fromDoc = extractNameNearDesignator(text, id);
  const rawName = (fromDoc && fromDoc.length >= section.name.length
    ? fromDoc
    : section.name
  ).trim();
  const name = rawName.toLocaleUpperCase("sv-SE");
  const needsReview =
    isDesignatorOnlyName(name, shortName, id) ? ("missing_name" as const) : undefined;

  const remarks = text.slice(0, 4000);
  const validity = parseValidityWindow(section.chunk, text, meta);

  // FIR / national-border arcs cannot be auto-parsed — leave baseline alone.
  if (
    hasFirBorderLateralLimits(section.chunk) ||
    hasFirBorderLateralLimits(remarks)
  ) {
    return {
      id,
      shortName,
      name,
      category,
      areaTypeCode: "3",
      coordinates: [],
      limits: parseLimitsFromChunk(section.chunk, text),
      activation: { type: "MANUAL" },
      directives: [],
      mapDefaultVisible: false,
      noaiw: false,
      provenance: {
        source: "sup",
        amdtId: meta.amdtId,
        supNumber: meta.supNumber,
        href: meta.href,
        validFrom: validity.validFrom,
        validTo: validity.validTo,
        validityWindows: validity.windows?.map((w) => ({
          from: w.validFrom,
          to: w.validTo,
        })),
        rawComment: remarks.slice(0, 500),
      },
      exclusionReason: FIR_BORDER_EXCLUSION,
      needsReview,
      rawBlock: "",
      section: "tempo",
    };
  }

  let coordinates = parseCoordsFromChunk(section.chunk);
  const boundCircle = parseCircleFromChunk(section.chunk);
  let circleSpacingDeg: number | undefined;
  if (boundCircle && coordinates.length < 3) {
    circleSpacingDeg = defaultSpacingForRadius(boundCircle.radiusNm);
    coordinates = densifyCircle(
      boundCircle.lat,
      boundCircle.lon,
      boundCircle.radiusNm,
      circleSpacingDeg,
    );
  }
  if (coordinates.length < 3 && !boundCircle) return null;

  const limits = parseLimitsFromChunk(section.chunk, text);
  const inferred = inferAreaTypeFromRemarks(remarks);
  const flyingSup = /military aviation|aviation operations|flygverksamhet/i.test(
    text,
  );
  const useAup = flyingSup || inferred.reason === "flying_or_ats_permission";

  let label: AreaRecord["label"];
  if (coordinates.length >= 3) {
    try {
      const poly = polygon([coordinates]);
      const c = centroid(poly);
      label = {
        lon: c.geometry.coordinates[0],
        lat: c.geometry.coordinates[1],
        text: name,
      };
    } catch {
      /* ignore invalid rings for label */
    }
  } else if (boundCircle) {
    label = {
      lat: boundCircle.lat,
      lon: boundCircle.lon,
      text: name,
    };
  }

  return {
    id,
    shortName,
    name,
    category,
    areaTypeCode: inferred.areaTypeCode,
    coordinates,
    limits,
    activation: useAup ? { type: "AUP", key: id } : { type: "MANUAL" },
    directives: inferred.noaiw ? ["NOAIW"] : [],
    label,
    mapDefaultVisible: true,
    noaiw: inferred.noaiw,
    boundCircle,
    circleSpacingDeg,
    provenance: {
      source: "sup",
      amdtId: meta.amdtId,
      supNumber: meta.supNumber,
      href: meta.href,
      validFrom: validity.validFrom,
      validTo: validity.validTo,
      validityWindows: validity.windows?.map((w) => ({
        from: w.validFrom,
        to: w.validTo,
      })),
      rawComment: remarks.slice(0, 500),
    },
    needsReview,
    rawBlock: "",
    section: "tempo",
  };
}

/** Fallback: single first designator + all coords in the document (legacy). */
function parseSingleAreaFallback(
  text: string,
  meta: { amdtId?: string; supNumber?: string; href?: string },
): AreaRecord[] {
  const idMatch = text.match(/\b(ES[RD]\d{2,4}[A-Z]?)\b/);
  if (!idMatch) return [];
  const id = idMatch[1].toUpperCase();
  const name =
    extractNameNearDesignator(text, id) || shortFromDesignator(id);
  const area = buildAreaFromSection(
    { id, name, chunk: text },
    text,
    meta,
  );
  return area ? [area] : [];
}

export function parseSupHtml(
  html: string,
  meta: { amdtId?: string; supNumber?: string; href?: string },
): AreaRecord[] {
  const text = stripHtml(html);
  const remarks = text.slice(0, 4000);
  if (isUasOnlyText(text) && !/military aviation/i.test(text)) {
    const idMatch = text.match(/\b(ES[RD]\d{2,4}[A-Z]?)\b/i);
    if (!idMatch) return [];
    const id = idMatch[1].toUpperCase();
    return [
      {
        id,
        shortName: shortFromDesignator(id),
        name: id,
        category: id.includes("D") ? "D" : "R",
        areaTypeCode: "4F",
        coordinates: [],
        directives: [],
        mapDefaultVisible: false,
        noaiw: true,
        provenance: {
          source: "sup",
          amdtId: meta.amdtId,
          supNumber: meta.supNumber,
          href: meta.href,
          rawComment: "UAS-only",
        },
        exclusionReason: "uas_only",
        rawBlock: "",
        section: "tempo",
      },
    ];
  }

  const sections = extractAreaSections(text);
  if (sections.length >= 1) {
    const areas: AreaRecord[] = [];
    for (const section of sections) {
      const area = buildAreaFromSection(section, text, meta);
      if (area) areas.push(area);
    }
    if (areas.length) return areas;
  }

  return parseSingleAreaFallback(text, meta);
}

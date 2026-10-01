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
  autoSpacingForRadius,
  parseCompactCoord,
} from "@/lib/areas/coords";
import { parseAipVerticalToken } from "@/lib/areas/limits";
import { isDesignatorOnlyName, normalizeDesignator } from "@/lib/areas/names";
import type { AreaRecord } from "@/lib/areas/types";
import {
  FIR_BORDER_EXCLUSION,
  hasFirBorderLateralLimits,
} from "@/lib/aip/fir-border";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|div|td|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

function parseCoords(chunk: string): [number, number][] {
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

function parseCircle(chunk: string): AreaRecord["boundCircle"] {
  // ENR often uses metres: "circle with radius 1000 m centred on 585523N 0175804E"
  const m = chunk.match(
    /circle with radius\s+([\d.]+)\s*(NM|nm|m|metres|meters)?\s*centr(?:ed|ered)\s+on\s+(\d{6,7}[NS])\s+(\d{7,8}[EW])/i,
  );
  if (!m) return undefined;
  const c = parseCompactCoord(`${m[3]} ${m[4]}`);
  if (!c) return undefined;
  let radiusNm = Number(m[1]);
  if (Number.isNaN(radiusNm)) return undefined;
  const unit = (m[2] || "m").toLowerCase();
  if (unit === "m" || unit.startsWith("metre") || unit.startsWith("meter")) {
    radiusNm = radiusNm / 1852;
  }
  return { lat: c.lat, lon: c.lon, radiusNm };
}

function parseLimits(chunk: string): [number, number] | undefined {
  const tokens = [
    ...chunk.matchAll(
      /\b(FL\s*\d{1,3}|GND|SFC|UNL|\d{3,5}\s*ft(?:\s*AMSL)?)\b/gi,
    ),
  ].map((x) => x[1]);
  const nums = tokens
    .map(parseAipVerticalToken)
    .filter((n): n is number => n != null);
  if (nums.length >= 2) return [Math.min(...nums), Math.max(...nums)];
  if (nums.length === 1) return [0, nums[0]];
  return undefined;
}

/**
 * Parse permanent R/D from LFV ENR 5.1 HTML.
 * Blocks look like: `ESR41A RINGENÄS` + coords/circle + upper/lower limits.
 */
export function parseEnr51Html(
  html: string,
  meta: { amdtId?: string },
): AreaRecord[] {
  const text = stripHtml(html);
  const re =
    /\b(ES[RD]\d{1,4}[A-Z]?)\s+([A-ZÅÄÖ][A-Za-zÅÄÖåäö0-9][A-Za-zÅÄÖåäö0-9 /-]{0,60}?)\s*\n([\s\S]*?)(?=\n\s*ES[RDP]\d|\n\s*ENR\s+5\.|$)/gi;
  const areas: AreaRecord[] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(re)) {
    const rawId = m[1].toUpperCase();
    const id = normalizeDesignator(rawId);
    if (seen.has(id)) continue;
    let name = m[2].trim().replace(/\s+/g, " ");
    name = name.split(/\s*\/\s*/)[0]?.trim() || name;
    if (/^(and|och|area|areas)$/i.test(name)) continue;
    const chunk = m[0];
    const shortName = shortFromDesignator(id);
    const category = id.startsWith("ESD") ? "D" : "R";
    const nameUp = name.toLocaleUpperCase("sv-SE");
    const needsReview = isDesignatorOnlyName(nameUp, shortName, id)
      ? ("missing_name" as const)
      : undefined;

    // Lateral limits that follow the FIR/national border cannot be densified
    // from AIP corner points — keep baseline TopSky geometry (manual only).
    if (hasFirBorderLateralLimits(chunk)) {
      seen.add(id);
      areas.push({
        id,
        shortName,
        name: nameUp,
        category,
        areaTypeCode: "3",
        coordinates: [],
        limits: parseLimits(chunk),
        activation: { type: "ALWAYS" },
        directives: [],
        mapDefaultVisible: false,
        noaiw: false,
        provenance: {
          source: "enr51",
          amdtId: meta.amdtId,
          rawComment: chunk.slice(0, 400),
        },
        exclusionReason: FIR_BORDER_EXCLUSION,
        needsReview,
        rawBlock: "",
        section: "other",
      });
      continue;
    }

    let coordinates = parseCoords(chunk);
    const boundCircle = parseCircle(chunk);
    let circleSpacingDeg: number | undefined;
    if (boundCircle && coordinates.length < 3) {
      circleSpacingDeg = autoSpacingForRadius(boundCircle.radiusNm);
      coordinates = densifyCircle(
        boundCircle.lat,
        boundCircle.lon,
        boundCircle.radiusNm,
        circleSpacingDeg,
      );
    }
    if (coordinates.length < 3 && !boundCircle) continue;

    const limits = parseLimits(chunk);
    // Drone/UAV-only R areas (e.g. ESR113 Stockholm) — not for VATSIM; keep out of Accept.
    if (isUasOnlyText(chunk)) {
      seen.add(id);
      areas.push({
        id,
        shortName,
        name: nameUp,
        category,
        areaTypeCode: "3",
        coordinates: [],
        limits,
        activation: { type: "NONE" },
        directives: [],
        mapDefaultVisible: false,
        noaiw: false,
        provenance: {
          source: "enr51",
          amdtId: meta.amdtId,
          rawComment: chunk.slice(0, 400),
        },
        exclusionReason: "uas_only",
        needsReview,
        rawBlock: "",
        section: "other",
      });
      continue;
    }

    const inferred = inferAreaTypeFromRemarks(chunk);
    // Permanent ENR R/D with flying/military often 4F; circle urban (Nynäshamn) often 3.
    // Prefer remark inference; default permanent R/D without ATS keywords → keep inferred.
    const flying =
      /military|flygverksamhet|aviation operations|ATS|ACC|ATC/i.test(chunk);
    const areaTypeCode = flying
      ? "4F"
      : inferred.areaTypeCode === "4F"
        ? "4F"
        : "3";
    const noaiw = areaTypeCode === "4F";

    let label: AreaRecord["label"];
    if (coordinates.length >= 3) {
      try {
        const poly = polygon([coordinates]);
        const c = centroid(poly);
        label = {
          lon: c.geometry.coordinates[0],
          lat: c.geometry.coordinates[1],
          text: nameUp,
        };
      } catch {
        /* ignore */
      }
    } else if (boundCircle) {
      label = {
        lat: boundCircle.lat,
        lon: boundCircle.lon,
        text: nameUp,
      };
    }

    seen.add(id);
    areas.push({
      id,
      shortName,
      name: nameUp,
      category,
      areaTypeCode,
      coordinates,
      limits,
      activation: noaiw
        ? { type: "AUP", key: id }
        : { type: "ALWAYS" },
      directives: noaiw ? ["NOAIW"] : [],
      label,
      mapDefaultVisible: true,
      noaiw,
      boundCircle,
      circleSpacingDeg,
      provenance: {
        source: "enr51",
        amdtId: meta.amdtId,
        rawComment: chunk.slice(0, 400),
      },
      needsReview,
      rawBlock: "",
      section: "other",
    });
  }

  return areas;
}

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
import type { AreaRecord } from "@/lib/areas/types";

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

export function parseSupHtml(
  html: string,
  meta: { amdtId?: string; supNumber?: string; href?: string },
): AreaRecord[] {
  const text = stripHtml(html);
  const remarks = text.slice(0, 4000);
  if (isUasOnlyText(text) && !/military aviation/i.test(text)) {
    // Still return a stub marked excluded for diff
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

  const idMatch = text.match(/\b(ES[RD]\d{2,4}[A-Z]?)\b/);
  if (!idMatch) return [];
  const id = idMatch[1].toUpperCase();
  const shortName = shortFromDesignator(id);
  const category = id.startsWith("ESD") ? "D" : "R";

  // Name: after designator on title line
  let name = shortName;
  const title =
    text.match(
      new RegExp(
        `(?:TEMPORARY\\s+(?:RESTRICTED|DANGER)\\s+AREA\\s*[-–]?\\s*${id}\\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö0-9 /-]{1,40}))`,
        "i",
      ),
    ) ||
    text.match(new RegExp(`${id}\\s+([A-ZÅÄÖ][A-ZÅÄÖa-zåäö0-9 /-]{1,40})`));
  if (title?.[1]) name = title[1].trim().toUpperCase();

  // Compact coords chain: 592437N 0201555E - ...
  const coordTokens = [
    ...text.matchAll(
      /(\d{6,7}(?:\.\d+)?[NS]\s+\d{7,8}(?:\.\d+)?[EW])/gi,
    ),
  ].map((m) => m[1]);

  let coordinates: [number, number][] = [];
  for (const tok of coordTokens) {
    const c = parseCompactCoord(tok.replace(/\s+/g, " "));
    if (c) coordinates.push([c.lon, c.lat]);
  }
  coordinates = closeRing(coordinates);

  // Circle: radius X NM centred on ...
  let boundCircle: AreaRecord["boundCircle"];
  const circle = text.match(
    /circle with radius\s+([\d.]+)\s*NM\s+centr(?:ed|ered)\s+on\s+(\d{6,7}[NS])\s+(\d{7,8}[EW])/i,
  );
  if (circle) {
    const c = parseCompactCoord(`${circle[2]} ${circle[3]}`);
    const radiusNm = Number(circle[1]);
    if (c && !Number.isNaN(radiusNm)) {
      boundCircle = { lat: c.lat, lon: c.lon, radiusNm };
      if (coordinates.length < 3) {
        coordinates = densifyCircle(
          c.lat,
          c.lon,
          radiusNm,
          defaultSpacingForRadius(radiusNm),
        );
      }
    }
  }

  // Vertical limits — collect FL / ft / GND tokens near "Vertical"
  const vertChunk =
    text.match(/Vertical limits?([\s\S]{0,400})/i)?.[1] ??
    text.match(/Gräns i höjdled([\s\S]{0,400})/i)?.[1] ??
    text;
  const vertTokens = [
    ...vertChunk.matchAll(
      /\b(FL\s*\d{1,3}|GND|SFC|UNL|\d{3,5}\s*ft(?:\s*AMSL)?)\b/gi,
    ),
  ].map((m) => m[1]);
  const nums = vertTokens
    .map(parseAipVerticalToken)
    .filter((n): n is number => n != null);
  let limits: [number, number] | undefined;
  if (nums.length >= 2) {
    limits = [Math.min(...nums), Math.max(...nums)];
  } else if (nums.length === 1) {
    limits = [0, nums[0]];
  }

  // Validity
  const validTo =
    text.match(
      /(?:to|–|-)\s*(\d{1,2}\s+[A-Z]{3}\s+\d{4})\s*(?:\d{4})?/i,
    )?.[1] ||
    text.match(/Valid to\s+(\d{1,2}\s+[A-Z]{3}\s+\d{4})/i)?.[1];
  const validFrom = text.match(
    /(\d{1,2}\s+[A-Z]{3}\s+\d{4})\s*(?:0000)?\s*(?:–|-|to)/i,
  )?.[1];

  const inferred = inferAreaTypeFromRemarks(remarks);
  const flyingSup = /military aviation|aviation operations|flygverksamhet/i.test(
    text,
  );

  let label: AreaRecord["label"];
  if (coordinates.length >= 3) {
    try {
      const poly = polygon([coordinates]);
      const c = centroid(poly);
      label = {
        lon: c.geometry.coordinates[0],
        lat: c.geometry.coordinates[1],
        text: name.toUpperCase(),
      };
    } catch {
      /* ignore */
    }
  } else if (boundCircle) {
    label = {
      lat: boundCircle.lat,
      lon: boundCircle.lon,
      text: name.toUpperCase(),
    };
  }

  const useAup = flyingSup || inferred.reason === "flying_or_ats_permission";

  const area: AreaRecord = {
    id,
    shortName,
    name: name.toUpperCase(),
    category,
    areaTypeCode: inferred.areaTypeCode,
    coordinates,
    limits,
    activation: useAup
      ? { type: "AUP", key: id }
      : { type: "MANUAL" },
    directives: inferred.noaiw ? ["NOAIW"] : [],
    label,
    mapDefaultVisible: true,
    noaiw: inferred.noaiw,
    boundCircle,
    provenance: {
      source: "sup",
      amdtId: meta.amdtId,
      supNumber: meta.supNumber,
      href: meta.href,
      validFrom,
      validTo,
      rawComment: remarks.slice(0, 500),
    },
    rawBlock: "",
    section: "tempo",
  };

  return [area];
}

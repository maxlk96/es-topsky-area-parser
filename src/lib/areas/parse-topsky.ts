import {
  classifyFromName,
  designatorFromShort,
} from "./classify";
import { parseLimitsLine } from "./limits";
import { parseTopSkyCoordPair } from "./coords";
import type { AreaRecord, ParseResult } from "./types";

function bytesToLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

export function decodeAreaBytes(bytes: Uint8Array): { text: string; encoding: string } {
  const latin = bytesToLatin1(bytes);
  // Heuristic: if it looks like UTF-8 BOM/multibyte Swedish, try UTF-8
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (hasBom) {
    return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf8" };
  }
  return { text: latin, encoding: "latin1" };
}

export function parseTopSkyText(text: string, encoding = "latin1"): ParseResult {
  const errors: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const areas: AreaRecord[] = [];

  let inTempo = false;
  let pendingComments: string[] = [];
  let cur: {
    start: number;
    areaType: string;
    shortName: string;
    lines: string[];
    coords: [number, number][];
    directives: string[];
    noaiw: boolean;
    limits?: [number, number];
    label?: { lat: number; lon: number; text: string };
    activationRaws: string[];
    boundCircle?: { lat: number; lon: number; radiusNm: number };
    commentName?: string;
  } | null = null;

  const flush = () => {
    if (!cur) return;
    const { category, mapDefaultVisible } = classifyFromName(
      cur.areaType,
      cur.shortName,
      inTempo ? "tempo" : "other",
    );
    const id = designatorFromShort(cur.shortName);
    let activation: AreaRecord["activation"];
    const aup = cur.activationRaws.find((a) => a.startsWith("ACTIVE:AUP:"));
    const aupg = cur.activationRaws.find((a) => a.startsWith("ACTIVE:AUP_GROUP:"));
    const always = cur.activationRaws.find((a) => a === "ACTIVE:1");
    if (aup) {
      activation = { type: "AUP", key: aup.slice("ACTIVE:AUP:".length), raw: cur.activationRaws };
    } else if (aupg) {
      activation = {
        type: "AUP_GROUP",
        key: aupg.slice("ACTIVE:AUP_GROUP:".length),
        raw: cur.activationRaws,
      };
    } else if (always) {
      activation = { type: "ALWAYS", raw: cur.activationRaws };
    } else if (cur.activationRaws.length) {
      activation = { type: "SCHEDULE", raw: cur.activationRaws };
    } else {
      activation = { type: "MANUAL", raw: [] };
    }

    const name =
      cur.label?.text ||
      cur.commentName ||
      cur.shortName.trim();

    const end = cur.start + cur.lines.length;
    // raw block reconstructed from collected lines
    const rawBlock = cur.lines.join("\n");

    areas.push({
      id,
      shortName: cur.shortName.trim(),
      name,
      category,
      areaTypeCode: cur.areaType,
      coordinates: cur.coords,
      limits: cur.limits,
      activation,
      directives: cur.directives,
      label: cur.label,
      mapDefaultVisible,
      noaiw: cur.noaiw,
      boundCircle: cur.boundCircle,
      provenance: {
        source: "topsky",
        rawComment: pendingComments.join("\n") || undefined,
      },
      rawBlock,
      section: inTempo ? "tempo" : "other",
    });
    void end;
    cur = null;
    pendingComments = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("START OF TEMPO R AND D AREAS")) {
      inTempo = true;
    }
    if (line.includes("END OF TEMPO R AND D AREAS")) {
      flush();
      inTempo = false;
    }

    const trimmedLine = line.trim();
    const isEsComment = new RegExp("^//ES[RDP]\\d+", "i").test(trimmedLine);
    const isSupValidity = new RegExp("^//\\s*\\d+/\\d+", "i").test(trimmedLine);
    if (isEsComment || isSupValidity) {
      if (!cur) pendingComments.push(line);
      const nameMatch = trimmedLine.match(new RegExp("^//ES[RDP]\\d+\\S*\\s+(.+)$", "i"));
      if (nameMatch && !cur) {
        pendingComments = [
          ...pendingComments.filter(
            (c) => !new RegExp("^//ES[RDP]\\d+", "i").test(c.trim()),
          ),
          line,
        ];
      }
      continue;
    }

    if (line.startsWith("AREA:")) {
      flush();
      const parts = line.split(":");
      const areaType = parts[1] ?? "";
      const shortName = parts.slice(2).join(":");
      const commentName = (() => {
        for (let j = pendingComments.length - 1; j >= 0; j--) {
          const m = pendingComments[j]
            .trim()
            .match(new RegExp("^//ES[RDP]\\d+\\S*\\s+(.+)$", "i"));
          if (m) return m[1].trim();
        }
        return undefined;
      })();
      cur = {
        start: i,
        areaType,
        shortName,
        lines: [...pendingComments, line],
        coords: [],
        directives: [],
        noaiw: false,
        activationRaws: [],
        commentName,
      };
      pendingComments = [];
      continue;
    }

    if (!cur) continue;
    cur.lines.push(line);

    const t = line.trim();
    if (!t || t.startsWith("//")) continue;

    if (t === "NOAIW") {
      cur.noaiw = true;
      cur.directives.push(t);
      continue;
    }
    if (
      t.startsWith("NOAPW") ||
      t.startsWith("NOSAP") ||
      t.startsWith("NOMSAW") ||
      t.startsWith("NOCLAMRAM") ||
      t.startsWith("NOTCT") ||
      t.startsWith("CATEGORY:") ||
      t.startsWith("GROUP:") ||
      t.startsWith("USERTEXT:") ||
      t.startsWith("ELEVATION:")
    ) {
      cur.directives.push(t);
      continue;
    }
    if (t.startsWith("ACTIVE:")) {
      cur.activationRaws.push(t);
      continue;
    }
    if (t.startsWith("LIMITS:")) {
      const lim = parseLimitsLine(t);
      if (lim) cur.limits = lim;
      else errors.push(`Bad LIMITS at line ${i + 1}`);
      continue;
    }
    if (t.startsWith("LABEL:")) {
      const parts = t.split(":");
      // LABEL:Nlat:Elon:TEXT or LABEL:lat:lon:TEXT
      if (parts.length >= 4) {
        const latTok = parts[1];
        const lonTok = parts[2];
        const text = parts.slice(3).join(":");
        const pair = parseTopSkyCoordPair(`${latTok} ${lonTok}`);
        if (pair) {
          cur.label = { lat: pair.lat, lon: pair.lon, text };
        } else {
          // decimal-ish fallback
          const lat = Number(latTok.replace(/^[NS]/i, ""));
          const lon = Number(lonTok.replace(/^[EW]/i, ""));
          if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
            cur.label = { lat, lon, text };
          }
        }
      }
      continue;
    }
    if (t.startsWith("BOUND:C:")) {
      const rest = t.slice("BOUND:C:".length);
      const bits = rest.split(":");
      if (bits.length >= 3) {
        const pair = parseTopSkyCoordPair(`${bits[0]} ${bits[1]}`);
        const radius = Number(bits[2]);
        if (pair && !Number.isNaN(radius)) {
          cur.boundCircle = { lat: pair.lat, lon: pair.lon, radiusNm: radius };
        } else if (bits.length >= 3) {
          // decimal degrees form BOUND:C:57.299722:17.996389:8
          const lat = Number(bits[0]);
          const lon = Number(bits[1]);
          if (!Number.isNaN(lat) && !Number.isNaN(lon) && !Number.isNaN(radius)) {
            cur.boundCircle = { lat, lon, radiusNm: radius };
          }
        }
      }
      continue;
    }
    if (t.startsWith("BOUND:") || t.startsWith("COORD") || t.startsWith("AND_ACTIVE")) {
      cur.directives.push(t);
      continue;
    }

    const coord = parseTopSkyCoordPair(t);
    if (coord) {
      cur.coords.push([coord.lon, coord.lat]);
    }
  }
  flush();

  return { areas, encoding, errors, rawText: text };
}

export function parseTopSkyBuffer(buf: ArrayBuffer | Uint8Array): ParseResult {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const { text, encoding } = decodeAreaBytes(bytes);
  return parseTopSkyText(text, encoding);
}

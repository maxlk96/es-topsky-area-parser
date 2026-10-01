import {
  applyDesignatorPolicy,
  areaOmitsLabel,
  classifyFromName,
  designatorFromShort,
  isUasOnlyText,
} from "./classify";
import { parseLimitsLine } from "./limits";
import { inferSpacingFromRing, parseTopSkyCoordPair } from "./coords";
import {
  isDesignatorOnlyName,
  resolveAreaName,
} from "./names";
import {
  isSectionBannerLine,
  patchNameInBlock,
  stripTrailingSectionBannerLines,
} from "./write-topsky";
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
  /**
   * ESAA tempo files put one `// N/YY - Valid to …` header above a *group* of
   * areas (e.g. SUP 145/26 → ESR500–ESR506). Only the first area's raw block
   * contains that line — siblings must inherit it for prune/export.
   */
  let activeSup: { supNumber: string; validTo?: string } | null = null;
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
    const { category, mapDefaultVisible: defaultVisible } = classifyFromName(
      cur.areaType,
      cur.shortName,
      inTempo ? "tempo" : "other",
    );
    const id = designatorFromShort(cur.shortName);
    // Orphans (e.g. ESR111) stay in the working set so Reload AIP → Diff can
    // propose removal; export hard-strips the not-in-AIP list as a safety net.
    const uasBlob = `${cur.commentName ?? ""} ${cur.shortName} ${id}`;
    const uasOnly = isUasOnlyText(uasBlob);
    const mapDefaultVisible = uasOnly ? false : defaultVisible;
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

    const shortName = cur.shortName.trim();
    const resolved = resolveAreaName({
      labelText: cur.label?.text,
      commentName: cur.commentName,
      shortName,
      id,
    });
    let label = cur.label;
    // If LABEL text was kept but coords failed, place label on first vertex.
    if (label && label.lat === 0 && label.lon === 0 && cur.coords.length) {
      const [lon, lat] = cur.coords[0];
      label = { ...label, lat, lon, text: resolved.name };
    } else if (label) {
      label = { ...label, text: resolved.name };
    }
    const needsReview =
      (category === "R" || category === "D") &&
      isDesignatorOnlyName(resolved.name, shortName, id)
        ? ("missing_name" as const)
        : undefined;

    const end = cur.start + cur.lines.length;
    // Never keep TEMPO/DANGER/PCA/SOARING banner crumbs in the area block.
    let rawBlock = stripTrailingSectionBannerLines(cur.lines.join("\n"));
    // Fix corrupt LABEL text in-block (e.g. NYN<\xe4SHAMN) so export writes clean name.
    if (resolved.fixedCorruption && label) {
      rawBlock = patchNameInBlock(rawBlock, id, resolved.name, label);
    }

    // ESR94 / ESR102 / ESR127: never keep an active LABEL (+ // NO LABEL marker).
    let exportLabel = label;
    if (areaOmitsLabel({ id, shortName })) {
      exportLabel = undefined;
      if (/(^|\n)(?!\/\/)LABEL:/im.test(rawBlock)) {
        rawBlock = rawBlock.replace(/(^|\n)(?!\/\/)LABEL:/gim, "$1//LABEL:");
      }
      if (!/\/\/\s*NO LABEL\b/i.test(rawBlock)) {
        if (/^(?:\/\/)?AREA:/im.test(rawBlock)) {
          rawBlock = rawBlock.replace(
            /^((?:\/\/)?AREA:[^\n]*\n)/im,
            "$1// NO LABEL\n",
          );
        } else {
          rawBlock = rawBlock.replace(/^(\/\/[^\n]*\n)/, "$1// NO LABEL\n");
        }
      }
    }

    // Tempo SUP header: `// 182/25 - Valid to 31 AUG 2026` (in this block or
    // inherited from the active group header for sibling areas).
    let supNumber: string | undefined;
    let validTo: string | undefined;
    for (const raw of cur.lines) {
      const m = raw
        .trim()
        .match(/^\/\/\s*(\d+)\s*\/\s*(\d+)\s*-\s*Valid to\s+(.+)$/i);
      if (m) {
        supNumber = `${m[1]}/${m[2]}`;
        validTo = m[3].trim();
        break;
      }
    }
    if (!supNumber && activeSup) {
      supNumber = activeSup.supNumber;
      validTo = activeSup.validTo;
    }

    const record = applyDesignatorPolicy({
      id,
      shortName,
      name: resolved.name,
      category,
      areaTypeCode: cur.areaType,
      coordinates: cur.coords,
      limits: cur.limits,
      activation,
      directives: cur.directives,
      label: exportLabel,
      mapDefaultVisible,
      noaiw: cur.noaiw,
      boundCircle: cur.boundCircle,
      circleSpacingDeg: cur.boundCircle
        ? inferSpacingFromRing(cur.coords)
        : undefined,
      provenance: {
        source: "topsky",
        rawComment: cur.commentName || undefined,
        ...(supNumber ? { supNumber, validTo } : {}),
      },
      ...(uasOnly ? { exclusionReason: "uas_only" as const } : {}),
      needsReview,
      // Mark edited so whole-file LABEL patch runs on export for the corruption fix.
      nameEdited: resolved.fixedCorruption || undefined,
      labelEdited: resolved.fixedCorruption && label ? true : undefined,
      rawBlock,
      section: inTempo ? "tempo" : "other",
    });
    areas.push(record);
    void end;
    cur = null;
    pendingComments = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("START OF TEMPO R AND D AREAS")) {
      inTempo = true;
      activeSup = null;
    }
    if (line.includes("END OF TEMPO R AND D AREAS")) {
      flush();
      inTempo = false;
      activeSup = null;
    }

    // Section banners (////… TEMPO / DANGER / PCA / SOARING) stay in the file
    // only — never append opening //// + // crumbs onto the previous area.
    if (isSectionBannerLine(line)) {
      flush();
      continue;
    }

    const trimmedLine = line.trim();
    const isEsComment = new RegExp("^//ES[RDP]\\d+", "i").test(trimmedLine);
    const isSupValidity = new RegExp("^//\\s*\\d+/\\d+", "i").test(trimmedLine);
    // A new //ESR… header always starts the next area — flush the open one first.
    // Previously these were dropped while `cur` was open, losing AIP names.
    if (isEsComment) {
      if (cur) flush();
      pendingComments = [
        ...pendingComments.filter(
          (c) => !new RegExp("^//ES[RDP]\\d+", "i").test(c.trim()),
        ),
        line,
      ];
      continue;
    }
    if (isSupValidity) {
      // A new SUP Valid-to header always ends the previous area — never append
      // the next SUP's header onto the open block (that mis-tagged ESR506 as 146/26).
      if (cur) flush();
      pendingComments.push(line);
      const m = line
        .trim()
        .match(/^\/\/\s*(\d+)\s*\/\s*(\d+)\s*-\s*Valid to\s+(.+)$/i);
      if (m) {
        activeSup = {
          supNumber: `${m[1]}/${m[2]}`,
          validTo: m[3].trim(),
        };
      } else {
        const bare = line.trim().match(/^\/\/\s*(\d+)\s*\/\s*(\d+)\s*$/);
        if (bare) {
          activeSup = { supNumber: `${bare[1]}/${bare[2]}` };
        }
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
        // Always keep LABEL text (name) even if coords are odd/unpadded.
        const pair = parseTopSkyCoordPair(`${latTok} ${lonTok}`);
        if (pair) {
          cur.label = { lat: pair.lat, lon: pair.lon, text };
        } else {
          cur.label = { lat: 0, lon: 0, text };
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

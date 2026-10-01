import type { AreaCategory, AreaRecord } from "./types";

export interface MapStyle {
  stroke: string;
  fill: string;
  fillOpacity: number;
  lineWidth: number;
}

/** HMI-aligned map styles (ESAA ops table 4.10). */
export function mapStyleFor(area: Pick<AreaRecord, "category" | "areaTypeCode" | "shortName">): MapStyle {
  if (area.category === "TRA" || area.category === "PCA" || area.category === "CBA") {
    return { stroke: "#eab308", fill: "#eab308", fillOpacity: 0.08, lineWidth: 2 };
  }
  if (area.category === "OTHER") {
    return { stroke: "#94a3b8", fill: "#94a3b8", fillOpacity: 0.04, lineWidth: 1 };
  }
  // Foreign R/D
  if (/^(ED|EK|EP|EE|EF|EN)/i.test(area.shortName)) {
    return { stroke: "#dc2626", fill: "#6b7280", fillOpacity: 0.28, lineWidth: 2.25 };
  }
  // AREA:3 — light fill, but keep a clear red outline so they stay readable
  if (area.areaTypeCode === "3") {
    return { stroke: "#dc2626", fill: "#d1d5db", fillOpacity: 0.14, lineWidth: 2.25 };
  }
  // 4F R/D — classic red/gray, slightly stronger than the original MVP defaults
  return { stroke: "#dc2626", fill: "#6b7280", fillOpacity: 0.34, lineWidth: 2.25 };
}

export function classifyFromName(
  areaType: string,
  shortName: string,
  section?: "tempo" | "other",
): { category: AreaCategory; mapDefaultVisible: boolean } {
  const name = shortName.trim();
  if (areaType === "T" || /^A\d/i.test(name)) {
    return { category: "PCA", mapDefaultVisible: true };
  }
  if (areaType === "5F" || /^TRA\d/i.test(name)) {
    return { category: "TRA", mapDefaultVisible: true };
  }
  if (/^CBA/i.test(name)) {
    return { category: "CBA", mapDefaultVisible: true };
  }
  if (/^[RD]\d/i.test(name) || section === "tempo") {
    const cat: AreaCategory = name.startsWith("D") || name.startsWith("d") ? "D" : "R";
    return { category: cat, mapDefaultVisible: true };
  }
  if (/^(ED|EK|EP)/i.test(name)) {
    return { category: name.startsWith("D") ? "D" : "R", mapDefaultVisible: true };
  }
  // M, S, TCTA, STCA, FS, …
  return { category: "OTHER", mapDefaultVisible: false };
}

export function designatorFromShort(shortName: string): string {
  const n = shortName.trim();
  if (/^CBA/i.test(n) || /^TRA/i.test(n)) return n.toUpperCase();
  if (/^[RD]\d/i.test(n)) return `ES${n.toUpperCase()}`;
  return n.toUpperCase();
}

export function shortFromDesignator(id: string): string {
  const u = id.trim().toUpperCase();
  if (u.startsWith("ES") && /^ES[RD]\d/.test(u)) return u.slice(2);
  return u;
}

/**
 * Areas that must stay unlabeled in TopSky (no active LABEL line).
 * Max: R94 / R102 / R127 → emit/preserve `// NO LABEL`; never active LABEL.
 */
const OMIT_LABEL_IDS = new Set([
  "ESR94",
  "R94",
  "ESR102",
  "R102",
  "ESR127",
  "R127",
]);

/** Full designators (ESR…) that omit LABEL — for file-wide export passes. */
export function omitLabelDesignators(): string[] {
  return ["ESR94", "ESR102", "ESR127"];
}

export function areaOmitsLabel(
  area: Pick<{ id: string; shortName?: string }, "id" | "shortName">,
): boolean {
  const id = area.id.trim().toUpperCase();
  const short = (area.shortName || "").trim().toUpperCase();
  return OMIT_LABEL_IDS.has(id) || OMIT_LABEL_IDS.has(short);
}

/** Any UAS/UAV/BVLOS-style mention (subject or body) — informational, not auto-select. */
export function mentionsUasActivity(text: string): boolean {
  return (
    /\bUAS\b|\bUAV\b|\bBVLOS\b|\bRPAS\b|\bDRONES?\b/i.test(text) ||
    /drönar|dronar/i.test(text)
  );
}

/**
 * True only when the area *merely prohibits drone flying* and does not affect
 * other aviation (VATSIM-irrelevant). Examples: ESR113 “Drone flying is
 * prohibited”, “(UAV only)”, `EXCLUDED. ONLY UAS` stubs.
 *
 * Does **not** match military/ops SUPs that mention UAV/UAS/BVLOS operating
 * inside a real R/D — those affect the airspace for everyone and stay selected.
 */
export function isUasOnlyText(text: string): boolean {
  const t = text.toUpperCase();
  // Fold Swedish vowels so DRÖNAR… matches after uppercasing.
  const n = t.replace(/[ÅÄ]/g, "A").replace(/Ö/g, "O");

  // Ops / manned aviation purpose → never treat as drone-prohibition-only.
  if (
    /\bMILITARY\s+AVIATION\b/.test(t) ||
    /(?:MILITARY\s+)?AVIATION\s+OPERATIONS/.test(t) ||
    /\bFLYGVERKSAMHET\b/.test(n) ||
    /PERMISSION OBTAINABLE FROM/.test(t) ||
    /TILLSTAND KAN ERHALLAS FRAN/.test(n)
  ) {
    return false;
  }

  return (
    /\bONLY\s+UAS\b/.test(t) ||
    /\bUAS\s*\/\s*UAV\s+ONLY\b/.test(t) ||
    /\bUAV\s+ONLY\b/.test(t) ||
    /\bUAS\s+ONLY\b/.test(t) ||
    /\bEXCLUDED\.\s*ONLY\s+UAS\b/.test(t) ||
    // ESR113 Stockholm / ESR127 Solna style — sole purpose is drone restriction
    /\bDRONE\s+FLYING\s+IS\s+PROHIBITED\b/.test(t) ||
    /\bFLYING\s+WITH\s+DRONES\s+IS\s+PROHIBITED\b/.test(t) ||
    /DRONARFLYGNING\s+AR\s+FORBJUDEN/.test(n) ||
    /FLYGNING\s+MED\s+DRONARE\s+AR\s+FORBJUDEN/.test(n)
  );
}

/**
 * Clear aviation / flying purpose language (not bare “military operations”).
 * Used for NOAIW on tempo SUPs and for flying inference on ENR remarks.
 *
 * Matches: “military aviation operations”, “aviation operations”,
 * “flygverksamhet”, “military aviation”, “Military activities including … aviation”.
 * Does **not** match: “military operations” alone, “Flight within the area…”,
 * or exemption lists that merely say “Military flights”.
 */
export function hasAviationFlyingWording(text: string): boolean {
  return (
    /(?:military\s+)?aviation\s+operations/i.test(text) ||
    /military\s+aviation\b/i.test(text) ||
    /flygverksamhet/i.test(text) ||
    /Military activities including(?:[^.]{0,100})aviation/i.test(text)
  );
}

/** Flying / ATS permission → 4F+NOAIW; Transportstyrelsen/nature/etc → 3. */
export function inferAreaTypeFromRemarks(remarks: string): {
  areaTypeCode: string;
  noaiw: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
} {
  const t = remarks;
  const uas = isUasOnlyText(t);
  if (uas) {
    return { areaTypeCode: "4F", noaiw: true, confidence: "high", reason: "uas_only" };
  }
  const flying = hasAviationFlyingWording(t);
  const atsPerm = /Permission obtainable from|Tillstånd kan erhållas från/i.test(t);
  const transportstyrelsen =
    /Special permission by Swedish Transport Agency|Särskilda tillstånd från Transportstyrelsen/i.test(
      t,
    );
  const nonAts =
    /National Park|Bird sanctuary|Fågelreservat|Prison|Fängelse|Nuclear|Kärnkraft|Residence|Residens|Blasting|Sprängning|Dagbrott|surface quarry/i.test(
      t,
    );

  if ((flying || atsPerm) && !transportstyrelsen) {
    return {
      areaTypeCode: "4F",
      noaiw: true,
      confidence: flying && atsPerm ? "high" : "medium",
      reason: "flying_or_ats_permission",
    };
  }
  if (transportstyrelsen || nonAts) {
    return {
      areaTypeCode: "3",
      noaiw: false,
      confidence: "high",
      reason: "no_ats_crossing_authority",
    };
  }
  // Bare “military operations/activities” (e.g. SUP 179/2026 Stenshuvud,
  // SUP 186/2026 Hyttefallet) → 4F, no NOAIW. AUP is applied separately in
  // parse-sup; NOAIW still requires clear aviation/flying wording above.
  if (
    /\bmilitary\s+(operations|activities)\b/i.test(t) &&
    !flying
  ) {
    return {
      areaTypeCode: "4F",
      noaiw: false,
      confidence: "medium",
      reason: "military_non_aviation",
    };
  }
  // Unknown tempo/remarks: 4F without inventing NOAIW.
  return {
    areaTypeCode: "4F",
    noaiw: false,
    confidence: "low",
    reason: "default_no_aviation_wording",
  };
}

/**
 * ENR Accept NOAIW merge for permanent 4F:
 * - Never strip NOAIW the candidate correctly asserts (ENR 5.1 §2.2.1 / aviation).
 * - Never strip baseline NOAIW that is already correct.
 * - Keep baseline without NOAIW only when the candidate also omits it
 *   (remaining legacy 4F outside §2.2.1).
 */
export function mergeEnrAcceptPreservingNoaiw(
  candidate: AreaRecord,
  existing?: AreaRecord,
): AreaRecord {
  if (
    !existing ||
    candidate.provenance?.source !== "enr51" ||
    existing.areaTypeCode !== "4F" ||
    candidate.areaTypeCode !== "4F"
  ) {
    return candidate;
  }
  const noaiw = candidate.noaiw || existing.noaiw;
  const directives = noaiw
    ? Array.from(
        new Set([
          "NOAIW",
          ...(candidate.directives || []).filter((d) => d !== "NOAIW"),
        ]),
      )
    : (candidate.directives || []).filter((d) => d !== "NOAIW");
  return {
    ...candidate,
    noaiw,
    directives,
    // Keep baseline activation when still without NOAIW; otherwise prefer candidate (AUP).
    activation: noaiw
      ? (candidate.activation ?? existing.activation)
      : (existing.activation ?? candidate.activation),
  };
}

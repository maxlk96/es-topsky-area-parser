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
    return { stroke: "#dc2626", fill: "#6b7280", fillOpacity: 0.25, lineWidth: 2 };
  }
  if (area.areaTypeCode === "3") {
    return { stroke: "#d1d5db", fill: "#d1d5db", fillOpacity: 0.05, lineWidth: 2 };
  }
  // 4F R/D and default R/D
  return { stroke: "#dc2626", fill: "#6b7280", fillOpacity: 0.28, lineWidth: 2 };
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

/** UAS-only → not for VATSIM. */
export function isUasOnlyText(text: string): boolean {
  const t = text.toUpperCase();
  return (
    /\bONLY\s+UAS\b/.test(t) ||
    /\bUAS\s*\/\s*UAV\s+ONLY\b/.test(t) ||
    /\bBVLOS\b/.test(t) && /\bUAS\b/.test(t) && !/\bMILITARY\s+AVIATION\b/.test(t) ||
    /\bEXCLUDED\.\s*ONLY\s+UAS\b/.test(t)
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
  const flying =
    /aviation operations|flygverksamhet|military aviation|Military activities including/i.test(
      t,
    );
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
  // Default for tempo mil SUP-style unknown: 4F+NOAIW with low confidence
  return {
    areaTypeCode: "4F",
    noaiw: true,
    confidence: "low",
    reason: "default_tempo_flying",
  };
}

import type { AreaCategory, AreaRecord } from "./types";

/**
 * Map layer keys for toggles.
 * FS / TCT / STCA are split out of OTHER by TopSky AreaType (not by TMA name).
 * Note: ESOS/ESGG “TMA” blocks in the file are AREA:TCT_I / AREA:TCTA — they are TCT, not a separate ATS class.
 */
export type LayerKey =
  | AreaCategory
  | "PCA_SUB"
  | "FS"
  | "TCT"
  | "STCA";

export type LayerVisibility = Record<LayerKey, boolean>;

/** Defaults per Max: only R and D on. */
export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  R: true,
  D: true,
  P: false,
  TRA: false,
  CBA: false,
  PCA: false,
  PCA_SUB: false,
  FS: false,
  TCT: false,
  STCA: false,
  OTHER: false,
};

export type LayerGroupId = "rd" | "tra_cba" | "pca" | "other";

export interface LayerToggle {
  key: LayerKey;
  label: string;
}

export interface LayerGroup {
  id: LayerGroupId;
  title: string;
  hint: string;
  toggles: LayerToggle[];
}

/** Right-menu groupings Max will recognize. */
export const LAYER_GROUPS: LayerGroup[] = [
  {
    id: "rd",
    title: "R / D",
    hint: "Restricted & danger (core)",
    toggles: [
      { key: "R", label: "R" },
      { key: "D", label: "D" },
    ],
  },
  {
    id: "tra_cba",
    title: "TRA / CBA",
    hint: "ENR 5.2 exercise / cross-border",
    toggles: [
      { key: "TRA", label: "TRA" },
      { key: "CBA", label: "CBA" },
    ],
  },
  {
    id: "pca",
    title: "PCA",
    hint: "vatiris PCA",
    toggles: [
      { key: "PCA", label: "PCA" },
      { key: "PCA_SUB", label: "PCA sub-parts" },
    ],
  },
  {
    id: "other",
    title: "Other / system",
    hint: "Plugin / system volumes (off by default)",
    toggles: [
      { key: "FS", label: "FS" },
      { key: "TCT", label: "TCT" },
      { key: "STCA", label: "STCA" },
      { key: "OTHER", label: "Other misc" },
    ],
  },
];

/** Stable id for hover/focus across duplicate designators (no list-index). */
export function areaFeatureId(area: AreaRecord): string {
  const lim = area.limits ? `${area.limits[0]}:${area.limits[1]}` : "-";
  const c0 = area.coordinates[0];
  const c = c0 ? `${c0[0].toFixed(5)},${c0[1].toFixed(5)}` : "noc";
  const n = area.coordinates.length;
  return `${area.id}::${area.name}::${area.section}::${area.areaTypeCode}::${lim}::${n}@${c}`;
}

/** FS sectors — TopSky AREA:2F (short names FS…). */
export function isFsArea(area: Pick<AreaRecord, "areaTypeCode" | "shortName">): boolean {
  if (area.areaTypeCode === "2F") return true;
  return /^FS/i.test(area.shortName.trim());
}

/**
 * TCT / TCTA volumes — AREA:TCT_I, AREA:TCTA, etc.
 * Includes ESOS/ESGG TMA geometry used for TCT (not a separate “ATS volumes” class).
 */
export function isTctArea(area: Pick<AreaRecord, "areaTypeCode">): boolean {
  const t = area.areaTypeCode.toUpperCase();
  return t === "TCT_I" || t === "TCTA" || t.startsWith("TCT");
}

/** STCA volumes when present (AREA:STCA or type/name containing STCA). */
export function isStcaArea(
  area: Pick<AreaRecord, "areaTypeCode" | "shortName" | "name">,
): boolean {
  const t = area.areaTypeCode.toUpperCase();
  if (t === "STCA" || t.startsWith("STCA")) return true;
  return /\bSTCA\b/i.test(`${area.shortName} ${area.name}`);
}

/**
 * vatiris PCA sub-parts: letter + 2+ digit code (A11, I61, M12).
 * Main PCA: letter + single digit (A1, B1, G9, M5).
 */
export function isPcaSubPart(
  area: Pick<AreaRecord, "shortName" | "category">,
): boolean {
  if (area.category !== "PCA") return false;
  const s = area.shortName.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]+\d{2,}$/.test(s);
}

export function layerKeyFor(area: AreaRecord): LayerKey {
  if (area.category === "PCA") {
    return isPcaSubPart(area) ? "PCA_SUB" : "PCA";
  }
  if (area.category === "OTHER" || area.category === "P") {
    // Prefer plugin AreaType over name heuristics (TMA names are often TCT).
    if (isTctArea(area)) return "TCT";
    if (isStcaArea(area)) return "STCA";
    if (isFsArea(area)) return "FS";
    if (area.category === "OTHER") return "OTHER";
  }
  return area.category;
}

export function isLayerVisible(
  area: AreaRecord,
  visibility: LayerVisibility,
): boolean {
  return visibility[layerKeyFor(area)] === true;
}

export function countByLayerKey(areas: AreaRecord[]): Record<LayerKey, number> {
  const c: Record<LayerKey, number> = {
    R: 0,
    D: 0,
    P: 0,
    TRA: 0,
    CBA: 0,
    PCA: 0,
    PCA_SUB: 0,
    FS: 0,
    TCT: 0,
    STCA: 0,
    OTHER: 0,
  };
  for (const a of areas) c[layerKeyFor(a)] += 1;
  return c;
}

export function groupToggleState(
  group: LayerGroup,
  visibility: LayerVisibility,
): "all" | "none" | "some" {
  const vals = group.toggles.map((t) => visibility[t.key] === true);
  if (vals.every(Boolean)) return "all";
  if (vals.every((v) => !v)) return "none";
  return "some";
}

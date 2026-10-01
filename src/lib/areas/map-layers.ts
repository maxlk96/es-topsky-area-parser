import type { AreaCategory, AreaRecord } from "./types";

/** Map layer keys used by toggles (splits PCA sub-parts and ATS out of coarse categories). */
export type LayerKey = AreaCategory | "ATS" | "PCA_SUB";

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
  ATS: false,
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
    hint: "TCT, STCA, FS, SKOL, TEKVA, ATS volumes, …",
    toggles: [
      { key: "OTHER", label: "TCT / STCA / FS…" },
      { key: "ATS", label: "ATS volumes (CTR / TMA)" },
    ],
  },
];

/** CTR/TMA-style volumes currently filed under OTHER in TopSkyAreas. */
export function isAtsVolume(
  area: Pick<AreaRecord, "shortName" | "name" | "category">,
): boolean {
  if (area.category !== "OTHER") return false;
  const t = `${area.shortName} ${area.name}`.toUpperCase();
  return /\b(CTR|TMA|CTA|FIZ|ATZ|TIZ|RMZ|TMZ)\b/.test(t);
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
  if (area.category === "OTHER" && isAtsVolume(area)) return "ATS";
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
    ATS: 0,
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

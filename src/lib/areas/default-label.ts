import centroid from "@turf/centroid";
import { polygon } from "@turf/helpers";
import { areaOmitsLabel } from "./classify";
import type { AreaLabel, AreaRecord } from "./types";

function labelText(text: string): string {
  return text
    .replace(/[<>{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("sv-SE");
}

/**
 * Default LABEL position for an area that already has a LABEL:
 * full circle → BOUND:C centre; otherwise polygon centroid;
 * fallback first vertex (same as parse-topsky when LABEL coords fail).
 * Returns null when geometry is insufficient — never invents a label
 * unless `invent` is set (new areas only).
 */
export function defaultLabelPosition(
  area: Pick<AreaRecord, "boundCircle" | "coordinates" | "label">,
  opts?: { invent?: boolean },
): { lat: number; lon: number } | null {
  if (!area.label && !opts?.invent) return null;
  if (area.boundCircle) {
    return { lat: area.boundCircle.lat, lon: area.boundCircle.lon };
  }
  const ring = area.coordinates;
  if (ring.length >= 3) {
    try {
      const closed =
        ring[0]![0] === ring[ring.length - 1]![0] &&
        ring[0]![1] === ring[ring.length - 1]![1]
          ? ring
          : [...ring, ring[0]!];
      const c = centroid(polygon([closed]));
      return {
        lon: c.geometry.coordinates[0],
        lat: c.geometry.coordinates[1],
      };
    } catch {
      /* fall through */
    }
  }
  if (ring.length >= 1) {
    const [lon, lat] = ring[0]!;
    return { lat, lon };
  }
  return null;
}

/**
 * LABEL on Accept / automatic rewrite:
 * - Baseline had LABEL → keep its lat/lon (only label placer moves them).
 * - Baseline unlabeled / // NO LABEL → stay unlabeled.
 * - Brand-new area (not in baseline) → candidate label or generated default.
 */
export function labelForAccept(
  candidate: AreaRecord,
  existing?: AreaRecord,
): AreaLabel | undefined {
  if (areaOmitsLabel(candidate) || (existing && areaOmitsLabel(existing))) {
    return undefined;
  }
  const text = labelText(
    candidate.name || existing?.label?.text || candidate.id,
  );
  if (existing?.label) {
    return {
      lat: existing.label.lat,
      lon: existing.label.lon,
      text,
    };
  }
  if (existing) {
    // Present in baseline without LABEL — never invent on AIP/PCA Accept.
    return undefined;
  }
  if (candidate.label) {
    return { ...candidate.label, text: labelText(candidate.name || candidate.label.text || text) };
  }
  const pos = defaultLabelPosition(candidate, { invent: true });
  if (!pos) return undefined;
  return { ...pos, text };
}

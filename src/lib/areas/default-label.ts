import centroid from "@turf/centroid";
import { polygon } from "@turf/helpers";
import type { AreaRecord } from "./types";

/**
 * Default LABEL position for an area that already has a LABEL:
 * full circle → BOUND:C centre; otherwise polygon centroid;
 * fallback first vertex (same as parse-topsky when LABEL coords fail).
 * Returns null when geometry is insufficient — never invents a label.
 */
export function defaultLabelPosition(
  area: Pick<AreaRecord, "boundCircle" | "coordinates" | "label">,
): { lat: number; lon: number } | null {
  if (!area.label) return null;
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

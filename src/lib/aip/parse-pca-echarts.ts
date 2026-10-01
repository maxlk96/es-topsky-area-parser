import centroid from "@turf/centroid";
import { polygon } from "@turf/helpers";
import { parseAipVerticalToken } from "@/lib/areas/limits";
import { isPcaSubPart } from "@/lib/areas/map-layers";
import type { AreaRecord } from "@/lib/areas/types";

/** vatiris echarts WFS (EPSG:3857 GeoJSON). */
export const VATIRIS_ECHARTS_WFS =
  "https://api.vatiris.se/echarts-wfs?service=WFS&version=1.1.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:3857";

const EARTH_RADIUS_M = 6378137;

/** Web Mercator (EPSG:3857) metres → WGS84 degrees. */
export function webMercatorToWgs84(
  x: number,
  y: number,
): { lon: number; lat: number } {
  const lon = (x / EARTH_RADIUS_M) * (180 / Math.PI);
  const lat =
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) *
    (180 / Math.PI);
  return { lon, lat };
}

/** PCA designator: letter + digits (A1, A11, I61). Reject CTR/TMA junk. */
export function normalizePcaLocation(raw: string): string | null {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!/^[A-Z]+\d+[A-Z]?$/.test(s)) return null;
  return s;
}

function limitsFromUpperLower(
  lower?: string | null,
  upper?: string | null,
): [number, number] {
  const lo = parseAipVerticalToken(String(lower || "GND")) ?? 0;
  const hi = parseAipVerticalToken(String(upper || "UNL")) ?? 999;
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

function ringFromGeometry(
  geom: { type?: string; coordinates?: unknown },
): [number, number][] {
  if (!geom?.coordinates) return [];
  let ring: number[][] | undefined;
  if (geom.type === "Polygon") {
    ring = (geom.coordinates as number[][][])[0];
  } else if (geom.type === "MultiPolygon") {
    ring = (geom.coordinates as number[][][][])[0]?.[0];
  }
  if (!ring?.length) return [];
  const out: [number, number][] = [];
  for (const pt of ring) {
    if (!pt || pt.length < 2) continue;
    const { lon, lat } = webMercatorToWgs84(pt[0]!, pt[1]!);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([lon, lat]);
  }
  // Drop duplicate close vertex if present
  if (out.length >= 2) {
    const [aLon, aLat] = out[0]!;
    const [bLon, bLat] = out[out.length - 1]!;
    if (Math.abs(aLon - bLon) < 1e-9 && Math.abs(aLat - bLat) < 1e-9) {
      out.pop();
    }
  }
  return out;
}

type EchartsFeature = {
  properties?: Record<string, unknown>;
  geometry?: { type?: string; coordinates?: unknown };
};

/**
 * Parse vatiris EXEA (PCA mains) / EXES (sub-parts) FeatureCollections
 * into TopSky-oriented AreaRecords (`AREA:T`, source vatiris_pca).
 */
export function parsePcaEchartsFeatureCollection(
  fc: { features?: EchartsFeature[] },
  kind: "main" | "sub",
): AreaRecord[] {
  const features = fc.features ?? [];
  const areas: AreaRecord[] = [];
  const seen = new Set<string>();

  for (const f of features) {
    const props = f.properties || {};
    const loc = normalizePcaLocation(String(props.LOCATION ?? ""));
    if (!loc) continue;
    const asSub = isPcaSubPart({ category: "PCA", shortName: loc });
    if (kind === "main" && asSub) continue;
    if (kind === "sub" && !asSub) continue;
    if (seen.has(loc)) continue;

    const coordinates = ringFromGeometry(f.geometry || {});
    if (coordinates.length < 3) continue;

    const limits = limitsFromUpperLower(
      props.LOWER as string | null | undefined,
      props.UPPER as string | null | undefined,
    );

    let label: AreaRecord["label"];
    try {
      const closed = [...coordinates, coordinates[0]!];
      const c = centroid(polygon([closed]));
      label = {
        lon: c.geometry.coordinates[0],
        lat: c.geometry.coordinates[1],
        text: loc,
      };
    } catch {
      const [lon, lat] = coordinates[0]!;
      label = { lon, lat, text: loc };
    }

    seen.add(loc);
    areas.push({
      id: loc,
      shortName: loc,
      name: loc,
      category: "PCA",
      areaTypeCode: "T",
      coordinates,
      limits,
      activation: { type: "MANUAL" },
      directives: ["NOAIW", "NOAPW"],
      label,
      mapDefaultVisible: true,
      noaiw: true,
      provenance: {
        source: "vatiris_pca",
        rawComment: `echarts ${kind} ${String(props.NAMEOFAREA || loc)} WEF ${String(props.WEF || "")}`.trim(),
      },
      rawBlock: "",
      section: "other",
    });
  }

  return areas.sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchPcaEchartsAreas(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<{
  areas: AreaRecord[];
  mainCount: number;
  subCount: number;
}> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const [mainRes, subRes] = await Promise.all([
    fetchImpl(`${VATIRIS_ECHARTS_WFS}&typename=mais:EXEA`, {
      next: { revalidate: 3600 },
    } as RequestInit),
    fetchImpl(`${VATIRIS_ECHARTS_WFS}&typename=mais:EXES`, {
      next: { revalidate: 3600 },
    } as RequestInit),
  ]);
  if (!mainRes.ok) {
    throw new Error(`PCA EXEA fetch ${mainRes.status}`);
  }
  if (!subRes.ok) {
    throw new Error(`PCA EXES fetch ${subRes.status}`);
  }
  const mainFc = (await mainRes.json()) as { features?: EchartsFeature[] };
  const subFc = (await subRes.json()) as { features?: EchartsFeature[] };
  const mains = parsePcaEchartsFeatureCollection(mainFc, "main");
  const subs = parsePcaEchartsFeatureCollection(subFc, "sub");
  // Subs override same id if both somehow match (shouldn't after filter).
  const byId = new Map<string, AreaRecord>();
  for (const a of [...mains, ...subs]) byId.set(a.id, a);
  return {
    areas: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    mainCount: mains.length,
    subCount: subs.length,
  };
}

/**
 * On Accept: take echarts geometry/limits, keep baseline LABEL lat/lon
 * (and label text / directives / activation when present).
 */
export function mergePcaAcceptPreservingLabel(
  candidate: AreaRecord,
  existing?: AreaRecord,
): AreaRecord {
  const preservedLabel =
    existing?.label != null
      ? {
          lat: existing.label.lat,
          lon: existing.label.lon,
          text: existing.label.text || candidate.name || candidate.id,
        }
      : candidate.label;

  return {
    ...candidate,
    section: existing?.section ?? "other",
    mapDefaultVisible: true,
    rawBlock: "",
    label: preservedLabel,
    // Keep ops directives from baseline when rewriting a known PCA.
    directives:
      existing?.directives?.length ? [...existing.directives] : candidate.directives,
    noaiw: existing ? existing.noaiw : candidate.noaiw,
    activation: existing?.activation ?? candidate.activation,
    name: existing?.name && existing.name !== existing.id ? existing.name : candidate.name,
  };
}

"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleFor } from "@/lib/areas/classify";
import { closeRing } from "@/lib/areas/coords";
import {
  isLayerVisible,
  type LayerVisibility,
} from "@/lib/areas/map-layers";
import type { AreaRecord } from "@/lib/areas/types";

if (typeof window !== "undefined") {
  // Absolute URL so the module worker can resolve maplibre-gl-shared.mjs
  // on the same origin (incl. Cloudflare tunnel hosts).
  setWorkerUrl(`${window.location.origin}/maplibre-gl-worker.mjs`);
}

type Props = {
  areas: AreaRecord[];
  candidates?: AreaRecord[];
  focusId?: string | null;
  layerVisibility: LayerVisibility;
};

type Role = "base" | "candidate";

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function toFeatureCollection(areas: AreaRecord[], role: Role) {
  return {
    type: "FeatureCollection" as const,
    features: areas
      .filter((a) => a.coordinates.length >= 3)
      .map((a) => {
        const style = mapStyleFor(a);
        // Slightly stronger fill so R/D reads clearly on light basemap.
        const fillOpacity =
          role === "candidate"
            ? 0.14
            : Math.max(style.fillOpacity, a.areaTypeCode === "3" ? 0.12 : 0.32);
        return {
          type: "Feature" as const,
          properties: {
            id: a.id,
            name: a.name,
            category: a.category,
            areaType: a.areaTypeCode,
            role,
            stroke: role === "candidate" ? "#f59e0b" : style.stroke,
            fill: role === "candidate" ? "#f59e0b" : style.fill,
            fillOpacity,
            lineWidth: role === "candidate" ? 2.5 : Math.max(style.lineWidth, 2),
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [closeRing(a.coordinates)],
          },
        };
      }),
  };
}

/**
 * Inline style: basemap + overlays declared together so a style URL swap
 * cannot wipe GeoJSON layers (the previous empty-map failure mode).
 */
function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        // Proxied CARTO light_nolabels (plain, no labels); key stays server-side.
        tiles: [`${typeof window !== "undefined" ? window.location.origin : ""}/api/basemap/{z}/{x}/{y}`],
        tileSize: 256,
        attribution: "© OpenStreetMap © CARTO",
      },
      areas: {
        type: "geojson",
        data: emptyCollection(),
      },
      candidates: {
        type: "geojson",
        data: emptyCollection(),
      },
    },
    layers: [
      {
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: {
          "raster-saturation": -0.25,
          "raster-contrast": -0.05,
        },
      },
      {
        id: "areas-fill",
        type: "fill",
        source: "areas",
        paint: {
          "fill-color": ["get", "fill"],
          "fill-opacity": ["get", "fillOpacity"],
        },
      },
      {
        id: "areas-line",
        type: "line",
        source: "areas",
        paint: {
          "line-color": ["get", "stroke"],
          "line-width": ["get", "lineWidth"],
        },
      },
      {
        id: "cand-fill",
        type: "fill",
        source: "candidates",
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.14,
        },
      },
      {
        id: "cand-line",
        type: "line",
        source: "candidates",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 2.5,
          "line-dasharray": [2, 1],
        },
      },
    ],
  };
}

function setSourceData(
  map: MapLibreMap,
  sourceId: string,
  areas: AreaRecord[],
  role: Role,
) {
  const src = map.getSource(sourceId) as GeoJSONSource | undefined;
  if (!src) return false;
  src.setData(toFeatureCollection(areas, role));
  return true;
}

export function AreaMap({
  areas,
  candidates = [],
  focusId,
  layerVisibility,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const latestRef = useRef({
    visible: [] as AreaRecord[],
    candidates: [] as AreaRecord[],
  });

  const visible = useMemo(
    () => areas.filter((a) => isLayerVisible(a, layerVisibility)),
    [areas, layerVisibility],
  );

  latestRef.current = { visible, candidates };

  useEffect(() => {
    if (!ref.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: ref.current,
      style: buildStyle(),
      center: [16.5, 62.0],
      zoom: 4.2,
    });
    map.addControl(new NavigationControl(), "top-left");

    const applyLatest = () => {
      const { visible: v, candidates: c } = latestRef.current;
      setSourceData(map, "areas", v, "base");
      setSourceData(map, "candidates", c, "candidate");
    };

    map.on("load", () => {
      readyRef.current = true;
      applyLatest();
    });

    map.on("error", (e) => {
      console.error("[AreaMap]", e.error?.message ?? e);
    });

    mapRef.current = map;
    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!readyRef.current) {
      map.once("load", () => {
        setSourceData(map, "areas", visible, "base");
        setSourceData(map, "candidates", candidates, "candidate");
      });
      return;
    }
    setSourceData(map, "areas", visible, "base");
    setSourceData(map, "candidates", candidates, "candidate");
  }, [visible, candidates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const a =
      visible.find((x) => x.id === focusId) ||
      candidates.find((x) => x.id === focusId);
    if (!a || a.coordinates.length < 1) return;
    const lons = a.coordinates.map((c) => c[0]);
    const lats = a.coordinates.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 9, duration: 600 },
    );
  }, [focusId, visible, candidates]);

  return <div ref={ref} className="h-full w-full min-h-[420px]" />;
}

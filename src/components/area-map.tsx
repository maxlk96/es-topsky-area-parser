"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleFor } from "@/lib/areas/classify";
import { closeRing } from "@/lib/areas/coords";
import {
  areaFeatureId,
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
  hoverKey?: string | null;
  selectedKey?: string | null;
  onHoverKey?: (key: string | null) => void;
  onSelectKey?: (key: string | null) => void;
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
        const fillOpacity =
          role === "candidate"
            ? 0.14
            : Math.max(style.fillOpacity, a.areaTypeCode === "3" ? 0.12 : 0.32);
        return {
          type: "Feature" as const,
          properties: {
            fid: areaFeatureId(a),
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

function buildStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          `${typeof window !== "undefined" ? window.location.origin : ""}/api/basemap/{z}/{x}/{y}`,
        ],
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
        id: "areas-hover-fill",
        type: "fill",
        source: "areas",
        filter: ["==", ["get", "fid"], ""],
        paint: {
          "fill-color": "#0ea5e9",
          "fill-opacity": 0.35,
        },
      },
      {
        id: "areas-hover-line",
        type: "line",
        source: "areas",
        filter: ["==", ["get", "fid"], ""],
        paint: {
          "line-color": "#0284c7",
          "line-width": 3.5,
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
      {
        id: "cand-hover-fill",
        type: "fill",
        source: "candidates",
        filter: ["==", ["get", "fid"], ""],
        paint: {
          "fill-color": "#0ea5e9",
          "fill-opacity": 0.4,
        },
      },
      {
        id: "cand-hover-line",
        type: "line",
        source: "candidates",
        filter: ["==", ["get", "fid"], ""],
        paint: {
          "line-color": "#0284c7",
          "line-width": 3.5,
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

function setHoverFilter(map: MapLibreMap, fid: string | null) {
  // Expression filter; cast avoids MapLibre's overloaded FilterSpecification unions.
  const filter = ["==", ["get", "fid"], fid ?? ""] as never;
  for (const id of [
    "areas-hover-fill",
    "areas-hover-line",
    "cand-hover-fill",
    "cand-hover-line",
  ]) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }
}

export function AreaMap({
  areas,
  candidates = [],
  focusId,
  hoverKey = null,
  selectedKey = null,
  onHoverKey,
  onSelectKey,
  layerVisibility,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const onHoverRef = useRef(onHoverKey);
  const onSelectRef = useRef(onSelectKey);
  onHoverRef.current = onHoverKey;
  onSelectRef.current = onSelectKey;
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

    const onMove = (e: MapLayerMouseEvent) => {
      const hit = e.features?.[0];
      const fid = (hit?.properties?.fid as string | undefined) ?? null;
      map.getCanvas().style.cursor = fid ? "pointer" : "";
      onHoverRef.current?.(fid);
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
      onHoverRef.current?.(null);
    };
    const onClick = (e: MapLayerMouseEvent) => {
      const hit = e.features?.[0];
      const fid = (hit?.properties?.fid as string | undefined) ?? null;
      if (fid) onSelectRef.current?.(fid);
    };
    map.on("mousemove", "areas-fill", onMove);
    map.on("mouseleave", "areas-fill", onLeave);
    map.on("click", "areas-fill", onClick);
    map.on("mousemove", "cand-fill", onMove);
    map.on("mouseleave", "cand-fill", onLeave);
    map.on("click", "cand-fill", onClick);

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
    if (!map || !readyRef.current) return;
    // Prefer live hover; fall back to persistent selection.
    setHoverFilter(map, hoverKey ?? selectedKey);
  }, [hoverKey, selectedKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const hit =
      visible.find((a) => a.id === focusId) ||
      candidates.find((a) => a.id === focusId);
    if (!hit || hit.coordinates.length < 1) return;
    const lons = hit.coordinates.map((c) => c[0]);
    const lats = hit.coordinates.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 9, duration: 600 },
    );
    onSelectRef.current?.(areaFeatureId(hit));
  }, [focusId, visible, candidates]);

  return <div ref={ref} className="h-full w-full min-h-[420px]" />;
}

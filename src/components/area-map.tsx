"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleFor } from "@/lib/areas/classify";
import { ensureOuterRingCcw } from "@/lib/areas/coords";
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

type HoverKey = string | string[] | null;

type Props = {
  areas: AreaRecord[];
  candidates?: AreaRecord[];
  focusId?: string | null;
  /** Designator ids (e.g. ESR791) — fit map to matching base/candidate polygons. */
  fitAreaIds?: string[] | null;
  hoverKey?: HoverKey;
  selectedKey?: string | null;
  onHoverKey?: (key: string | null) => void;
  onSelectKey?: (key: string | null) => void;
  /** Show existing LABELs and allow drag-nudge (never invents labels). */
  labelPlacer?: boolean;
  onLabelMove?: (fid: string, lat: number, lon: number) => void;
  layerVisibility: LayerVisibility;
};

function makeLabelEl(text: string, selected: boolean, edited: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "area-label-marker";
  el.textContent = text;
  el.style.cssText = [
    "padding:2px 6px",
    "font:600 11px/1.2 ui-sans-serif,system-ui,sans-serif",
    "color:#0f172a",
    "background:" + (edited ? "#fef3c7" : selected ? "#e0f2fe" : "rgba(255,255,255,0.92)"),
    "border:1px solid " + (selected ? "#0284c7" : edited ? "#d97706" : "#94a3b8"),
    "border-radius:4px",
    "box-shadow:0 1px 2px rgba(15,23,42,0.12)",
    "white-space:nowrap",
    "cursor:grab",
    "user-select:none",
    "pointer-events:auto",
  ].join(";");
  return el;
}

function normalizeKeys(key: HoverKey | undefined): string[] {
  if (key == null || key === "") return [];
  return Array.isArray(key) ? key.filter(Boolean) : [key];
}

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
        // Candidates slightly lighter so overlapping multi-area SUP fills stay readable.
        const fillOpacity =
          role === "candidate"
            ? 0.18
            : Math.max(style.fillOpacity, a.areaTypeCode === "3" ? 0.12 : 0.28);
        const ring = ensureOuterRingCcw(a.coordinates);
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
            coordinates: [ring],
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

function setHoverFilter(map: MapLibreMap, keys: string[]) {
  // Expression filter; cast avoids MapLibre's overloaded FilterSpecification unions.
  const filter = (
    keys.length === 0
      ? ["==", ["get", "fid"], ""]
      : keys.length === 1
        ? ["==", ["get", "fid"], keys[0]]
        : ["in", ["get", "fid"], ["literal", keys]]
  ) as never;
  for (const id of [
    "areas-hover-fill",
    "areas-hover-line",
    "cand-hover-fill",
    "cand-hover-line",
  ]) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }
}

function fitAreas(map: MapLibreMap, hits: AreaRecord[]) {
  const withCoords = hits.filter((a) => a.coordinates.length >= 1);
  if (!withCoords.length) return;
  const lons = withCoords.flatMap((a) => a.coordinates.map((c) => c[0]));
  const lats = withCoords.flatMap((a) => a.coordinates.map((c) => c[1]));
  map.fitBounds(
    [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ],
    { padding: 60, maxZoom: 9, duration: 600 },
  );
}

export function AreaMap({
  areas,
  candidates = [],
  focusId,
  fitAreaIds = null,
  hoverKey = null,
  selectedKey = null,
  onHoverKey,
  onSelectKey,
  labelPlacer = false,
  onLabelMove,
  layerVisibility,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const onHoverRef = useRef(onHoverKey);
  const onSelectRef = useRef(onSelectKey);
  const onLabelMoveRef = useRef(onLabelMove);
  const markersRef = useRef<Marker[]>([]);
  onHoverRef.current = onHoverKey;
  onSelectRef.current = onSelectKey;
  onLabelMoveRef.current = onLabelMove;
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
    const keys = normalizeKeys(hoverKey);
    setHoverFilter(map, keys.length ? keys : normalizeKeys(selectedKey));
  }, [hoverKey, selectedKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const hit =
      visible.find((a) => a.id === focusId) ||
      candidates.find((a) => a.id === focusId);
    if (!hit || hit.coordinates.length < 1) return;
    fitAreas(map, [hit]);
    onSelectRef.current?.(areaFeatureId(hit));
  }, [focusId, visible, candidates]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitAreaIds?.length) return;
    const want = new Set(fitAreaIds.map((id) => id.toUpperCase()));
    const hits = [...candidates, ...visible].filter((a) =>
      want.has(a.id.toUpperCase()),
    );
    fitAreas(map, hits);
  }, [fitAreaIds, visible, candidates]);

  // Label placer: only areas that already have a LABEL (never invent).
  useEffect(() => {
    const map = mapRef.current;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    if (!map || !readyRef.current || !labelPlacer) return;

    const labeled = visible.filter((a) => a.label);
    for (const a of labeled) {
      const fid = areaFeatureId(a);
      const text = (a.label!.text || a.name || a.id).toUpperCase();
      const el = makeLabelEl(text, selectedKey === fid, !!a.labelEdited);
      const marker = new Marker({ element: el, draggable: true })
        .setLngLat([a.label!.lon, a.label!.lat])
        .addTo(map);
      marker.on("dragstart", () => {
        el.style.cursor = "grabbing";
      });
      marker.on("dragend", () => {
        el.style.cursor = "grab";
        const { lng, lat } = marker.getLngLat();
        onLabelMoveRef.current?.(fid, lat, lng);
        onSelectRef.current?.(fid);
      });
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onSelectRef.current?.(fid);
      });
      markersRef.current.push(marker);
    }

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [labelPlacer, visible, selectedKey]);

  return <div ref={ref} className="h-full w-full min-h-[420px]" />;
}

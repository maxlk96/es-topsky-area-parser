"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl, type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyleFor } from "@/lib/areas/classify";
import type { AreaRecord } from "@/lib/areas/types";

type Props = {
  areas: AreaRecord[];
  candidates?: AreaRecord[];
  focusId?: string | null;
  showOther: boolean;
};

function toFeatureCollection(areas: AreaRecord[], role: "base" | "candidate") {
  return {
    type: "FeatureCollection" as const,
    features: areas
      .filter((a) => a.coordinates.length >= 3)
      .map((a) => {
        const style = mapStyleFor(a);
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
            fillOpacity: role === "candidate" ? 0.12 : style.fillOpacity,
            lineWidth: role === "candidate" ? 2.5 : style.lineWidth,
            dash: role === "candidate" ? 1 : 0,
          },
          geometry: {
            type: "Polygon" as const,
            coordinates: [a.coordinates],
          },
        };
      }),
  };
}

export function AreaMap({ areas, candidates = [], focusId, showOther }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const visible = areas.filter(
    (a) => a.mapDefaultVisible || (showOther && a.category === "OTHER"),
  );

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [16.5, 62.0],
      zoom: 4.2,
    });
    map.addControl(new NavigationControl(), "top-left");
    map.on("load", () => {
      map.addSource("areas", {
        type: "geojson",
        data: toFeatureCollection([], "base"),
      });
      map.addSource("candidates", {
        type: "geojson",
        data: toFeatureCollection([], "candidate"),
      });
      map.addLayer({
        id: "areas-fill",
        type: "fill",
        source: "areas",
        paint: {
          "fill-color": ["get", "fill"],
          "fill-opacity": ["get", "fillOpacity"],
        },
      });
      map.addLayer({
        id: "areas-line",
        type: "line",
        source: "areas",
        paint: {
          "line-color": ["get", "stroke"],
          "line-width": ["get", "lineWidth"],
        },
      });
      map.addLayer({
        id: "cand-fill",
        type: "fill",
        source: "candidates",
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.12,
        },
      });
      map.addLayer({
        id: "cand-line",
        type: "line",
        source: "candidates",
        paint: {
          "line-color": "#f59e0b",
          "line-width": 2.5,
          "line-dasharray": [2, 1],
        },
      });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      map?.once("load", () => {
        (map.getSource("areas") as GeoJSONSource | undefined)?.setData(
          toFeatureCollection(visible, "base"),
        );
        (map.getSource("candidates") as GeoJSONSource | undefined)?.setData(
          toFeatureCollection(candidates, "candidate"),
        );
      });
      return;
    }
    (map.getSource("areas") as GeoJSONSource | undefined)?.setData(
      toFeatureCollection(visible, "base"),
    );
    (map.getSource("candidates") as GeoJSONSource | undefined)?.setData(
      toFeatureCollection(candidates, "candidate"),
    );
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

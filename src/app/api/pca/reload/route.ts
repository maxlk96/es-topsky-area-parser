import { NextResponse } from "next/server";
import { fetchPcaEchartsAreas } from "@/lib/aip/parse-pca-echarts";

/**
 * Reload PCA + PCA sub-parts from vatiris echarts WFS (EXEA / EXES).
 * Client diffs against the loaded TopSky baseline; Accept preserves LABEL coords.
 */
export async function POST() {
  try {
    const { areas, mainCount, subCount } = await fetchPcaEchartsAreas();
    return NextResponse.json({
      areas,
      mainCount,
      subCount,
      total: areas.length,
      source: "vatiris_echarts",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PCA reload failed" },
      { status: 502 },
    );
  }
}

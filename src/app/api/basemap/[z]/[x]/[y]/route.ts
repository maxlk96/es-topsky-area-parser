import { NextResponse } from "next/server";

type Params = { params: Promise<{ z: string; x: string; y: string }> };

/**
 * Proxy CARTO light_nolabels rasters with server-side API key (Bearer).
 * Falls back to unauthenticated request if CARTO_API_KEY is unset
 * (may watermark); the map still loads.
 */
export async function GET(_req: Request, { params }: Params) {
  const { z, x, y } = await params;
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return NextResponse.json({ error: "bad tile" }, { status: 400 });
  }

  const key = process.env.CARTO_API_KEY?.trim();
  const upstream = `https://a.basemaps.cartocdn.com/light_nolabels/${z}/${x}/${y}@2x.png`;
  const headers: HeadersInit = {
    "User-Agent": "es-topsky-area-manager/0.1",
    Accept: "image/png,*/*",
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  try {
    const res = await fetch(upstream, {
      headers,
      // tiles are public CDN assets keyed per request
      cache: "force-cache",
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `upstream ${res.status}` },
        { status: 502 },
      );
    }
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "tile fetch failed" },
      { status: 500 },
    );
  }
}

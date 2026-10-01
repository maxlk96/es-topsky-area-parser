import { NextResponse } from "next/server";

const RAW =
  "https://raw.githubusercontent.com/Vatsim-Scandinavia/ESAA-Sectorfile/main/OTHER/TopSkyAreas.txt";

export async function GET() {
  try {
    const res = await fetch(RAW, { next: { revalidate: 300 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub fetch failed: ${res.status}` },
        { status: 502 },
      );
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "text/plain; charset=ISO-8859-1",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 500 },
    );
  }
}

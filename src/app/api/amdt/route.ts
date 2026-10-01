import { NextResponse } from "next/server";
import { eaipRoot, parseAmdtIndexHtml } from "@/lib/aip/amdt";

export async function GET() {
  try {
    const res = await fetch(`${eaipRoot()}/default_offline.html`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `LFV index ${res.status}` },
        { status: 502 },
      );
    }
    const html = await res.text();
    const entries = parseAmdtIndexHtml(html);
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}

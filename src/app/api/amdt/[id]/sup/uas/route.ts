import { NextResponse } from "next/server";
import { eaipRoot } from "@/lib/aip/amdt";
import { isUasOnlyText, mentionsUasActivity } from "@/lib/areas/classify";

type Ctx = { params: Promise<{ id: string }> };

/** Lightweight UAS probe of a SUP HTML body (for Scan auto-select). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const folder = decodeURIComponent(id);
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  try {
    const url =
      `${eaipRoot()}/` +
      folder.split("/").map(encodeURIComponent).join("/") +
      "/eSUP/" +
      path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `SUP fetch ${res.status}`,
          mentionsUas: false,
          uasOnly: false,
          url,
        },
        { status: 502 },
      );
    }
    const html = await res.text();
    return NextResponse.json({
      mentionsUas: mentionsUasActivity(html),
      /** Stricter — only drone-only SUPs stay deselected on Scan. */
      uasOnly: isUasOnlyText(html) && !/military aviation/i.test(html),
      htmlLength: html.length,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "failed",
        mentionsUas: false,
        uasOnly: false,
      },
      { status: 500 },
    );
  }
}

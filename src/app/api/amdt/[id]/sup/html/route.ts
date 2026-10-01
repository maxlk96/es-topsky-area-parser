import { NextResponse } from "next/server";
import { eaipRoot } from "@/lib/aip/amdt";

type Ctx = { params: Promise<{ id: string }> };

/** Same-origin HTML proxy for in-app SUP iframe (injects <base> for relative assets). */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const folder = decodeURIComponent(id);
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  try {
    const encodedFolder = folder.split("/").map(encodeURIComponent).join("/");
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const url = `${eaipRoot()}/${encodedFolder}/eSUP/${encodedPath}`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return new NextResponse(`SUP fetch failed (${res.status})`, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    let html = await res.text();
    // Directory of the HTML file so relative CSS/images resolve on LFV.
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const baseHref =
      `${eaipRoot()}/${encodedFolder}/eSUP/` +
      dir.split("/").map(encodeURIComponent).join("/");
    const baseTag = `<base href="${baseHref}" target="_self" />`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}\n`);
    } else {
      html = `${baseTag}\n${html}`;
    }
    // Drop scripts — not needed for reading the SUP, and they run as our origin.
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new NextResponse(
      e instanceof Error ? e.message : "failed",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }
}

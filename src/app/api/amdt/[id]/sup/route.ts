import { NextResponse } from "next/server";
import { eaipRoot } from "@/lib/aip/amdt";
import { parseSupHtml } from "@/lib/aip/parse-sup";

type Ctx = { params: Promise<{ id: string }> };

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
        { error: `SUP fetch ${res.status}`, url },
        { status: 502 },
      );
    }
    const html = await res.text();
    const areas = parseSupHtml(html, {
      amdtId: folder,
      supNumber: path.match(/(\d+-\d+)/)?.[1]?.replace("-", "/"),
      href: path,
    });
    return NextResponse.json({ url, areas, htmlLength: html.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}

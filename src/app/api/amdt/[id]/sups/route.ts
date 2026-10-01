import { NextResponse } from "next/server";
import { eaipRoot } from "@/lib/aip/amdt";
import { parseDatasourceSups } from "@/lib/aip/sup-catalogue";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const folder = decodeURIComponent(id);
  try {
    const url = `${eaipRoot()}/${folder.split("/").map(encodeURIComponent).join("/")}/v2/js/datasource.js`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `datasource.js ${res.status}`, url },
        { status: 502 },
      );
    }
    const js = await res.text();
    const sups = parseDatasourceSups(js);
    return NextResponse.json({
      folder,
      sups,
      areaSups: sups.filter((s) => s.likelyArea),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}

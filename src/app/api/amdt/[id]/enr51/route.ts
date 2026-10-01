import { NextResponse } from "next/server";
import { eaipRoot } from "@/lib/aip/amdt";
import { parseEnr51Html } from "@/lib/aip/parse-enr51";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const folder = decodeURIComponent(id);
  try {
    const url =
      `${eaipRoot()}/` +
      folder.split("/").map(encodeURIComponent).join("/") +
      "/eAIP/" +
      encodeURIComponent("ES-ENR 5.1-en-GB.html");
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `ENR 5.1 fetch ${res.status}`, url },
        { status: 502 },
      );
    }
    const html = await res.text();
    const areas = parseEnr51Html(html, { amdtId: folder });
    return NextResponse.json({
      url,
      areas,
      count: areas.length,
      htmlLength: html.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 },
    );
  }
}

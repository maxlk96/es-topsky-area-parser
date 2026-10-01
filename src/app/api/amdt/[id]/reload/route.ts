import { NextResponse } from "next/server";
import { eaipRoot } from "@/lib/aip/amdt";
import { parseEnr51Html } from "@/lib/aip/parse-enr51";
import { parseSupHtml } from "@/lib/aip/parse-sup";
import { mergeAipReloadCandidates } from "@/lib/aip/reload-aip";
import { parseDatasourceSups } from "@/lib/aip/sup-catalogue";
import { mentionsUasActivity } from "@/lib/areas/classify";
import type { AreaRecord } from "@/lib/areas/types";

type Ctx = { params: Promise<{ id: string }> };

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!items.length) return [];
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return out;
}

/**
 * Reload permanent ENR 5.1 R/D + likely tempo AIP SUPs for one AMDT.
 * Client diffs the merged list against the loaded TopSky baseline.
 * Does not mutate the working TopSky set — verify/diff only.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const folder = decodeURIComponent(id);
  const base =
    `${eaipRoot()}/` + folder.split("/").map(encodeURIComponent).join("/");

  try {
    const enrUrl = `${base}/eAIP/${encodeURIComponent("ES-ENR 5.1-en-GB.html")}`;
    const dsUrl = `${base}/v2/js/datasource.js`;

    const [enrRes, dsRes] = await Promise.all([
      fetch(enrUrl, { next: { revalidate: 3600 } }),
      fetch(dsUrl, { next: { revalidate: 3600 } }),
    ]);

    if (!enrRes.ok) {
      return NextResponse.json(
        { error: `ENR 5.1 fetch ${enrRes.status}`, url: enrUrl },
        { status: 502 },
      );
    }
    if (!dsRes.ok) {
      return NextResponse.json(
        { error: `datasource.js ${dsRes.status}`, url: dsUrl },
        { status: 502 },
      );
    }

    const enrHtml = await enrRes.text();
    const enr51 = parseEnr51Html(enrHtml, { amdtId: folder });

    const catalogueSups = parseDatasourceSups(await dsRes.text());
    const allAreaSups = catalogueSups.filter((s) => s.likelyArea);
    const supRows = allAreaSups.filter((s) => !mentionsUasActivity(s.subject));
    const skippedUasSubject = allAreaSups.length - supRows.length;

    const supResults = await mapPool(supRows, 4, async (row) => {
      try {
        const url =
          `${base}/eSUP/` + row.href.split("/").map(encodeURIComponent).join("/");
        const res = await fetch(url, { next: { revalidate: 3600 } });
        if (!res.ok) return [] as AreaRecord[];
        const html = await res.text();
        if (mentionsUasActivity(html) && !/military aviation/i.test(html)) {
          return [] as AreaRecord[];
        }
        return parseSupHtml(html, {
          amdtId: folder,
          supNumber: row.number,
          href: row.href,
        });
      } catch {
        return [] as AreaRecord[];
      }
    });

    const supAreas = supResults.flat();
    const areas = mergeAipReloadCandidates(enr51, supAreas);

    return NextResponse.json({
      folder,
      enr51Count: enr51.length,
      supParsed: supAreas.length,
      supScanned: supRows.length,
      skippedUasSubject,
      /** Full AMDT SUP catalogue (for dropping tempo SUPs no longer published). */
      catalogueSups,
      areas,
      count: areas.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "reload failed" },
      { status: 500 },
    );
  }
}

import type { SupCatalogueRow } from "@/lib/areas/types";

const AREA_SUBJECT =
  /temporary\s+(restricted|danger)\s+area|tillfälligt\s+(restriktions|farligt)\s*område|\bESR\d|\bESD\d/i;

function clean(s: string): string {
  return s.replace(/\\n/g, " ").replace(/\\t/g, " ").replace(/\s+/g, " ").trim();
}

/** Parse SUP rows from LFV datasource.js object literals. */
export function parseDatasourceSups(jsText: string): SupCatalogueRow[] {
  const rows: SupCatalogueRow[] = [];
  const seen = new Set<string>();

  // Each SUP entry roughly: "year": { ... "href": "AIP SUP …" ... }, ... "subject": { "text": "…" }
  const blockRe =
    /"year"\s*:\s*\{[\s\S]*?"href"\s*:\s*"(AIP SUP [^"]+)"[\s\S]*?"text"\s*:\s*"(AIP SUP [^"]*)"[\s\S]*?\}\s*,\s*"affects"[\s\S]*?"period"\s*:\s*\{[\s\S]*?"text"\s*:\s*"([^"]*)"[\s\S]*?"subject"\s*:\s*\{[\s\S]*?"text"\s*:\s*"([^"]*)"/gi;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(jsText))) {
    const href = m[1].replace(/#.*$/, "");
    const label = clean(m[2]);
    const period = clean(m[3]);
    const subject = clean(m[4]);
    // Prefer English
    if (/sv-SE/i.test(href)) continue;
    const number =
      label.match(/AIP SUP\s+(\d+\/\d+)/i)?.[1] ||
      href.match(/AIP SUP\s+(\d+)-(\d+)/i)?.[0]?.replace(/AIP SUP\s+/i, "").replace("-", "/") ||
      href;
    const numNorm = typeof number === "string" && number.includes("-")
      ? number.replace(/^(\d+)-(\d+)$/, "$1/$2")
      : String(number).replace(/^AIP SUP\s+/i, "").replace(/^(\d+)-(\d+).*/, "$1/$2");

    const key = href;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      number: numNorm,
      href,
      period,
      subject,
      likelyArea: AREA_SUBJECT.test(subject),
    });
  }

  // Fallback looser pairing if structured regex missed
  if (!rows.length) {
    for (const hit of jsText.matchAll(
      /"href"\s*:\s*"(AIP SUP [^"]*en-GB\.html(?:#[^"]*)?)"/gi,
    )) {
      const href = hit[1].replace(/#.*$/, "");
      if (seen.has(href)) continue;
      seen.add(href);
      const nearby = jsText.slice(hit.index, hit.index + 1200);
      const subject = clean(
        nearby.match(/"subject"\s*:\s*\{\s*"text"\s*:\s*"([^"]*)"/)?.[1] ?? href,
      );
      const number = href.match(/AIP SUP\s+(\d+)-(\d+)/i);
      rows.push({
        number: number ? `${number[1]}/${number[2]}` : href,
        href,
        period: "",
        subject,
        likelyArea: AREA_SUBJECT.test(subject),
      });
    }
  }

  return rows.sort((a, b) => Number(b.likelyArea) - Number(a.likelyArea));
}

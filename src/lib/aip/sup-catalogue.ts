import type { SupCatalogueRow } from "@/lib/areas/types";

const AREA_SUBJECT =
  /temporary\s+(restricted|danger)\s+area|tillfälligt\s+(restriktions|farligt)\s*område|\bESR\d|\bESD\d|restricted area|danger area/i;

export function parseDatasourceSups(jsText: string): SupCatalogueRow[] {
  const rows: SupCatalogueRow[] = [];
  // Match subject + nearby href/period loosely
  const subjectBlocks = [
    ...jsText.matchAll(
      /"href"\s*:\s*"(AIP SUP [^"]+\.html(?:#[^"]*)?)"[\s\S]{0,400}?"(?:text|subject)"\s*:\s*"([^"]*)"/gi,
    ),
  ];
  const altBlocks = [
    ...jsText.matchAll(
      /"subject"\s*:\s*\{\s*"text"\s*:\s*"([^"]*)"[\s\S]{0,200}?"href"\s*:\s*"(AIP SUP [^"]+)"/gi,
    ),
  ];

  const seen = new Set<string>();

  function add(href: string, subjectRaw: string, period = "") {
    const subject = subjectRaw.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    const numberMatch = href.match(/AIP SUP\s+(\d+-\d+)/i) || subject.match(/SUP\s+(\d+\/\d+)/i);
    const number = numberMatch
      ? numberMatch[1].replace("-", "/")
      : href;
    const key = href + subject;
    if (seen.has(key)) return;
    seen.add(key);
    // Prefer English SUP pages
    if (/sv-SE/i.test(href) && jsText.includes(href.replace("sv-SE", "en-GB"))) return;
    rows.push({
      number,
      href: href.replace(/#.*$/, ""),
      period,
      subject,
      likelyArea: AREA_SUBJECT.test(subject),
    });
  }

  for (const m of subjectBlocks) add(m[1], m[2]);
  for (const m of altBlocks) add(m[2], m[1]);

  // Broader fallback: any AIP SUP en-GB href with nearby Temporary
  if (!rows.length) {
    for (const m of jsText.matchAll(/"href"\s*:\s*"(AIP SUP [^"]*en-GB\.html)"/gi)) {
      add(m[1], m[1]);
    }
  }

  // Deduplicate by number preferring en-GB + likelyArea
  const byNum = new Map<string, SupCatalogueRow>();
  for (const r of rows) {
    const prev = byNum.get(r.number);
    if (!prev || (r.likelyArea && !prev.likelyArea) || (/en-GB/.test(r.href) && !/en-GB/.test(prev.href))) {
      byNum.set(r.number, r);
    }
  }
  return [...byNum.values()].sort((a, b) => Number(b.likelyArea) - Number(a.likelyArea));
}

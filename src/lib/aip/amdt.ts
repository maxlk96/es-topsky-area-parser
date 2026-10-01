import type { AmdtEntry } from "@/lib/areas/types";

const EAIP_ROOT = "https://www.aro.lfv.se/content/eaip";

export function eaipRoot(): string {
  return EAIP_ROOT;
}

/** Parse default_offline.html tables into AMDT entries. */
export function parseAmdtIndexHtml(html: string): AmdtEntry[] {
  const entries: AmdtEntry[] = [];
  // Folders are linked as ./AIP%20AMDT%20.../ or similar
  const linkRe =
    /href="\.\/([^"]+?)\/(?:index\.html)?"[^>]*>[\s\S]*?<\/a>/gi;
  // Simpler: find folder names in hrefs
  const folders = new Set<string>();
  for (const m of html.matchAll(/href="\.\/(AIP[^"\/]+|AIRAC[^"\/]+)\/?/gi)) {
    folders.add(decodeURIComponent(m[1]));
  }

  // Parse table rows: Effective | Publication | Reason
  const sections: { kind: AmdtEntry["kind"]; chunk: string }[] = [];
  const current = html.split(/Currently Effective Issue/i)[1]?.split(/Next Issues/i)[0];
  const next = html.split(/Next Issues/i)[1]?.split(/Expired Issues/i)[0];
  const archive = html.split(/Expired Issues/i)[1];
  if (current) sections.push({ kind: "current", chunk: current });
  if (next) sections.push({ kind: "next", chunk: next });
  if (archive) sections.push({ kind: "archive", chunk: archive.slice(0, 8000) });

  for (const { kind, chunk } of sections) {
    const rowRe =
      /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match: RegExpExecArray | null;
    while ((match = rowRe.exec(chunk))) {
      const effectiveDate = stripTags(match[1]);
      const publicationDate = stripTags(match[2]);
      const reason = stripTags(match[3]);
      if (!/AMDT|AIRAC/i.test(reason) && !/\d{4}/.test(effectiveDate)) continue;
      const folder = guessFolder(reason, effectiveDate, [...folders]);
      if (!folder) continue;
      entries.push({
        id: folder,
        title: reason,
        effectiveDate,
        publicationDate,
        reason,
        kind,
        folder,
      });
    }
  }

  // Fallback: just list folders from links if tables failed
  if (!entries.length) {
    for (const folder of folders) {
      entries.push({
        id: folder,
        title: folder,
        effectiveDate: "",
        publicationDate: "",
        reason: folder,
        kind: "archive",
        folder,
      });
    }
  }
  return entries;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function guessFolder(reason: string, effective: string, folders: string[]): string | null {
  // AIP AMDT 1/2026 → AIP AMDT 1-2026_2026_08_07
  const m = reason.match(/AIP AMDT\s+(\d+)\/(\d{4})/i);
  if (m) {
    const needle = `AMDT ${m[1]}-${m[2]}`;
    const hit = folders.find((f) => f.includes(needle.replace(" ", " ")) || f.includes(`${m[1]}-${m[2]}`));
    if (hit) return hit;
  }
  const airac = reason.match(/AIRAC AIP AMDT\s+(\d+)\/(\d{4})/i);
  if (airac) {
    const hit = folders.find((f) => f.includes(`${airac[1]}-${airac[2]}`) || f.includes(`AMDT ${airac[1]}`));
    if (hit) return hit;
  }
  // date-based
  const d = effective.match(/(\d{2})\s+(\w{3})\s+(\d{4})/i);
  if (d) {
    const months: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const mm = months[d[2].toUpperCase()];
    if (mm) {
      const stamp = `${d[3]}_${mm}_${d[1]}`;
      const hit = folders.find((f) => f.includes(stamp));
      if (hit) return hit;
    }
  }
  return folders[0] ?? null;
}

export function amdtDatasourceUrl(folder: string): string {
  return `${EAIP_ROOT}/${encodeURIComponent(folder).replace(/%20/g, "%20")}/v2/js/datasource.js`;
}

export function amdtSupUrl(folder: string, href: string): string {
  const base = `${EAIP_ROOT}/${folder.split("/").map(encodeURIComponent).join("/")}/eSUP/`;
  return base + href.split("/").map(encodeURIComponent).join("/");
}

import type { AmdtEntry } from "@/lib/areas/types";

const EAIP_ROOT = "https://www.aro.lfv.se/content/eaip";

export function eaipRoot(): string {
  return EAIP_ROOT;
}

/** Parse default_offline.html tables into AMDT entries. */
export function parseAmdtIndexHtml(html: string): AmdtEntry[] {
  const entries: AmdtEntry[] = [];

  const sections: { kind: AmdtEntry["kind"]; chunk: string }[] = [];
  const current = html.split(/Currently Effective Issue/i)[1]?.split(/Next Issues/i)[0];
  const next = html.split(/Next Issues/i)[1]?.split(/Expired Issues/i)[0];
  const archive = html.split(/Expired Issues/i)[1];
  if (current) sections.push({ kind: "current", chunk: current });
  if (next) sections.push({ kind: "next", chunk: next });
  if (archive) sections.push({ kind: "archive", chunk: archive });

  for (const { kind, chunk } of sections) {
    // href="AIP AMDT 1-2026_2026_08_07\index-v2.html" (backslash path)
    const rowRe =
      /href="((?:AIRAC\s+)?AIP\s+AMDT[^"\\]+)[\\/][^"]*"[\s\S]*?<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    let match: RegExpExecArray | null;
    while ((match = rowRe.exec(chunk))) {
      const folder = decodeURIComponent(match[1].trim());
      // Effective date is inside the <a>…</a> before first </td> — recover from earlier slice
      const before = chunk.slice(Math.max(0, match.index - 200), match.index + match[0].length);
      const eff = before.match(/>(\d{2}\s+\w{3}\s+\d{4})</)?.[1] ?? "";
      const publicationDate = stripTags(match[2]);
      const reason = stripTags(match[3]);
      entries.push({
        id: folder,
        title: reason || folder,
        effectiveDate: eff,
        publicationDate,
        reason: reason || folder,
        kind,
        folder,
      });
    }
  }

  // Fallback: any AMDT folder hrefs
  if (!entries.length) {
    for (const m of html.matchAll(
      /href="((?:AIRAC\s+)?AIP\s+AMDT[^"\\]+)[\\/][^"]*"/gi,
    )) {
      const folder = m[1].trim();
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

export function amdtDatasourceUrl(folder: string): string {
  return `${EAIP_ROOT}/${folder.split("/").map(encodeURIComponent).join("/")}/v2/js/datasource.js`;
}

export function amdtSupUrl(folder: string, href: string): string {
  const base = `${EAIP_ROOT}/${folder.split("/").map(encodeURIComponent).join("/")}/eSUP/`;
  return base + href.split("/").map(encodeURIComponent).join("/");
}

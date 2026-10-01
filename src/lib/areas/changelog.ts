import { explainAreaChanges } from "./diff";
import { normalizeDesignator } from "./names";
import type { AreaRecord } from "./types";

export type ChangelogEntry = {
  id: string;
  name: string;
  notes?: string[];
};

export type ExportChangelog = {
  new: ChangelogEntry[];
  changed: ChangelogEntry[];
  removed: ChangelogEntry[];
};

function label(area: AreaRecord): ChangelogEntry {
  return {
    id: normalizeDesignator(area.id),
    name: (area.name || area.shortName || area.id).trim(),
  };
}

/**
 * Compare the export working set against the originally loaded baseline.
 * Used for the companion TopSkyAreas-changelog.txt download.
 */
export function buildExportChangelog(
  baseline: AreaRecord[],
  working: AreaRecord[],
): ExportChangelog {
  const baseById = new Map(
    baseline.map((a) => [normalizeDesignator(a.id), a]),
  );
  const workById = new Map(
    working.map((a) => [normalizeDesignator(a.id), a]),
  );

  const neu: ChangelogEntry[] = [];
  const changed: ChangelogEntry[] = [];
  const removed: ChangelogEntry[] = [];

  for (const [id, area] of workById) {
    const prev = baseById.get(id);
    if (!prev) {
      neu.push(label(area));
      continue;
    }
    const notes = explainAreaChanges(prev, area);
    if (notes.length) {
      changed.push({ ...label(area), notes });
    }
  }

  for (const [id, area] of baseById) {
    if (!workById.has(id)) {
      removed.push(label(area));
    }
  }

  const byId = (a: ChangelogEntry, b: ChangelogEntry) =>
    a.id.localeCompare(b.id);
  return {
    new: neu.sort(byId),
    changed: changed.sort(byId),
    removed: removed.sort(byId),
  };
}

/** Plain-text companion file next to TopSkyAreas.txt. */
export function formatExportChangelogText(
  log: ExportChangelog,
  opts?: { baselineKind?: string; generatedAt?: Date },
): string {
  const when = (opts?.generatedAt ?? new Date()).toISOString();
  const source = opts?.baselineKind
    ? `Baseline: ${opts.baselineKind}`
    : "Baseline: loaded TopSkyAreas";
  const lines: string[] = [
    "ES-TopSky Area Parser — export changelog",
    source,
    `Generated: ${when}`,
    "",
  ];

  const section = (title: string, rows: ChangelogEntry[]) => {
    lines.push(`## ${title} (${rows.length})`);
    if (!rows.length) {
      lines.push("(none)");
    } else {
      for (const r of rows) {
        const note =
          r.notes && r.notes.length ? ` — ${r.notes.join("; ")}` : "";
        lines.push(`${r.id}  ${r.name}${note}`);
      }
    }
    lines.push("");
  };

  section("New", log.new);
  section("Changed", log.changed);
  section("Removed", log.removed);
  return lines.join("\n").replace(/\n*$/, "\n");
}

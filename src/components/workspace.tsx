"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const AreaMap = dynamic(
  () => import("@/components/area-map").then((m) => m.AreaMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Loading map…
      </div>
    ),
  },
);
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { diffCandidates } from "@/lib/areas/diff";
import { mentionsUasActivity } from "@/lib/areas/classify";
import { parseTopSkyBuffer, parseTopSkyText } from "@/lib/areas/parse-topsky";
import { encodeLatin1, mergeTempoSection } from "@/lib/areas/write-topsky";
import type {
  AmdtEntry,
  AreaRecord,
  DiffItem,
  SupCatalogueRow,
} from "@/lib/areas/types";
import {
  DEFAULT_LAYER_VISIBILITY,
  LAYER_GROUPS,
  areaFeatureId,
  countByLayerKey,
  groupToggleState,
  isLayerVisible,
  type LayerGroup,
  type LayerKey,
  type LayerVisibility,
} from "@/lib/areas/map-layers";

type BaselineKind = "github" | "local";

type SupViewer = {
  folder: string;
  href: string;
  label: string;
};

type HoverKey = string | string[] | null;

function supViewerSrc(viewer: SupViewer): string {
  return (
    `/api/amdt/${encodeURIComponent(viewer.folder)}/sup/html` +
    `?path=${encodeURIComponent(viewer.href)}`
  );
}

function designatorsFromText(text: string): string[] {
  const hits = text.toUpperCase().match(/\bES[RD]\d{2,4}[A-Z]?\b/g) ?? [];
  return [...new Set(hits)];
}

/** Areas/candidates linked to a catalogue SUP (by designator in subject or provenance). */
function areasForCatalogueSup(
  s: SupCatalogueRow,
  areas: AreaRecord[],
  candidates: AreaRecord[],
): AreaRecord[] {
  const ids = new Set(designatorsFromText(`${s.subject} ${s.number}`));
  const supNum = s.number;
  const href = s.href;
  const out: AreaRecord[] = [];
  const seen = new Set<string>();
  for (const a of [...candidates, ...areas]) {
    const byId = ids.has(a.id.toUpperCase());
    const byProv =
      a.provenance.href === href ||
      a.provenance.supNumber === supNum ||
      (!!a.provenance.supNumber &&
        href.includes(a.provenance.supNumber.replace("/", "-")));
    if (!byId && !byProv) continue;
    const fid = areaFeatureId(a);
    if (seen.has(fid)) continue;
    seen.add(fid);
    out.push(a);
  }
  return out;
}

function hoverIncludes(hoverKey: HoverKey, fid: string): boolean {
  if (hoverKey == null) return false;
  return Array.isArray(hoverKey) ? hoverKey.includes(fid) : hoverKey === fid;
}

export function Workspace() {
  const [baselineKind, setBaselineKind] = useState<BaselineKind>("github");
  const [rawText, setRawText] = useState("");
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [encoding, setEncoding] = useState("latin1");
  const [loading, setLoading] = useState(false);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>(
    DEFAULT_LAYER_VISIBILITY,
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [fitAreaIds, setFitAreaIds] = useState<string[] | null>(null);
  const [hoverKey, setHoverKey] = useState<HoverKey>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [supViewer, setSupViewer] = useState<SupViewer | null>(null);

  const showSupViewer = useCallback(
    (folder: string | undefined, href: string | undefined, label: string) => {
      if (!folder || !href) return;
      setSupViewer((prev) => {
        if (prev && prev.folder === folder && prev.href === href) return prev;
        return { folder, href, label };
      });
    },
    [],
  );

  // When an area is selected from the map, scroll it into view in the list.
  useEffect(() => {
    if (!selectedKey) return;
    const el = document.querySelector(`[data-area-fid="${CSS.escape(selectedKey)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedKey]);

  const [amdts, setAmdts] = useState<AmdtEntry[]>([]);
  const [amdtId, setAmdtId] = useState("");
  const [sups, setSups] = useState<SupCatalogueRow[]>([]);
  const [selectedSups, setSelectedSups] = useState<Record<string, boolean>>({});
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [candidates, setCandidates] = useState<AreaRecord[]>([]);

  const setLayerVisible = useCallback((key: LayerKey, on: boolean) => {
    setLayerVisibility((prev) => ({ ...prev, [key]: on === true }));
  }, []);

  const setGroupVisible = useCallback((group: LayerGroup, on: boolean) => {
    setLayerVisibility((prev) => {
      const next = { ...prev };
      for (const t of group.toggles) next[t.key] = on;
      return next;
    });
  }, []);

  const visibleList = useMemo(() => {
    const q = filter.trim().toUpperCase();
    return areas.filter((a) => {
      if (!isLayerVisible(a, layerVisibility)) return false;
      if (!q) return true;
      return (
        a.id.includes(q) ||
        a.name.toUpperCase().includes(q) ||
        a.shortName.toUpperCase().includes(q)
      );
    });
  }, [areas, filter, layerVisibility]);

  const loadGitHub = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/topsky");
      if (!res.ok) throw new Error(await res.text());
      const parsed = parseTopSkyBuffer(await res.arrayBuffer());
      setRawText(parsed.rawText);
      setAreas(parsed.areas);
      setEncoding(parsed.encoding);
      setBaselineKind("github");
      setDiffs([]);
      setCandidates([]);
      toast.success(`Loaded GitHub main — ${parsed.areas.length} areas`);
      if (parsed.errors.length) toast.message(`${parsed.errors.length} parse warnings`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const onLocalFile = async (file: File | null) => {
    if (!file) return;
    setLoading(true);
    try {
      const parsed = parseTopSkyBuffer(await file.arrayBuffer());
      setRawText(parsed.rawText);
      setAreas(parsed.areas);
      setEncoding(parsed.encoding);
      setBaselineKind("local");
      setDiffs([]);
      setCandidates([]);
      toast.success(`Loaded local file — ${parsed.areas.length} areas`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setLoading(false);
    }
  };

  const loadAmdts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/amdt");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AMDT failed");
      setAmdts(data.entries);
      const current = data.entries.find((e: AmdtEntry) => e.kind === "current");
      if (current) setAmdtId(current.folder);
      toast.success(`${data.entries.length} AMDT entries`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AMDT failed");
    } finally {
      setLoading(false);
    }
  };

  const scanSups = async () => {
    if (!amdtId) {
      toast.error("Pick an AMDT first");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/amdt/${encodeURIComponent(amdtId)}/sups`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "SUP catalogue failed");
      const list: SupCatalogueRow[] = data.areaSups?.length ? data.areaSups : data.sups;
      setSups(list);
      // Auto-check likely-area SUPs newest-first, but skip any with UAS/UAV/BVLOS
      // in the subject *or* SUP body (e.g. 101/2026 — UAS only in the description).
      const likelyRows = list.filter((x: SupCatalogueRow) => x.likelyArea);
      const decisions = await Promise.all(
        likelyRows.map(async (s) => {
          if (mentionsUasActivity(s.subject)) {
            return { href: s.href, auto: false as const };
          }
          try {
            const probe = await fetch(
              `/api/amdt/${encodeURIComponent(amdtId)}/sup/uas?path=${encodeURIComponent(s.href)}`,
            );
            const body = (await probe.json()) as { mentionsUas?: boolean };
            if (probe.ok && body.mentionsUas) {
              return { href: s.href, auto: false as const };
            }
          } catch {
            // Network glitch — keep subject-clean SUPs eligible.
          }
          return { href: s.href, auto: true as const };
        }),
      );
      const sel: Record<string, boolean> = {};
      let auto = 0;
      let skippedUas = 0;
      for (const d of decisions) {
        if (d.auto) {
          sel[d.href] = true;
          auto += 1;
        } else {
          skippedUas += 1;
        }
      }
      setSelectedSups(sel);
      toast.success(
        skippedUas
          ? `${likelyRows.length} area SUPs · auto-selected ${auto} (skipped ${skippedUas} with UAS/UAV/BVLOS)`
          : `${likelyRows.length} area SUPs · auto-selected ${auto}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  };

  const parseSelected = async () => {
    if (!amdtId) return;
    const hrefs = Object.entries(selectedSups)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!hrefs.length) {
      toast.error("Select at least one SUP");
      return;
    }
    setLoading(true);
    try {
      const found: AreaRecord[] = [];
      for (const path of hrefs) {
        const res = await fetch(
          `/api/amdt/${encodeURIComponent(amdtId)}/sup?path=${encodeURIComponent(path)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          toast.message(`Skip ${path}: ${data.error}`);
          continue;
        }
        found.push(...(data.areas as AreaRecord[]));
      }
      setCandidates(found.filter((a) => a.coordinates.length >= 3 || a.boundCircle));
      const items = diffCandidates(areas, found);
      setDiffs(items);
      toast.success(`Parsed ${found.length} candidate areas → ${items.length} diff rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setLoading(false);
    }
  };

  const acceptDiff = (item: DiffItem) => {
    if (item.status === "excluded" || item.status === "duplicate_of_sup") return;
    if (item.status === "present") return;
    const next = [...areas];
    const idx = next.findIndex((a) => a.id.toUpperCase() === item.candidate.id.toUpperCase());
    const accepted: AreaRecord = {
      ...item.candidate,
      section: "tempo",
      mapDefaultVisible: true,
    };
    if (idx >= 0) next[idx] = accepted;
    else next.unshift(accepted);
    setAreas(next);
    setDiffs((d) => d.filter((x) => x.candidate.id !== item.candidate.id));
    toast.success(`Accepted ${item.candidate.id}`);
  };

  const exportFile = () => {
    if (!rawText) {
      toast.error("Load a baseline first");
      return;
    }
    // Refresh raw for topsky-preserved blocks from current parse of working set is tricky;
    // merge using working areas + original text.
    const merged = mergeTempoSection(rawText, areas);
    // Keep encoding consistent — re-parse merge into latin1 download
    const out = parseTopSkyText(merged, encoding);
    void out;
    const buf = encodeLatin1(merged);
    const blob = new Blob([Uint8Array.from(buf)], {
      type: "text/plain;charset=ISO-8859-1",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "TopSkyAreas.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported TopSkyAreas.txt (Latin-1)");
  };

  const counts = useMemo(() => {
    const byLayer = countByLayerKey(areas);
    let tempo = 0;
    for (const a of areas) if (a.section === "tempo") tempo++;
    return { ...byLayer, tempo };
  }, [areas]);

  return (
    <div className="flex h-dvh flex-col bg-[radial-gradient(1200px_600px_at_10%_-10%,#dbeafe_0%,transparent_55%),radial-gradient(900px_500px_at_90%_0%,#fee2e2_0%,transparent_50%),#f8fafc] text-slate-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight text-slate-900">
            ES-Topsky Area Manager
          </p>
          <p className="text-xs text-slate-500">
            Baseline: {baselineKind === "github" ? "GitHub main" : "Local file"} · {encoding} ·{" "}
            {areas.length} areas
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={loadGitHub} disabled={loading}>
            Load GitHub
          </Button>
          <Label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-slate-600">Local</span>
            <Input
              type="file"
              accept=".txt,text/plain"
              className="max-w-[220px]"
              onChange={(e) => onLocalFile(e.target.files?.[0] ?? null)}
            />
          </Label>
          <Button size="sm" variant="secondary" onClick={exportFile} disabled={!areas.length}>
            Export
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr_340px]">
        <aside className="flex min-h-0 flex-col gap-3 border-r border-slate-200/80 bg-white/70 p-3">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              AIP AMDT / SUPs
            </p>
            <Button size="sm" variant="outline" className="w-full" onClick={loadAmdts} disabled={loading}>
              Fetch AMDT list
            </Button>
            <select
              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
              value={amdtId}
              onChange={(e) => setAmdtId(e.target.value)}
            >
              <option value="">Select AMDT…</option>
              {amdts.map((a) => (
                <option key={a.folder + a.kind} value={a.folder}>
                  [{a.kind}] {a.title || a.folder}
                </option>
              ))}
            </select>
            <Button size="sm" className="w-full" onClick={scanSups} disabled={!amdtId || loading}>
              Scan SUPs for areas
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={parseSelected}
              disabled={!sups.length || loading}
            >
              Parse selected → diff
            </Button>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 pr-2">
              {sups.filter((s) => s.likelyArea).map((s) => (
                <div
                  key={s.href}
                  className={`flex items-start gap-2 rounded-md border border-transparent px-1 py-1 hover:border-slate-200 hover:bg-white ${
                    supViewer?.href === s.href
                      ? "border-sky-200 bg-sky-50/80"
                      : ""
                  }`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={!!selectedSups[s.href]}
                    onCheckedChange={(v) =>
                      setSelectedSups((prev) => ({ ...prev, [s.href]: !!v }))
                    }
                    aria-label={`Select SUP ${s.number}`}
                  />
                  <div className="min-w-0 flex-1 text-xs leading-snug">
                    <button
                      type="button"
                      className="font-medium text-sky-800 underline decoration-sky-300/80 underline-offset-2 hover:bg-sky-50"
                      title="Hover to open SUP preview"
                      onMouseEnter={() =>
                        showSupViewer(amdtId, s.href, `SUP ${s.number}`)
                      }
                    >
                      {s.number}
                    </button>{" "}
                    <span
                      className="cursor-default text-slate-600 hover:bg-amber-50 hover:text-slate-800"
                      title="Hover to highlight related area(s) on the map"
                      onMouseEnter={() => {
                        const related = areasForCatalogueSup(
                          s,
                          areas,
                          candidates,
                        );
                        if (!related.length) {
                          const ids = designatorsFromText(s.subject);
                          setHoverKey(null);
                          if (ids.length) setFitAreaIds(ids);
                          return;
                        }
                        setHoverKey(related.map(areaFeatureId));
                        setFitAreaIds(related.map((a) => a.id));
                      }}
                      onMouseLeave={() => setHoverKey(null)}
                    >
                      {s.subject.slice(0, 90)}
                    </span>
                  </div>
                </div>
              ))}
              {!sups.length && (
                <p className="text-xs text-slate-500">
                  Load an AMDT and scan SUPs to list temporary R/D candidates.
                </p>
              )}
            </div>
          </ScrollArea>
          <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
            <Badge variant="secondary">tempo {counts.tempo}</Badge>
            <Badge variant="secondary">R {counts.R}</Badge>
            <Badge variant="secondary">D {counts.D}</Badge>
            <Badge variant="secondary">TRA {counts.TRA}</Badge>
            <Badge variant="secondary">CBA {counts.CBA}</Badge>
            <Badge variant="outline">FS {counts.FS}</Badge>
            <Badge variant="outline">TCT {counts.TCT}</Badge>
            <Badge variant="outline">misc {counts.OTHER}</Badge>
          </div>
        </aside>

        <main className="relative min-h-[50vh] min-w-0">
          <AreaMap
            areas={areas}
            candidates={candidates}
            focusId={focusId}
            fitAreaIds={fitAreaIds}
            hoverKey={hoverKey}
            selectedKey={selectedKey}
            onHoverKey={setHoverKey}
            onSelectKey={setSelectedKey}
            layerVisibility={layerVisibility}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-600 shadow">
            Red/gray = R/D 4F · Light fill + red border = R/D 3 · Yellow = TRA/PCA/CBA · Amber dashed = SUP candidate
          </div>
          {supViewer && (
            <div className="absolute inset-3 z-20 flex flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                  {supViewer.label}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSupViewer(null)}
                >
                  Close
                </Button>
              </div>
              <iframe
                key={supViewerSrc(supViewer)}
                title={supViewer.label}
                src={supViewerSrc(supViewer)}
                className="min-h-0 w-full flex-1 bg-white"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
              />
            </div>
          )}
        </main>

        <aside className="flex min-h-0 flex-col gap-3 border-l border-slate-200/80 bg-white/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Areas</p>
          <div className="max-h-[42%] space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Map layers
            </p>
            {LAYER_GROUPS.map((group) => {
              const gState = groupToggleState(group, layerVisibility);
              const groupCount = group.toggles.reduce(
                (n, t) => n + (counts[t.key] ?? 0),
                0,
              );
              return (
                <div
                  key={group.id}
                  className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5"
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800">
                        {group.title}{" "}
                        <span className="font-normal text-slate-400">
                          ({groupCount})
                        </span>
                      </p>
                      <p className="text-[10px] leading-snug text-slate-500">
                        {group.hint}
                      </p>
                    </div>
                    <Checkbox
                      checked={gState === "all"}
                      indeterminate={gState === "some"}
                      onCheckedChange={(value) =>
                        setGroupVisible(group, value === true)
                      }
                      aria-label={`Show group ${group.title}`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {group.toggles.map(({ key, label }) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="text-xs text-slate-700">
                          {label}{" "}
                          <span className="text-slate-400">
                            ({counts[key] ?? 0})
                          </span>
                        </span>
                        <Checkbox
                          checked={layerVisibility[key] === true}
                          onCheckedChange={(value) =>
                            setLayerVisible(key, value === true)
                          }
                          aria-label={`Show ${label} on map`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <Input
            placeholder="Filter id / name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ScrollArea className="h-[34%] min-h-[140px] rounded-md border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100 text-sm">
              {visibleList.slice(0, 400).map((a) => {
                const fid = areaFeatureId(a);
                const hovered = hoverIncludes(hoverKey, fid);
                const selected = selectedKey === fid;
                return (
                <li key={fid}>
                  <button
                    type="button"
                    data-area-fid={fid}
                    className={`flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-sky-50 ${
                      selected
                        ? "bg-sky-100 ring-1 ring-inset ring-sky-400"
                        : hovered
                          ? "bg-sky-50 ring-1 ring-inset ring-sky-300"
                          : ""
                    }`}
                    onClick={() => {
                      setSelectedKey(fid);
                      setFocusId(a.id);
                    }}
                    onMouseEnter={() => setHoverKey(fid)}
                    onMouseLeave={() => setHoverKey(null)}
                  >
                    <Badge
                      variant={a.areaTypeCode === "3" ? "outline" : "secondary"}
                      className="shrink-0"
                    >
                      {a.areaTypeCode}
                    </Badge>
                    <span>
                      <span className="font-medium">{a.id}</span>{" "}
                      <span className="text-slate-600">{a.name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {a.category}
                        {a.limits ? ` · ${a.limits[0]}:${a.limits[1]}` : ""}
                        {a.noaiw ? " · NOAIW" : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
              })}
            </ul>
          </ScrollArea>

          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Verify / diff
          </p>
          <ScrollArea className="min-h-0 flex-1 rounded-md border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100 text-sm">
              {diffs.map((d) => {
                const fid = areaFeatureId(d.candidate);
                const hovered = hoverIncludes(hoverKey, fid);
                const selected = selectedKey === fid;
                const supHref =
                  d.candidate.provenance.href ||
                  sups.find(
                    (s) =>
                      s.number === d.candidate.provenance.supNumber ||
                      s.href.includes(
                        (d.candidate.provenance.supNumber || "").replace("/", "-"),
                      ),
                  )?.href;
                const supFolder = d.candidate.provenance.amdtId || amdtId;
                return (
                <li
                  key={d.candidate.id + d.status + fid}
                  data-area-fid={fid}
                  className={`space-y-1 px-2 py-2 ${
                    selected
                      ? "bg-sky-100"
                      : hovered
                        ? "bg-sky-50"
                        : ""
                  }`}
                  onMouseEnter={() => setHoverKey(fid)}
                  onMouseLeave={() => setHoverKey(null)}
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        d.status === "new"
                          ? "default"
                          : d.status === "changed"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {d.status}
                    </Badge>
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => {
                        setSelectedKey(fid);
                        setFocusId(d.candidate.id);
                      }}
                    >
                      {d.candidate.id}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {d.candidate.name}
                    {d.candidate.limits
                      ? ` · LIMITS ${d.candidate.limits.join(":")}`
                      : ""}
                    {d.candidate.provenance.supNumber && (
                      <>
                        {" · "}
                        <span
                          className={
                            supHref
                              ? "font-medium text-sky-700 underline decoration-sky-300/80 underline-offset-2"
                              : undefined
                          }
                          title={
                            supHref
                              ? "Hover to preview SUP here"
                              : undefined
                          }
                          onMouseEnter={() =>
                            showSupViewer(
                              supFolder,
                              supHref,
                              `SUP ${d.candidate.provenance.supNumber}`,
                            )
                          }
                        >
                          SUP {d.candidate.provenance.supNumber}
                        </span>
                      </>
                    )}
                    {d.notes.length ? ` — ${d.notes.join("; ")}` : ""}
                  </p>
                  {(d.status === "new" || d.status === "changed") && (
                    <Button size="sm" variant="outline" onClick={() => acceptDiff(d)}>
                      Accept
                    </Button>
                  )}
                </li>
                );
              })}
              {!diffs.length && (
                <li className="px-2 py-3 text-xs text-slate-500">
                  Parse SUPs to populate New / Changed / Excluded / Duplicate rows.
                </li>
              )}
            </ul>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}

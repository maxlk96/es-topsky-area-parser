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
import {
  CIRCLE_SPACING_PRESETS,
  autoSpacingForRadius,
  circleStepCount,
  clampCircleSpacing,
  inferSpacingFromRing,
  redensifyBoundCircle,
  redensifyBoundCircleAuto,
} from "@/lib/areas/coords";
import { diffCandidates, sortDiffItems } from "@/lib/areas/diff";
import { areaOmitsLabel, mentionsUasActivity } from "@/lib/areas/classify";
import { parseTopSkyBuffer } from "@/lib/areas/parse-topsky";
import {
  applyAcceptedAreaBlocks,
  applyLabelEdits,
  applyNameEdits,
  encodeLatin1,
  mergeTempoSection,
  patchLabelInBlock,
  patchNameInBlock,
  sanitizeExportedTopSkyText,
  toTopSkyName,
} from "@/lib/areas/write-topsky";
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

/** Dwell before opening SUP iframe — cancel if pointer leaves early. */
const SUP_IFRAME_DWELL_MS = 400;

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
  const [hoverKey, setHoverKey] = useState<HoverKey>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [supViewer, setSupViewer] = useState<SupViewer | null>(null);
  const [labelPlacer, setLabelPlacer] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  /** Share of the list+diff stack used by the area list (rest = verify/diff). */
  const [listPanePct, setListPanePct] = useState(42);
  const [renamingFid, setRenamingFid] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const splitRef = useRef<HTMLDivElement>(null);
  const supDwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumps only on explicit focus requests so hover re-highlights do not pan. */
  const focusSeq = useRef(0);
  const [focusToken, setFocusToken] = useState(0);

  const onListDiffSplitDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const root = splitRef.current;
      if (!root) return;
      const startY = e.clientY;
      const startPct = listPanePct;
      const height = root.getBoundingClientRect().height || 1;
      const onMove = (ev: MouseEvent) => {
        const deltaPct = ((ev.clientY - startY) / height) * 100;
        setListPanePct(Math.min(72, Math.max(22, startPct + deltaPct)));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [listPanePct],
  );

  const requestFocus = useCallback((areaId: string) => {
    focusSeq.current += 1;
    setFocusToken(focusSeq.current);
    setFocusId(areaId);
  }, []);

  const cancelSupDwell = useCallback(() => {
    if (supDwellTimer.current) {
      clearTimeout(supDwellTimer.current);
      supDwellTimer.current = null;
    }
  }, []);

  const scheduleSupViewer = useCallback(
    (folder: string | undefined, href: string | undefined, label: string) => {
      cancelSupDwell();
      if (!folder || !href) return;
      // Already showing this SUP — keep it without re-delay flicker.
      if (
        supViewer &&
        supViewer.folder === folder &&
        supViewer.href === href
      ) {
        return;
      }
      supDwellTimer.current = setTimeout(() => {
        setSupViewer({ folder, href, label });
        supDwellTimer.current = null;
      }, SUP_IFRAME_DWELL_MS);
    },
    [cancelSupDwell, supViewer],
  );

  useEffect(() => () => cancelSupDwell(), [cancelSupDwell]);

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
      setCandidates(
        found.filter(
          (a) =>
            a.exclusionReason !== "fir_border" &&
            a.exclusionReason !== "uas_only" &&
            (a.coordinates.length >= 3 || a.boundCircle),
        ),
      );
      const items = diffCandidates(areas, found);
      setDiffs(sortDiffItems(items));
      toast.success(`Parsed ${found.length} candidate areas → ${items.length} diff rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Parse failed");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Reload ENR 5.1 permanent R/D + likely tempo SUPs from the selected AMDT,
   * then diff against the currently loaded TopSky baseline. Does not wipe
   * the working set (OTHER / unlabeled blocks stay until Accept).
   */
  const reloadFromAip = async () => {
    if (!amdtId) {
      toast.error("Pick an AMDT first");
      return;
    }
    if (!areas.length) {
      toast.error("Load a TopSkyAreas baseline (GitHub or local) first");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/amdt/${encodeURIComponent(amdtId)}/reload`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AIP reload failed");
      const all = data.areas as AreaRecord[];
      // Map overlay: only drawable geometry — FIR-border rows stay in diff as excluded.
      setCandidates(
        all.filter(
          (a) =>
            a.exclusionReason !== "fir_border" &&
            a.exclusionReason !== "uas_only" &&
            (a.coordinates.length >= 3 || a.boundCircle),
        ),
      );
      const items = sortDiffItems(diffCandidates(areas, all));
      setDiffs(items);
      const nChanged = items.filter((i) => i.status === "changed").length;
      const nNew = items.filter((i) => i.status === "new").length;
      const nEx = items.filter((i) => i.status === "excluded").length;
      toast.success(
        `AIP reload: ${nChanged} changed · ${nNew} new · ${nEx} excluded` +
          ` (ENR ${data.enr51Count} · SUPs ${data.supParsed})` +
          (data.skippedUasSubject
            ? ` · skipped ${data.skippedUasSubject} UAS subject`
            : ""),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AIP reload failed");
    } finally {
      setLoading(false);
    }
  };

  const buildAcceptedArea = (
    candidate: AreaRecord,
    existing?: AreaRecord,
  ): AreaRecord => {
    // Keep permanent vs tempo placement from baseline when overwriting.
    const section =
      existing?.section ??
      candidate.section ??
      (candidate.provenance.source === "enr51" ? "other" : "tempo");
    let accepted: AreaRecord = {
      ...candidate,
      section,
      mapDefaultVisible: true,
      // Force full block rewrite on export (geometry / LIMITS / name).
      rawBlock: "",
    };
    if (accepted.boundCircle) {
      const red = redensifyBoundCircleAuto(accepted.boundCircle);
      const c = accepted.boundCircle;
      accepted = {
        ...accepted,
        coordinates: red.coordinates,
        circleSpacingDeg: red.circleSpacingDeg,
        // ESR94 etc. must stay unlabeled — don't invent a centre LABEL on Accept.
        label: areaOmitsLabel(accepted)
          ? undefined
          : {
              lat: c.lat,
              lon: c.lon,
              text: accepted.label?.text || accepted.name,
            },
      };
    } else if (areaOmitsLabel(accepted)) {
      accepted = { ...accepted, label: undefined };
    }
    return accepted;
  };

  const acceptDiff = (item: DiffItem) => {
    if (item.status !== "new" && item.status !== "changed") return;
    if (item.candidate.needsReview === "missing_name") {
      toast.error(
        `${item.candidate.id} needs an AIP name — use Rename before Accept`,
      );
      return;
    }
    setAreas((prev) => {
      const next = [...prev];
      const idx = next.findIndex(
        (a) => a.id.toUpperCase() === item.candidate.id.toUpperCase(),
      );
      const accepted = buildAcceptedArea(
        item.candidate,
        idx >= 0 ? next[idx] : undefined,
      );
      if (idx >= 0) next[idx] = accepted;
      else next.unshift(accepted);
      return next;
    });
    setDiffs((d) => d.filter((x) => x.candidate.id !== item.candidate.id));
    toast.success(`Accepted ${item.candidate.id}`);
  };

  const applyCircleSpacing = (fid: string, spacingDeg: number) => {
    setAreas((prev) =>
      prev.map((a) => {
        if (areaFeatureId(a) !== fid || !a.boundCircle) return a;
        const red = redensifyBoundCircle(a.boundCircle, spacingDeg);
        const c = a.boundCircle;
        // Keep LABEL on circle centre unless user already nudged it.
        // Omit-label areas (ESR94) never get an active LABEL.
        const label = areaOmitsLabel(a)
          ? undefined
          : a.label && a.labelEdited
            ? a.label
            : {
                lat: c.lat,
                lon: c.lon,
                text: a.label?.text || a.name,
              };
        return {
          ...a,
          coordinates: red.coordinates,
          circleSpacingDeg: red.circleSpacingDeg,
          label,
          // Force rewrite of geometry (+ LABEL) on export.
          rawBlock: "",
        };
      }),
    );
    toast.success(
      `Circle ring → ${circleStepCount(spacingDeg)} steps (${clampCircleSpacing(spacingDeg).toFixed(1)}°)`,
    );
  };

  const acceptAllDiffs = () => {
    const acceptable = diffs.filter(
      (d) =>
        (d.status === "new" || d.status === "changed") &&
        d.candidate.needsReview !== "missing_name",
    );
    const skippedMissingName = diffs.filter(
      (d) =>
        (d.status === "new" || d.status === "changed") &&
        d.candidate.needsReview === "missing_name",
    ).length;
    if (!acceptable.length) {
      toast.message(
        skippedMissingName
          ? `${skippedMissingName} area(s) need an AIP name (Rename) before Accept all`
          : "No new/changed candidates to accept",
      );
      return;
    }
    setAreas((prev) => {
      const next = [...prev];
      for (const item of acceptable) {
        const idx = next.findIndex(
          (a) => a.id.toUpperCase() === item.candidate.id.toUpperCase(),
        );
        const accepted = buildAcceptedArea(
          item.candidate,
          idx >= 0 ? next[idx] : undefined,
        );
        if (idx >= 0) next[idx] = accepted;
        else next.unshift(accepted);
      }
      return next;
    });
    const acceptedIds = new Set(
      acceptable.map((d) => d.candidate.id.toUpperCase()),
    );
    setDiffs((d) =>
      d.filter((x) => !acceptedIds.has(x.candidate.id.toUpperCase())),
    );
    toast.success(
      skippedMissingName
        ? `Accepted ${acceptable.length} · skipped ${skippedMissingName} missing name`
        : `Accepted ${acceptable.length} area(s)`,
    );
  };

  const onLabelMove = useCallback((fid: string, lat: number, lon: number) => {
    setAreas((prev) =>
      prev.map((a) => {
        if (areaFeatureId(a) !== fid) return a;
        // Never invent a LABEL for unlabeled baseline areas.
        if (!a.label) return a;
        const label = { ...a.label, lat, lon };
        // Keep rawBlock in sync so baseline (tempo + permanent) export patches LABEL.
        const rawBlock = a.rawBlock
          ? patchLabelInBlock(a.rawBlock, label)
          : a.rawBlock;
        return {
          ...a,
          label,
          labelEdited: true,
          rawBlock,
        };
      }),
    );
  }, []);

  const beginRename = useCallback((a: AreaRecord) => {
    const fid = areaFeatureId(a);
    setSelectedKey(fid);
    setRenamingFid(fid);
    // Prefill ALL CAPS (TopSky convention); user can still type ÅÄÖ.
    setRenameDraft(toTopSkyName(a.name || a.shortName || a.id));
  }, []);

  const cancelRename = useCallback(() => {
    setRenamingFid(null);
    setRenameDraft("");
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingFid) return;
    const name = toTopSkyName(renameDraft);
    if (!name) {
      toast.error("Name cannot be empty");
      return;
    }
    setAreas((prev) =>
      prev.map((a) => {
        if (areaFeatureId(a) !== renamingFid) return a;
        const label = a.label ? { ...a.label, text: name } : a.label;
        const rawBlock = a.rawBlock
          ? patchNameInBlock(a.rawBlock, a.id, name, label)
          : a.rawBlock;
        return {
          ...a,
          name,
          label,
          nameEdited: true,
          // LABEL text changed only when a LABEL already existed.
          labelEdited: a.label ? true : a.labelEdited,
          needsReview: undefined,
          rawBlock,
        };
      }),
    );
    // Clear needs_review on matching diff candidates too
    setDiffs((prev) =>
      prev.map((d) =>
        areaFeatureId(d.candidate) === renamingFid
          ? {
              ...d,
              candidate: {
                ...d.candidate,
                name,
                label: d.candidate.label
                  ? { ...d.candidate.label, text: name }
                  : d.candidate.label,
                needsReview: undefined,
              },
              notes: d.notes.filter((n) => !/missing AIP name/i.test(n)),
            }
          : d,
      ),
    );
    setRenamingFid(null);
    setRenameDraft("");
    toast.success(`Renamed to ${name}`);
  }, [renamingFid, renameDraft]);

  const exportFile = () => {
    if (!rawText) {
      toast.error("Load a baseline first");
      return;
    }
    // Tempo merge (incl. SUP Valid-to / EXCLUDED stubs) → accepted permanent ENR blocks → label/name.
    const excludedStubs = [
      ...areas.filter((a) => a.exclusionReason === "uas_only"),
      ...diffs
        .filter(
          (d) =>
            d.status === "excluded" &&
            d.candidate.exclusionReason === "uas_only" &&
            !!d.candidate.provenance.supNumber,
        )
        .map((d) => d.candidate),
    ];
    const merged = sanitizeExportedTopSkyText(
      applyNameEdits(
        applyLabelEdits(
          applyAcceptedAreaBlocks(
            mergeTempoSection(rawText, areas, { excludedStubs }),
            areas,
          ),
          areas,
        ),
        areas,
      ),
    );
    const moved = areas.filter((a) => a.labelEdited && !a.nameEdited).length;
    const renamed = areas.filter((a) => a.nameEdited).length;
    const rewritten = areas.filter(
      (a) =>
        a.section !== "tempo" &&
        !a.rawBlock &&
        (a.provenance.source === "enr51" || a.provenance.source === "sup"),
    ).length;
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
    const bits: string[] = [];
    if (rewritten) bits.push(`${rewritten} AIP block(s)`);
    if (renamed) bits.push(`${renamed} renamed`);
    if (moved) bits.push(`${moved} label(s) moved`);
    toast.success(
      bits.length
        ? `Exported TopSkyAreas.txt (Latin-1) · ${bits.join(" · ")}`
        : "Exported TopSkyAreas.txt (Latin-1)",
    );
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
              aria-label="Select AIP AMDT"
            >
              <option value="">Select AMDT…</option>
              {amdts.map((a) => {
                const eff = a.effectiveDate?.trim();
                const label = a.title || a.folder;
                return (
                  <option key={a.folder + a.kind} value={a.folder}>
                    [{a.kind}] {label}
                    {eff ? ` — eff. ${eff}` : ""}
                  </option>
                );
              })}
            </select>
            {amdtId ? (
              <p className="text-[11px] leading-snug text-slate-500">
                {(() => {
                  const sel = amdts.find((a) => a.folder === amdtId);
                  if (!sel) return null;
                  return (
                    <>
                      <span className="font-medium text-slate-700">
                        {sel.title || sel.folder}
                      </span>
                      {sel.effectiveDate ? (
                        <>
                          {" · "}
                          Effective{" "}
                          <span className="font-medium text-slate-800">
                            {sel.effectiveDate}
                          </span>
                        </>
                      ) : null}
                      {sel.publicationDate ? (
                        <span className="text-slate-400">
                          {" "}
                          · pub. {sel.publicationDate}
                        </span>
                      ) : null}
                    </>
                  );
                })()}
              </p>
            ) : null}
            <Button size="sm" className="w-full" onClick={scanSups} disabled={!amdtId || loading}>
              Scan SUPs for areas
            </Button>
            <Button
              size="sm"
              variant="default"
              className="w-full"
              onClick={reloadFromAip}
              disabled={!amdtId || !areas.length || loading}
              title="ENR 5.1 permanent R/D + likely tempo SUPs → diff vs loaded TopSky baseline"
            >
              Reload from AIP → diff
            </Button>
            <p className="text-[10px] leading-snug text-slate-500">
              Reloads ENR 5.1 + area SUPs into Verify/diff only — does not wipe OTHER /
              unlabeled blocks. Accept is still per-row.
            </p>
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
                      title="Hover briefly to open SUP preview"
                      onMouseEnter={() =>
                        scheduleSupViewer(amdtId, s.href, `SUP ${s.number}`)
                      }
                      onMouseLeave={cancelSupDwell}
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
                        // Highlight only — do not autopan on hover.
                        if (!related.length) {
                          setHoverKey(null);
                          return;
                        }
                        setHoverKey(related.map(areaFeatureId));
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
            focusToken={focusToken}
            hoverKey={hoverKey}
            selectedKey={selectedKey}
            onHoverKey={setHoverKey}
            onSelectKey={setSelectedKey}
            labelPlacer={labelPlacer}
            onLabelMove={onLabelMove}
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
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Areas
            </p>
            {areas.some((a) => a.needsReview === "missing_name") ? (
              <p className="text-[10px] font-medium text-red-700">
                {areas.filter((a) => a.needsReview === "missing_name").length}{" "}
                missing name
              </p>
            ) : null}
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">Label placer</p>
                <p className="text-[10px] leading-snug text-slate-500">
                  Drag any existing LABEL (baseline or accepted SUP) on the map. Areas with
                  no LABEL stay untouched on export.
                </p>
              </div>
              <Checkbox
                checked={labelPlacer}
                onCheckedChange={(v) => setLabelPlacer(v === true)}
                aria-label="Enable label placer"
              />
            </div>
            {labelPlacer && (
              <p className="mt-1.5 text-[10px] text-slate-500">
                {areas.filter((a) => a.label && isLayerVisible(a, layerVisibility)).length}{" "}
                labeled on visible layers
                {areas.filter((a) => a.labelEdited).length
                  ? ` · ${areas.filter((a) => a.labelEdited).length} moved`
                  : ""}
                {(() => {
                  const sel = areas.find((a) => areaFeatureId(a) === selectedKey);
                  if (!sel) return null;
                  if (!sel.label) {
                    return (
                      <span className="mt-1 block text-amber-700">
                        {sel.id}: no LABEL in file — left untouched
                      </span>
                    );
                  }
                  return (
                    <span className="mt-1 block font-mono text-slate-600">
                      {sel.id}: {sel.label.lat.toFixed(5)}, {sel.label.lon.toFixed(5)}
                      {sel.labelEdited ? " · edited" : ""}
                    </span>
                  );
                })()}
              </p>
            )}
          </div>
          {(() => {
            const sel = areas.find((a) => areaFeatureId(a) === selectedKey);
            if (!sel?.boundCircle) return null;
            const autoSp = autoSpacingForRadius(sel.boundCircle.radiusNm);
            const spacing =
              sel.circleSpacingDeg ??
              inferSpacingFromRing(sel.coordinates) ??
              autoSp;
            const steps = circleStepCount(spacing);
            const isAuto = Math.abs(spacing - autoSp) < 0.05;
            return (
              <div className="rounded-md border border-slate-200 bg-white px-2 py-2">
                <p className="text-xs font-semibold text-slate-800">Circle ring</p>
                <p className="text-[10px] leading-snug text-slate-500">
                  {sel.id} · r {sel.boundCircle.radiusNm.toFixed(2)} NM ·{" "}
                  <span className="font-medium text-slate-700">
                    {steps} steps ({spacing.toFixed(1)}°)
                  </span>
                  {isAuto ? " · auto from radius" : ` · auto would be ${autoSp}°`}.
                  Override Spacing° if needed, then export.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={isAuto ? "default" : "secondary"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => applyCircleSpacing(areaFeatureId(sel), autoSp)}
                    title={`Auto from radius → ${circleStepCount(autoSp)} vertices @ ${autoSp}°`}
                  >
                    Auto {autoSp}°
                  </Button>
                  {CIRCLE_SPACING_PRESETS.map((p) => (
                    <Button
                      key={p}
                      type="button"
                      size="sm"
                      variant={Math.abs(spacing - p) < 0.05 ? "default" : "outline"}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => applyCircleSpacing(areaFeatureId(sel), p)}
                      title={`${circleStepCount(p)} vertices`}
                    >
                      {p}°
                    </Button>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Label htmlFor="circle-spacing" className="text-[10px] text-slate-500">
                    Custom °
                  </Label>
                  <Input
                    id="circle-spacing"
                    type="number"
                    min={0.1}
                    max={120}
                    step={0.5}
                    defaultValue={Number(spacing.toFixed(1))}
                    key={`${sel.id}-${spacing.toFixed(1)}`}
                    className="h-7 w-20 text-xs"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = Number((e.target as HTMLInputElement).value);
                      if (!Number.isFinite(v)) return;
                      applyCircleSpacing(areaFeatureId(sel), v);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      const el = document.getElementById(
                        "circle-spacing",
                      ) as HTMLInputElement | null;
                      const v = Number(el?.value);
                      if (!Number.isFinite(v)) return;
                      applyCircleSpacing(areaFeatureId(sel), v);
                    }}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            );
          })()}
          <div className="min-w-0 overflow-x-hidden rounded-md border border-slate-200 bg-white px-2 py-2">
            <button
              type="button"
              className="flex w-full min-w-0 items-center justify-between gap-2 text-left"
              onClick={() => setLayersOpen((o) => !o)}
              aria-expanded={layersOpen}
            >
              <p className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Map layers
              </p>
              <span className="shrink-0 text-slate-500" aria-hidden>
                {layersOpen ? "▼" : "▶"}
              </span>
            </button>
            {layersOpen && (
              <div className="mt-2 max-h-[28vh] space-y-2 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]">
                {LAYER_GROUPS.map((group) => {
                  const gState = groupToggleState(group, layerVisibility);
                  const groupCount = group.toggles.reduce(
                    (n, t) => n + (counts[t.key] ?? 0),
                    0,
                  );
                  return (
                    <div
                      key={group.id}
                      className="min-w-0 overflow-x-hidden rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5"
                    >
                      <div className="mb-1 flex min-w-0 items-start justify-between gap-2 overflow-x-hidden">
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="truncate text-xs font-semibold text-slate-800">
                            {group.title}{" "}
                            <span className="font-normal text-slate-400">
                              ({groupCount})
                            </span>
                          </p>
                          <p className="break-words text-[10px] leading-snug text-slate-500">
                            {group.hint}
                          </p>
                        </div>
                        {/* Clip checkbox hit-area ::after so it cannot widen the panel */}
                        <span className="mt-0.5 inline-flex size-4 shrink-0 overflow-hidden">
                          <Checkbox
                            checked={gState === "all"}
                            indeterminate={gState === "some"}
                            onCheckedChange={(value) =>
                              setGroupVisible(group, value === true)
                            }
                            aria-label={`Show group ${group.title}`}
                          />
                        </span>
                      </div>
                      <div className="grid min-w-0 grid-cols-1 gap-y-1">
                        {group.toggles.map(({ key, label }) => (
                          <div
                            key={key}
                            className="flex min-w-0 items-center justify-between gap-2 overflow-x-hidden"
                          >
                            <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
                              {label}{" "}
                              <span className="text-slate-400">
                                ({counts[key] ?? 0})
                              </span>
                            </span>
                            <span className="inline-flex size-4 shrink-0 overflow-hidden">
                              <Checkbox
                                checked={layerVisibility[key] === true}
                                onCheckedChange={(value) =>
                                  setLayerVisible(key, value === true)
                                }
                                aria-label={`Show ${label} on map`}
                              />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Input
            placeholder="Filter id / name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div
            ref={splitRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
          >
            <ScrollArea
              className="min-h-[96px] overflow-x-hidden rounded-md border border-slate-200 bg-white"
              style={{ flex: `0 0 ${listPanePct}%` }}
            >
              <ul className="divide-y divide-slate-100 text-sm">
                {visibleList.slice(0, 400).map((a) => {
                  const fid = areaFeatureId(a);
                  const hovered = hoverIncludes(hoverKey, fid);
                  const selected = selectedKey === fid;
                  const editing = renamingFid === fid;
                  return (
                  <li key={fid}>
                    {editing ? (
                      <div className="flex items-start gap-2 bg-sky-50 px-2 py-1.5 ring-1 ring-inset ring-sky-400">
                        <Badge
                          variant={a.areaTypeCode === "3" ? "outline" : "secondary"}
                          className="mt-1 shrink-0"
                        >
                          {a.areaTypeCode}
                        </Badge>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium text-slate-800">{a.id}</p>
                          <Input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitRename();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelRename();
                              }
                            }}
                            placeholder="Display name (ALL CAPS)"
                            aria-label={`Rename ${a.id}`}
                            className="h-7 font-mono text-xs uppercase"
                          />
                          <p className="text-[10px] text-slate-500">
                            Updates //ES comment
                            {a.label ? " + LABEL text" : " (no LABEL — left unlabeled)"}
                            . ÅÄÖ ok.
                          </p>
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={commitRename}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={cancelRename}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                    <div
                      className={`flex w-full items-start gap-1 px-1 py-0.5 ${
                        selected
                          ? "bg-sky-100 ring-1 ring-inset ring-sky-400"
                          : hovered
                            ? "bg-sky-50 ring-1 ring-inset ring-sky-300"
                            : ""
                      }`}
                    >
                      <button
                        type="button"
                        data-area-fid={fid}
                        className="flex min-w-0 flex-1 items-start gap-2 px-1 py-1 text-left hover:bg-sky-50/80"
                        onClick={() => {
                          setSelectedKey(fid);
                          requestFocus(a.id);
                        }}
                        onMouseEnter={() => setHoverKey(fid)}
                        onMouseLeave={() => setHoverKey(null)}
                        onDoubleClick={() => beginRename(a)}
                        title="Double-click name to rename"
                      >
                        <Badge
                          variant={a.areaTypeCode === "3" ? "outline" : "secondary"}
                          className="shrink-0"
                        >
                          {a.areaTypeCode}
                        </Badge>
                        <span className="min-w-0">
                          <span className="font-medium">{a.id}</span>{" "}
                          <span className="text-slate-600">
                            {a.name}
                            {a.nameEdited ? (
                              <span className="ml-1 text-[10px] text-amber-700">
                                renamed
                              </span>
                            ) : null}
                            {a.needsReview === "missing_name" ? (
                              <span className="ml-1 text-[10px] font-medium text-red-700">
                                needs_review
                              </span>
                            ) : null}
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            {a.category}
                            {a.limits ? ` · ${a.limits[0]}:${a.limits[1]}` : ""}
                            {a.noaiw ? " · NOAIW" : ""}
                            {a.needsReview === "missing_name"
                              ? " · missing AIP name"
                              : ""}
                          </span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="mt-0.5 h-6 shrink-0 px-1.5 text-[10px] text-slate-500"
                        title="Rename display name / LABEL text"
                        onClick={(e) => {
                          e.stopPropagation();
                          beginRename(a);
                        }}
                      >
                        Rename
                      </Button>
                    </div>
                    )}
                  </li>
                );
                })}
              </ul>
            </ScrollArea>

            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize area list and verify panels"
              title="Drag to resize"
              onMouseDown={onListDiffSplitDown}
              className="my-1 flex h-3 shrink-0 cursor-row-resize items-center justify-center"
            >
              <span className="h-1 w-12 rounded-full bg-slate-300" />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
          <div className="flex shrink-0 flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Verify / diff
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-xs"
                disabled={
                  !diffs.some((d) => d.status === "new" || d.status === "changed")
                }
                onClick={acceptAllDiffs}
                title="Accept all new and changed candidates"
              >
                Accept all
              </Button>
            </div>
            {diffs.length > 0 && (
              <p className="text-[11px] text-slate-500">
                {(["changed", "new", "excluded", "present", "expired"] as const)
                  .map((s) => {
                    const n = diffs.filter((d) => d.status === s).length;
                    return n ? `${n} ${s}` : null;
                  })
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>
          <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-x-hidden rounded-md border border-slate-200 bg-white">
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
                  <div className="flex flex-wrap items-center gap-2">
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
                    {d.candidate.needsReview === "missing_name" ? (
                      <Badge variant="outline" className="border-red-300 text-red-700">
                        needs_review
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => {
                        setSelectedKey(fid);
                        requestFocus(d.candidate.id);
                      }}
                    >
                      {d.candidate.id}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {d.candidate.name}
                    {d.candidate.provenance.source === "enr51"
                      ? " · ENR 5.1"
                      : d.candidate.provenance.source === "sup"
                        ? " · SUP"
                        : ""}
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
                              ? "Hover briefly to open SUP preview"
                              : undefined
                          }
                          onMouseEnter={() =>
                            scheduleSupViewer(
                              supFolder,
                              supHref,
                              `SUP ${d.candidate.provenance.supNumber}`,
                            )
                          }
                          onMouseLeave={cancelSupDwell}
                        >
                          SUP {d.candidate.provenance.supNumber}
                        </span>
                      </>
                    )}
                  </p>
                  {d.notes.length > 0 && (
                    <p
                      className={
                        d.status === "changed" || d.status === "new"
                          ? "text-[11px] font-medium text-amber-800"
                          : d.status === "excluded"
                            ? "text-[11px] text-slate-500"
                            : "text-[11px] text-slate-400"
                      }
                      title={d.notes.join(" · ")}
                    >
                      {(d.status === "changed" || d.status === "new"
                        ? "Why: "
                        : "") + d.notes.join(" · ")}
                    </p>
                  )}
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
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

# ES-Topsky Area Manager

Web tool for VATSIM Scandinavia ESAA maintainers: load `TopSkyAreas.txt`, map areas with HMI-aligned colours, ingest LFV AIP SUPs, diff/verify, Accept, and export Latin-1 tempo R/D blocks.

## Prerequisites

- **Node.js 20+** (22 LTS works; check with `node -v`)
- **npm** 10+ (ships with Node)
- Network access to LFV eAIP (`aro.lfv.se`) when fetching AMDT/SUPs

## Run on your machine

```bash
# After you create/link a GitHub repo from this Cursor project:
git clone <your-repo-url>
cd <repo>
git checkout cursor/area-manager-mvp-5762

npm install
npm run dev
```

Open **[http://127.0.0.1:43127](http://127.0.0.1:43127)** in your browser.

Dev server binds to port **43127** (not 3000).

### Without cloning yet

If this project still has no durable GitHub remote: use **Create repo** in the Cursor agent view, then clone as above. Alternatively unpack a source archive from the agent artifacts (if attached), then:

```bash
cd es-topsky-area-manager   # or the unpacked folder
npm install
npm run dev
```

### Useful scripts

```bash
npm test          # unit tests (coords, LIMITS, TopSky parse)
npm run build     # production build
npm start         # serve production build on :43127
```

## MVP workflow

1. **Load GitHub** (`main` `OTHER/TopSkyAreas.txt`) or a **local** areas file (becomes session baseline).
2. Fetch **AMDT** list from LFV eAIP → pick Currently Effective → **Scan SUPs**.
3. Select temporary R/D SUPs → **Parse → diff** (New / Changed / Excluded UAS / Present).
4. **Accept** into the working copy → **Export** `TopSkyAreas.txt` (Latin-1; expired tempo removed when validity is known).
5. Optional: enable **Label placer** (right panel) → drag existing LABELs on the map → Export writes updated `LABEL:` lines (unlabeled areas stay unlabeled).

## Domain rules (summary)

- R/D: `AREA:3` (no ATS crossing authority) vs `AREA:4F` + `NOAIW` (flying / ATS may permit).
- Activation: **AUP or manual only** — never generate `ACTIVE:NOTAM`.
- UAS-only areas: excluded (not VATSIM).
- `LIMITS`: hundreds of feet; AMSL ft → `ft/100` (e.g. 2500 → `25`).
- LABEL placer: nudge existing labels only; never invent LABEL for unlabeled baseline blocks.
- OTHER (TCT/STCA/…): round-trip; hidden on map by default.

See Project docs / plan for full taxonomy, HMI colours, and TopSky Developer Guide notes.

## Stack

Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · MapLibre · Turf · Vitest

# ES-Topsky Area Manager

Web tool for VATSIM Scandinavia ESAA maintainers: load `TopSkyAreas.txt`, map areas with HMI-aligned colours, ingest LFV AIP SUPs, diff/verify, Accept, and export Latin-1 tempo R/D blocks.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43127](http://127.0.0.1:43127).

```bash
npm test    # unit tests (coords, LIMITS, TopSky parse)
npm run build
```

## MVP workflow

1. **Load GitHub** (`main` `OTHER/TopSkyAreas.txt`) or a **local** areas file (becomes session baseline).
2. Fetch **AMDT** list from LFV eAIP → pick Currently Effective → **Scan SUPs**.
3. Select temporary R/D SUPs → **Parse → diff** (New / Changed / Excluded UAS / Present).
4. **Accept** into the working copy → **Export** `TopSkyAreas.txt` (Latin-1; expired tempo removed when validity is known).

## Domain rules (summary)

- R/D: `AREA:3` (no ATS crossing authority) vs `AREA:4F` + `NOAIW` (flying / ATS may permit).
- Activation: **AUP or manual only** — never generate `ACTIVE:NOTAM`.
- UAS-only areas: excluded (not VATSIM).
- `LIMITS`: hundreds of feet; AMSL ft → `ft/100` (e.g. 2500 → `25`).
- OTHER (TCT/STCA/…): round-trip; hidden on map by default.

See Project docs / plan for full taxonomy, HMI colours, and TopSky Developer Guide notes.

## Stack

Next.js (App Router) · TypeScript · Tailwind · shadcn/ui · MapLibre · Turf · Vitest

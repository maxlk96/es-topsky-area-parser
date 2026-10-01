export type AreaSource =
  | "topsky"
  | "sup"
  | "notam"
  | "enr51"
  | "enr52"
  | "vatiris_pca"
  | "manual";

export type AreaCategory = "R" | "D" | "P" | "TRA" | "CBA" | "PCA" | "OTHER";

export type ActivationType = "AUP" | "AUP_GROUP" | "MANUAL" | "ALWAYS" | "NONE" | "SCHEDULE";

export interface AreaLabel {
  lat: number;
  lon: number;
  text: string;
}

export interface AreaProvenance {
  source: AreaSource;
  amdtId?: string;
  supNumber?: string;
  validFrom?: string;
  validTo?: string;
  rawComment?: string;
  notamId?: string;
}

export interface AreaRecord {
  id: string;
  shortName: string;
  name: string;
  category: AreaCategory;
  areaTypeCode: string;
  coordinates: [number, number][]; // [lon, lat]
  limits?: [number, number];
  activation?: { type: ActivationType; key?: string; raw?: string[] };
  directives: string[];
  label?: AreaLabel;
  mapDefaultVisible: boolean;
  noaiw: boolean;
  boundCircle?: { lat: number; lon: number; radiusNm: number };
  provenance: AreaProvenance;
  exclusionReason?: string;
  rawBlock: string;
  section?: "tempo" | "other";
}

export interface ParseResult {
  areas: AreaRecord[];
  encoding: string;
  errors: string[];
  rawText: string;
}

export type DiffStatus =
  | "new"
  | "changed"
  | "present"
  | "duplicate_of_sup"
  | "expired"
  | "excluded";

export interface DiffItem {
  status: DiffStatus;
  candidate: AreaRecord;
  existing?: AreaRecord;
  notes: string[];
}

export interface AmdtEntry {
  id: string;
  title: string;
  effectiveDate: string;
  publicationDate: string;
  reason: string;
  kind: "current" | "next" | "archive";
  folder: string;
}

export interface SupCatalogueRow {
  number: string;
  href: string;
  period: string;
  subject: string;
  likelyArea: boolean;
}

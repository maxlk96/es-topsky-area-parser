import type { AreaRecord, ActivationType } from "./types";

/** True when the area has ACTIVE:AUP / ACTIVE:AUP_GROUP. */
export function hasAupActivation(
  area: Pick<AreaRecord, "activation">,
): boolean {
  const t = area.activation?.type;
  return t === "AUP" || t === "AUP_GROUP";
}

/**
 * True when there is no AUP activation line (manual / none).
 * These tempo SUP areas get `// NO AUP ACTIVATION` on export.
 */
export function isNoAupActivation(
  area: Pick<AreaRecord, "activation">,
): boolean {
  const t = area.activation?.type;
  return !t || t === "MANUAL" || t === "NONE";
}

/** Short UI label for the activation mode. */
export function activationLabel(
  area: Pick<AreaRecord, "activation">,
): string {
  const t = area.activation?.type;
  if (t === "AUP") return "AUP";
  if (t === "AUP_GROUP") return "AUP group";
  if (t === "ALWAYS") return "always";
  if (t === "SCHEDULE") return "schedule";
  if (t === "NONE" || t === "MANUAL" || !t) return "no AUP";
  return t;
}

/** Tempo / SUP areas use MANUAL when AUP is off; permanent type-3 defaults to ALWAYS. */
export function defaultActivationWhenAupOff(
  area: Pick<AreaRecord, "section" | "provenance" | "areaTypeCode">,
): { type: ActivationType; key?: string } {
  const tempo =
    area.section === "tempo" ||
    area.provenance.source === "sup" ||
    area.provenance.source === "notam";
  if (tempo) return { type: "MANUAL" };
  if (area.areaTypeCode === "4F") return { type: "MANUAL" };
  return { type: "ALWAYS" };
}

/** Enable/disable AUP activation; clears rawBlock so export rewrites ACTIVE lines. */
export function withAupActivation(
  area: AreaRecord,
  enabled: boolean,
): AreaRecord {
  if (enabled) {
    return {
      ...area,
      activation: { type: "AUP", key: area.id },
      rawBlock: "",
    };
  }
  return {
    ...area,
    activation: defaultActivationWhenAupOff(area),
    rawBlock: "",
  };
}

/**
 * Strip leading SUP group headers from a raw block so merge can re-emit them
 * once per SUP group (`// NNN/YY - Valid to` / `// NO AUP ACTIVATION`).
 */
export function stripTempoGroupHeaders(block: string): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i]!.trim();
    if (
      t === "" ||
      /^\/\/\s*\d+\s*\/\s*\d+\s*-/.test(t) ||
      /^\/\/\s*NO AUP ACTIVATION\b/i.test(t)
    ) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n");
}

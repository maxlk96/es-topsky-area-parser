import { describe, expect, it } from "vitest";
import {
  parseDatasourceSups,
  subjectLooksUas,
  supNumberKey,
} from "./sup-catalogue";

describe("supNumberKey", () => {
  it("sorts newest SUP numbers first", () => {
    const nums = ["185/2026", "191/2026", "301/2025", "19/2026"];
    const sorted = [...nums].sort((a, b) => {
      const [ay, an] = supNumberKey(a);
      const [by, bn] = supNumberKey(b);
      if (by !== ay) return by - ay;
      return bn - an;
    });
    expect(sorted).toEqual(["191/2026", "185/2026", "19/2026", "301/2025"]);
  });
});

describe("subjectLooksUas", () => {
  it("flags UAS-titled subjects only", () => {
    expect(subjectLooksUas("Temporary danger area - ESD865 Mölndal UAS")).toBe(
      true,
    );
    expect(
      subjectLooksUas("Temporary restricted area - ESR791 Möja"),
    ).toBe(false);
  });
});

describe("parseDatasourceSups", () => {
  it("marks area subjects and sorts newest likely first", () => {
    const js = `
      "year": { "href": "AIP SUP 185-2026_2026_10_23/ES-SUP-en-GB.html", "text": "AIP SUP 185/2026" },
      "affects": {},
      "period": { "text": "from 23 OCT 2026" },
      "subject": { "text": "Temporary restricted area - ESR791 Möja" },
      "year": { "href": "AIP SUP 111-2026_x/ES-SUP-en-GB.html", "text": "AIP SUP 111/2026" },
      "affects": {},
      "period": { "text": "from 01 JAN 2026" },
      "subject": { "text": "Temporary danger area - ESD821 Skellefteå Viken UAS" },
    `;
    const rows = parseDatasourceSups(js);
    expect(rows.every((r) => r.likelyArea)).toBe(true);
    expect(rows[0].number).toBe("185/2026");
    expect(rows[1].number).toBe("111/2026");
  });
});

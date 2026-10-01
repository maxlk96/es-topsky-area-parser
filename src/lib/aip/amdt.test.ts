import { describe, expect, it } from "vitest";
import {
  effectiveDateFromFolder,
  parseAmdtIndexHtml,
  titleFromAmdtFolder,
} from "./amdt";

describe("AMDT catalogue dates", () => {
  it("derives effective date and title from folder name", () => {
    expect(effectiveDateFromFolder("AIP AMDT 1-2026_2026_08_07")).toBe(
      "07 Aug 2026",
    );
    expect(titleFromAmdtFolder("AIRAC AIP AMDT 6-2026_2026_10_29")).toBe(
      "AIRAC AIP AMDT 6/2026",
    );
  });

  it("parses effective dates from offline index tables", () => {
    const html = `
      <h2>Currently Effective Issue</h2>
      <table>
        <tr>
          <td><a href="AIP AMDT 1-2026_2026_08_07\\index-v2.html">07 Aug 2026</a></td>
          <td>09 Jul 2026</td>
          <td>AIP AMDT 1/2026</td>
        </tr>
      </table>
      <h2>Next Issues</h2>
      <table>
        <tr>
          <td><a href="AIRAC AIP AMDT 6-2026_2026_10_29\\index-v2.html">29 Oct 2026</a></td>
          <td>24 Sep 2026</td>
          <td>AIRAC AIP AMDT 6/2026</td>
        </tr>
      </table>
      <h2>Expired Issues</h2>
      <table></table>
    `;
    const entries = parseAmdtIndexHtml(html);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("current");
    expect(entries[0].effectiveDate).toBe("07 Aug 2026");
    expect(entries[0].title).toMatch(/AIP AMDT 1\/2026/);
    expect(entries[1].kind).toBe("next");
    expect(entries[1].effectiveDate).toBe("29 Oct 2026");
  });
});

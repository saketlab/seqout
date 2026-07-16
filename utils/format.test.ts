import { describe, it, expect } from "vitest";
import {
  cleanJournalName,
  humanize,
  humanizeBytes,
  formatBytes,
  formatFirstLastAuthor,
  formatPubDate,
  countryFlag,
  titleCaseCenter,
} from "./format";

describe("formatPubDate", () => {
  it("formats a full date", () => {
    expect(formatPubDate("2017-08-02")).toBe("2 Aug 2017");
  });

  it("does not shift the day across timezones", () => {
    // Parsed as UTC; a naive `new Date("2017-08-02")` renders as 1 Aug
    // for viewers west of Greenwich.
    expect(formatPubDate("2017-01-01")).toBe("1 Jan 2017");
  });

  it("keeps a bare year as a year", () => {
    // `new Date(2025)` is 1 Jan 1970 — the number must not reach the parser.
    expect(formatPubDate(2025)).toBe("2025");
    expect(formatPubDate("2025")).toBe("2025");
  });

  it("does not invent a day for year-month input", () => {
    expect(formatPubDate("2017-08")).toBe("Aug 2017");
  });

  it("passes through shapes it does not recognise", () => {
    // V8 would parse both of these into a real date and invent a day:
    // "Spring 2017" -> 1 Jan 2017, "2017 Jun" -> 1 Jun 2017.
    expect(formatPubDate("Spring 2017")).toBe("Spring 2017");
    expect(formatPubDate("2017 Jun")).toBe("2017 Jun");
    expect(formatPubDate("2015 Nov-Dec")).toBe("2015 Nov-Dec");
  });

  it("drops empties", () => {
    expect(formatPubDate(null)).toBeNull();
    expect(formatPubDate("  ")).toBeNull();
  });
});

describe("cleanJournalName", () => {
  it("maps known aliases", () => {
    expect(
      cleanJournalName(
        "Proceedings of the National Academy of Sciences of the United States of America",
      ),
    ).toBe("PNAS");
  });
  it("strips ': ' suffix", () => {
    expect(cleanJournalName("bioRxiv: the preprint server")).toBe("bioRxiv");
  });
  it("strips parenthetical", () => {
    expect(cleanJournalName("G3 (Bethesda)")).toBe("G3");
  });
  it("passes through a clean name", () => {
    expect(cleanJournalName("Nature")).toBe("Nature");
  });
});

describe("humanize", () => {
  it.each([
    [999, "999"],
    [1000, "1K"],
    [1500, "1.5K"],
    [1_000_000, "1M"],
    [2_500_000_000, "2.5B"],
  ])("humanize(%i) === %s", (input, expected) => {
    expect(humanize(input)).toBe(expected);
  });
});

describe("humanizeBytes", () => {
  it.each([
    [500, "500"],
    [1_000_000, "1 MB"],
    [1_500_000_000, "1.5 GB"],
    [2_000_000_000_000, "2 TB"],
  ])("humanizeBytes(%i) === %s", (input, expected) => {
    expect(humanizeBytes(input)).toBe(expected);
  });
});

describe("formatBytes", () => {
  it("returns 0 B for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
  it("uses binary (1024) units", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });
});

describe("formatFirstLastAuthor", () => {
  it("returns null for empty", () => {
    expect(formatFirstLastAuthor(null)).toBeNull();
    expect(formatFirstLastAuthor("")).toBeNull();
  });
  it("single author", () => {
    expect(formatFirstLastAuthor("Smith J")).toBe("Smith J");
  });
  it("two authors joined with 'and'", () => {
    expect(formatFirstLastAuthor("Smith J, Doe A")).toBe("Smith J and Doe A");
  });
  it("three+ authors elided", () => {
    expect(formatFirstLastAuthor("Smith J, Doe A, Roe B")).toBe(
      "Smith J ... Roe B",
    );
  });
});

describe("countryFlag", () => {
  it("returns empty for invalid", () => {
    expect(countryFlag(null)).toBe("");
    expect(countryFlag("USA")).toBe("");
  });
  it("converts ISO-2 to flag emoji", () => {
    expect(countryFlag("US")).toBe("🇺🇸");
    expect(countryFlag("in")).toBe("🇮🇳");
  });
});

describe("titleCaseCenter", () => {
  it("title-cases words but preserves all-caps acronyms", () => {
    expect(titleCaseCenter("BROAD institute")).toBe("BROAD Institute");
    expect(titleCaseCenter("university of california")).toBe(
      "University Of California",
    );
  });
});

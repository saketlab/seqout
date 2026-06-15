import { describe, it, expect } from "vitest";
import {
  cleanJournalName,
  humanize,
  humanizeBytes,
  formatBytes,
  formatFirstLastAuthor,
  countryFlag,
  titleCaseCenter,
} from "./format";

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

import { describe, expect, it } from "vitest";
import { toServerFilters } from "./gridFilters";

const text = (type: string, filter: unknown) => ({
  filterType: "text",
  type,
  filter,
});

describe("toServerFilters", () => {
  it("returns empty for nothing worth asking the server", () => {
    expect(toServerFilters(null)).toBe("");
    expect(toServerFilters({})).toBe("");
    // whitespace-only is not a search
    expect(toServerFilters({ title: text("contains", "  ") })).toBe("");
  });

  it("carries equals and contains across, trimmed", () => {
    expect(
      JSON.parse(
        toServerFilters({
          accession: text("equals", " SRX1 "),
          title: text("contains", "liver"),
        }),
      ),
    ).toEqual([
      { c: "accession", o: "equals", v: "SRX1" },
      { c: "title", o: "contains", v: "liver" },
    ]);
  });

  it("drops filters the endpoints cannot express", () => {
    const model = {
      // number ranges stay client-side
      size: { filterType: "number", type: "greaterThan", filter: 10 },
      // so do text operators outside the two the grid offers
      alias: text("startsWith", "abc"),
      title: text("contains", "keep"),
    };
    expect(JSON.parse(toServerFilters(model))).toEqual([
      { c: "title", o: "contains", v: "keep" },
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizeAuthors,
  toDisplayText,
  parsePostgresTextArray,
} from "./project";

describe("normalizeAuthors", () => {
  it("returns [] for falsy", () => {
    expect(normalizeAuthors(null)).toEqual([]);
    expect(normalizeAuthors("")).toEqual([]);
  });
  it("trims and filters an array input", () => {
    expect(normalizeAuthors([" Smith J ", "", "Doe A"])).toEqual([
      "Smith J",
      "Doe A",
    ]);
  });
  it("parses a JSON-array string", () => {
    expect(normalizeAuthors('["Smith J", "Doe A"]')).toEqual([
      "Smith J",
      "Doe A",
    ]);
  });
  it("falls back to comma-split for plain text", () => {
    expect(normalizeAuthors("Smith J, Doe A")).toEqual(["Smith J", "Doe A"]);
  });
});

describe("toDisplayText", () => {
  it("returns '-' for nullish/empty", () => {
    expect(toDisplayText(null)).toBe("-");
    expect(toDisplayText(undefined)).toBe("-");
    expect(toDisplayText("")).toBe("-");
  });
  it("stringifies other values", () => {
    expect(toDisplayText(42)).toBe("42");
    expect(toDisplayText("hi")).toBe("hi");
  });
});

describe("parsePostgresTextArray", () => {
  it("returns [] for non-brace strings", () => {
    expect(parsePostgresTextArray("plain")).toEqual([]);
  });
  it("returns [] for empty braces", () => {
    expect(parsePostgresTextArray("{}")).toEqual([]);
  });
  it("parses a simple pg array", () => {
    expect(parsePostgresTextArray("{a,b,c}")).toEqual(["a", "b", "c"]);
  });
  it("preserves commas inside quoted entries", () => {
    expect(parsePostgresTextArray('{"a,b",c}')).toEqual(["a,b", "c"]);
  });
});

import { describe, it, expect } from "vitest";
import { escapeHtmlJson, parseMaybeJson } from "./json";

describe("parseMaybeJson", () => {
  it("returns fallback for null/undefined/empty", () => {
    expect(parseMaybeJson(null, "fb")).toBe("fb");
    expect(parseMaybeJson(undefined, "fb")).toBe("fb");
    expect(parseMaybeJson("", "fb")).toBe("fb");
  });
  it("parses valid JSON strings", () => {
    expect(parseMaybeJson('{"a":1}', null)).toEqual({ a: 1 });
    expect(parseMaybeJson("[1,2]", null)).toEqual([1, 2]);
  });
  it("returns fallback on invalid JSON", () => {
    expect(parseMaybeJson("{not json", null)).toBeNull();
  });
  it("passes through non-string values unchanged", () => {
    const obj = { a: 1 };
    expect(parseMaybeJson(obj, null)).toBe(obj);
  });
});

describe("escapeHtmlJson", () => {
  it("escapes characters that can change an HTML script's meaning", () => {
    const json = escapeHtmlJson({ value: "</script><span>&" });

    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(json).not.toContain("&");
    expect(JSON.parse(json)).toEqual({ value: "</script><span>&" });
  });
});

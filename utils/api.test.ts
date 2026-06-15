import { describe, it, expect, vi, afterEach } from "vitest";
import { getJson, getJsonOrNull, parseProjectStringFields } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
}

describe("getJson", () => {
  it("returns the parsed body on ok", async () => {
    mockFetch({ a: 1 });
    expect(await getJson("/project/X")).toEqual({ a: 1 });
  });
  it("throws 'Network error' on a non-ok response", async () => {
    mockFetch({}, false);
    await expect(getJson("/project/X")).rejects.toThrow("Network error");
  });
});

describe("getJsonOrNull", () => {
  it("returns the parsed body on ok", async () => {
    mockFetch({ a: 1 });
    expect(await getJsonOrNull("/project/X")).toEqual({ a: 1 });
  });
  it("returns null on a non-ok response", async () => {
    mockFetch({}, false);
    expect(await getJsonOrNull("/project/X")).toBeNull();
  });
});

describe("parseProjectStringFields", () => {
  it("parses stringified external_id / links / neighbors", () => {
    const d = parseProjectStringFields({
      external_id: '{"GEO":"GSE1"}',
      links: '{"a":1}',
      neighbors: '[{"accession":"SRP2"}]',
    });
    expect(d.external_id).toEqual({ GEO: "GSE1" });
    expect(d.links).toEqual({ a: 1 });
    expect(d.neighbors).toEqual([{ accession: "SRP2" }]);
  });
  it("nulls a malformed stringified field instead of throwing", () => {
    const d = parseProjectStringFields({ external_id: "{bad", links: "[x" });
    expect(d.external_id).toBeNull();
    expect(d.links).toBeNull();
  });
  it("parses organisms from a JSON array string", () => {
    const d = parseProjectStringFields({ organisms: '["Homo sapiens"]' });
    expect(d.organisms).toEqual(["Homo sapiens"]);
  });
  it("splits a non-JSON organisms string on ; , |", () => {
    const d = parseProjectStringFields({
      organisms: "Homo sapiens; Mus musculus | Rattus",
    });
    expect(d.organisms).toEqual(["Homo sapiens", "Mus musculus", "Rattus"]);
  });
  it("leaves already-parsed (non-string) fields untouched", () => {
    const obj = { GEO: "GSE1" };
    const arr = ["Homo sapiens"];
    const d = parseProjectStringFields({ external_id: obj, organisms: arr });
    expect(d.external_id).toBe(obj);
    expect(d.organisms).toBe(arr);
  });
});

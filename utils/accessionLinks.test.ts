import { describe, it, expect } from "vitest";
import {
  getInternalUrl,
  parseAccessions,
  startsWithAccession,
} from "./accessionLinks";

describe("getInternalUrl", () => {
  it("routes each accession kind to its page (PRJ + unknown → null)", () => {
    expect(getInternalUrl("GSE196830")).toBe("/p/GSE196830");
    expect(getInternalUrl("SRP123456")).toBe("/p/SRP123456");
    expect(getInternalUrl("E-MTAB-1234")).toBe("/p/E-MTAB-1234");
    expect(getInternalUrl("SRX999")).toBe("/e/SRX999");
    expect(getInternalUrl("ERR42")).toBe("/r/ERR42");
    expect(getInternalUrl("GSM7")).toBe("/s/GSM7");
    expect(getInternalUrl("PRJNA123")).toBeNull(); // resolved via /prj, not here
    expect(getInternalUrl("cancer")).toBeNull();
  });
});

describe("startsWithAccession", () => {
  it("is true only when the query begins with an accession", () => {
    expect(startsWithAccession("GSE12345")).toBe(true);
    expect(startsWithAccession("E-MTAB-10381 - ATAC-seq of iPSC")).toBe(true);
    expect(startsWithAccession("role of GSE12345 in cancer")).toBe(false);
    expect(startsWithAccession("brain scrna")).toBe(false);
    expect(startsWithAccession("GSE12345abc")).toBe(false); // no boundary
  });
});

describe("parseAccessions", () => {
  it("extracts a single accession followed by pasted title text", () => {
    const accs = parseAccessions("E-MTAB-10381 - ATAC-seq of iPSC");
    expect(accs).toHaveLength(1);
    expect(accs[0]).toEqual({
      raw: "E-MTAB-10381",
      url: "/p/E-MTAB-10381",
      isPrj: false,
    });
  });

  it("extracts and dedupes multiple accessions, preserving order", () => {
    const accs = parseAccessions("GSE111 SRX222 GSE111 PRJNA333");
    expect(accs.map((a) => a.raw)).toEqual(["GSE111", "SRX222", "PRJNA333"]);
    expect(accs.map((a) => a.url)).toEqual([
      "/p/GSE111",
      "/e/SRX222",
      "/p/PRJNA333",
    ]);
    expect(accs.find((a) => a.raw === "PRJNA333")?.isPrj).toBe(true);
  });

  it("returns nothing for a plain text query", () => {
    expect(parseAccessions("brain single cell rna")).toEqual([]);
  });
});

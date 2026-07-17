import { describe, it, expect } from "vitest";
import {
  getExternalArchiveUrl,
  getInternalUrl,
  parseAccessions,
  startsWithAccession,
} from "./accessionLinks";

describe("getInternalUrl", () => {
  it("routes each accession kind to its page (PRJ + unknown → null)", () => {
    expect(getInternalUrl("GSE196830")).toBe("/p/GSE196830");
    expect(getInternalUrl("SRP123456")).toBe("/p/SRP123456");
    expect(getInternalUrl("E-MTAB-1234")).toBe("/p/E-MTAB-1234");
    expect(getInternalUrl("E-GEAD-282")).toBe("/p/E-GEAD-282");
    expect(getInternalUrl("DRP000001")).toBe("/p/DRP000001");
    expect(getInternalUrl("SRX999")).toBe("/e/SRX999");
    expect(getInternalUrl("ERR42")).toBe("/r/ERR42");
    expect(getInternalUrl("GSM7")).toBe("/s/GSM7");
    expect(getInternalUrl("PRJNA123")).toBeNull(); // resolved via /prj, not here
    expect(getInternalUrl("cancer")).toBeNull();
  });

  it("routes GSA accessions (runs → null: no internal download page)", () => {
    expect(getInternalUrl("CRA000004")).toBe("/p/CRA000004");
    expect(getInternalUrl("HRA007928")).toBe("/p/HRA007928");
    expect(getInternalUrl("CRX111967")).toBe("/e/CRX111967");
    expect(getInternalUrl("HRX111967")).toBe("/e/HRX111967");
    expect(getInternalUrl("HRS096807")).toBe("/s/HRS096807");
    expect(getInternalUrl("SAMC123")).toBe("/s/SAMC123");
    expect(getInternalUrl("CRR999")).toBeNull(); // GSA run → external only
    expect(getInternalUrl("HRR999")).toBeNull();
  });
});

describe("getExternalArchiveUrl (GSA → CNCB-NGDC)", () => {
  it("links CRA/HRA studies to their browse pages", () => {
    expect(getExternalArchiveUrl("CRA000004")).toEqual({
      url: "https://ngdc.cncb.ac.cn/gsa/browse/CRA000004",
      archive: "GSA",
      label: "View on GSA",
    });
    expect(getExternalArchiveUrl("HRA007928")?.url).toBe(
      "https://ngdc.cncb.ac.cn/gsa-human/browse/HRA007928",
    );
  });

  it("routes GSA sub-accessions (incl. SAMC/PRJCA) to NGDC, not NCBI", () => {
    for (const acc of ["CRR9", "CRX9", "HRR9", "HRS9", "SAMC9", "PRJCA9"]) {
      const r = getExternalArchiveUrl(acc);
      expect(r?.archive).toBe("GSA");
      expect(r?.url).toBe(`https://ngdc.cncb.ac.cn/search/all?q=${acc}`);
    }
  });
});

describe("getExternalArchiveUrl (DDBJ)", () => {
  it("links E-GEAD experiments to GEA, not ArrayExpress", () => {
    expect(getExternalArchiveUrl("E-GEAD-282")).toEqual({
      url: "https://ddbj.nig.ac.jp/search/entry/gea/E-GEAD-282",
      archive: "GEA",
      label: "View on GEA",
    });
    expect(getExternalArchiveUrl("E-MTAB-1234")?.archive).toBe("ArrayExpress");
  });

  it("links DRA accessions to their DDBJ resource pages", () => {
    expect(getExternalArchiveUrl("DRP000001")).toEqual({
      url: "https://ddbj.nig.ac.jp/resource/sra-study/DRP000001",
      archive: "DRA",
      label: "View on DRA",
    });
    expect(getExternalArchiveUrl("DRX000001")?.url).toBe(
      "https://ddbj.nig.ac.jp/resource/sra-experiment/DRX000001",
    );
    expect(getExternalArchiveUrl("DRR000001")?.url).toBe(
      "https://ddbj.nig.ac.jp/resource/sra-run/DRR000001",
    );
    expect(getExternalArchiveUrl("DRS000001")?.url).toBe(
      "https://ddbj.nig.ac.jp/resource/sra-sample/DRS000001",
    );
  });
});

describe("startsWithAccession", () => {
  it("is true only when the query begins with an accession", () => {
    expect(startsWithAccession("GSE12345")).toBe(true);
    expect(startsWithAccession("E-MTAB-10381 - ATAC-seq of iPSC")).toBe(true);
    expect(startsWithAccession("role of GSE12345 in cancer")).toBe(false);
    expect(startsWithAccession("brain scrna")).toBe(false);
    expect(startsWithAccession("GSE12345abc")).toBe(false); // no boundary
    expect(startsWithAccession("CRA000004")).toBe(true);
    expect(startsWithAccession("HRA007928 nasopharyngeal carcinoma")).toBe(
      true,
    );
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
      isSubmission: false,
    });
  });

  it("flags a submission accession for async resolution", () => {
    for (const raw of ["SRA788656", "ERA217948", "DRA000900"]) {
      const accs = parseAccessions(raw);
      expect(accs).toEqual([
        { raw, url: `/submission/${raw}`, isPrj: false, isSubmission: true },
      ]);
    }
  });

  it("does not mistake a study/experiment accession for a submission", () => {
    // SRA is submission; SRP/SRX/SRR/SRS are not.
    expect(parseAccessions("SRP042645")[0].isSubmission).toBe(false);
    expect(parseAccessions("SRX4795903")[0].isSubmission).toBe(false);
    expect(startsWithAccession("SRA788656")).toBe(true);
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

import { describe, it, expect } from "vitest";
import { dbForAccession } from "./db-colors";

describe("dbForAccession", () => {
  it("classifies each archive's accession shapes", () => {
    expect(dbForAccession("GSE196830")).toBe("geo");
    expect(dbForAccession("SRP123456")).toBe("sra");
    expect(dbForAccession("PRJNA123")).toBe("sra");
    expect(dbForAccession("ERP123456")).toBe("ena");
    expect(dbForAccession("PRJEB123")).toBe("ena");
    expect(dbForAccession("E-MTAB-10381")).toBe("arrayexpress");
    expect(dbForAccession("CRA000004")).toBe("gsa");
    expect(dbForAccession("cancer")).toBeNull();
  });

  it("keeps DDBJ out of SRA and DDBJ GEA out of ArrayExpress", () => {
    expect(dbForAccession("DRP000001")).toBe("ddbj");
    expect(dbForAccession("DRX000001")).toBe("ddbj");
    expect(dbForAccession("DRR000001")).toBe("ddbj");
    expect(dbForAccession("DRS000001")).toBe("ddbj");
    expect(dbForAccession("PRJDB1884")).toBe("ddbj");
    expect(dbForAccession("E-GEAD-282")).toBe("gea");
  });
});

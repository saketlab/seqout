import { describe, it, expect } from "vitest";
import { ARCHIVES } from "./constants";
import {
  ARCHIVE_BY_DB,
  DB_BADGE_FG,
  DB_COLOR_MAP,
  DB_COLORS,
  DB_LABELS,
  DB_ORDER,
  dbForAccession,
  dbForArchive,
} from "./db-colors";

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

  it("keeps DRA out of SRA and GEA out of ArrayExpress", () => {
    expect(dbForAccession("DRP000001")).toBe("dra");
    expect(dbForAccession("DRX000001")).toBe("dra");
    expect(dbForAccession("DRR000001")).toBe("dra");
    expect(dbForAccession("DRS000001")).toBe("dra");
    expect(dbForAccession("PRJDB1884")).toBe("dra");
    expect(dbForAccession("E-GEAD-282")).toBe("gea");
  });
});

describe("palette alignment", () => {
  it("gives every chart line the same colour as its badge", () => {
    for (const db of DB_ORDER) {
      expect(DB_COLORS[db]).toBe(DB_COLOR_MAP[db].hex);
    }
  });

  it("starts every OG gradient from the badge colour", () => {
    for (const db of DB_ORDER) {
      expect(DB_COLOR_MAP[db].og.primary).toBe(DB_COLOR_MAP[db].hex);
    }
  });

  it("labels and badge text cover every source", () => {
    for (const db of DB_ORDER) {
      expect(DB_LABELS[db]).toBeTruthy();
      expect(DB_BADGE_FG[db]).toBeTruthy();
    }
  });

  it("round-trips every archive through its db and back", () => {
    for (const archive of ARCHIVES) {
      expect(ARCHIVE_BY_DB[dbForArchive(archive)!]).toBe(archive);
    }
    for (const db of DB_ORDER) {
      expect(dbForArchive(ARCHIVE_BY_DB[db])).toBe(db);
    }
  });
});

// The OG cards, page metadata and badges all key off dbForAccession, so a
// project accession that resolves to the wrong archive is wrong everywhere.
describe("project accessions route to the right archive", () => {
  it.each([
    ["GSE196830", "geo"],
    ["SRP123456", "sra"],
    ["PRJNA807386", "sra"],
    ["ERP123456", "ena"],
    ["PRJEB12345", "ena"],
    ["DRP000001", "dra"],
    ["PRJDB1884", "dra"],
    ["E-MTAB-10381", "arrayexpress"],
    ["E-GEAD-282", "gea"],
    ["CRA000004", "gsa"],
    ["PRJCA000123", "gsa"],
  ])("%s → %s", (accession, db) => {
    expect(dbForAccession(accession)).toBe(db);
  });
});

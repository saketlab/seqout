import { describe, expect, it } from "vitest";
import { combinedHeaders, combineRows } from "./combinedCsv";

const base = [
  { Sample: "GSM1", Title: "first" },
  { Sample: "GSM2", Title: "second" },
  { Sample: "GSM3", Title: "no runs" },
];

const runsByGsm = new Map([
  [
    "GSM1",
    [
      { run_accession: "SRR1", fastq_ftp: "a.gz" },
      { run_accession: "SRR2", fastq_ftp: "b.gz" },
    ],
  ],
  ["GSM2", [{ run_accession: "SRR3", fastq_ftp: "c.gz" }]],
]);

const sampleFiles = new Map([["GSM1", ["s1.csv.gz", "s2.csv.gz"]]]);

const combine = () =>
  combineRows({
    baseRows: base,
    runsByGsm,
    projectFilesCell: "series_RAW.tar",
    sampleFiles,
  });

describe("combineRows", () => {
  it("emits one row per run", () => {
    const rows = combine();
    expect(rows.map((r) => r["sra:run_accession"])).toEqual([
      "SRR1",
      "SRR2",
      "SRR3",
      undefined, // GSM3 has no runs
    ]);
  });

  it("keeps a sample that has no runs", () => {
    const rows = combine();
    const orphan = rows.filter((r) => r.Sample === "GSM3");
    expect(orphan).toHaveLength(1);
    expect(orphan[0].Title).toBe("no runs");
  });

  it("repeats sample metadata across that sample's runs", () => {
    const gsm1 = combine().filter((r) => r.Sample === "GSM1");
    expect(gsm1).toHaveLength(2);
    expect(gsm1.every((r) => r.Title === "first")).toBe(true);
    // only the run columns differ
    expect(gsm1.map((r) => r["sra:fastq_ftp"])).toEqual(["a.gz", "b.gz"]);
  });

  it("prefixes run columns so they cannot shadow sample columns", () => {
    const clashing = combineRows({
      baseRows: [{ Sample: "GSM1", Title: "sample title" }],
      runsByGsm: new Map([["GSM1", [{ Title: "run title" }]]]),
      projectFilesCell: "",
      sampleFiles: new Map(),
    });
    expect(clashing[0].Title).toBe("sample title");
    expect(clashing[0]["sra:Title"]).toBe("run title");
  });

  it("attaches both levels of supplementary file", () => {
    const rows = combine();
    // project-level repeats on every row; sample-level only where it exists
    expect(rows.every((r) => r.supplementary_files === "series_RAW.tar")).toBe(
      true,
    );
    expect(rows[0].sample_supplementary_files).toBe("s1.csv.gz;s2.csv.gz");
    expect(rows[2].sample_supplementary_files).toBe("");
  });

  it("joins SRA-page rows on sample_alias instead of Sample", () => {
    const rows = combineRows({
      baseRows: [{ run_accession: "SRR9", sample_alias: "gsm7" }],
      runsByGsm: new Map(),
      projectFilesCell: "",
      sampleFiles: new Map([["GSM7", ["x.gz"]]]),
    });
    // case-insensitive: the alias is lowercase here, the file map is not
    expect(rows[0].sample_supplementary_files).toBe("x.gz");
  });
});

describe("combinedHeaders", () => {
  it("unions columns across rows, in first-seen order", () => {
    expect(
      combinedHeaders([
        { a: 1, b: 2 },
        { b: 3, c: 4 },
      ]),
    ).toEqual(["a", "b", "c"]);
  });
});

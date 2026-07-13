import { describe, expect, it } from "vitest";

import { fileUrl } from "./fileUrl";

describe("fileUrl", () => {
  it("prefixes https:// onto host-relative ENA paths", () => {
    expect(fileUrl("ftp.sra.ebi.ac.uk/vol1/fastq/DRR000/DRR000001.fastq.gz")).toBe(
      "https://ftp.sra.ebi.ac.uk/vol1/fastq/DRR000/DRR000001.fastq.gz",
    );
  });

  it("leaves absolute GSA urls alone", () => {
    const url = "https://download.cncb.ac.cn/gsa-human/HRA007968/HRR1846967.fq.gz";
    expect(fileUrl(url)).toBe(url);
  });

  it("leaves absolute DDBJ urls alone", () => {
    const url =
      "https://ddbj.nig.ac.jp/public/ddbj_database/dra/fastq/DRA000/DRA000001/DRX000001/DRR000001.fastq.bz2";
    expect(fileUrl(url)).toBe(url);
  });

  it("does not double-prefix an ftp:// url", () => {
    expect(fileUrl("ftp://download.big.ac.cn/gsa/CRA000005/CRD000073.gz")).toBe(
      "ftp://download.big.ac.cn/gsa/CRA000005/CRD000073.gz",
    );
  });
});

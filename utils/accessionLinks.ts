import {
  getExperimentUrl,
  getProjectUrl,
  getRunUrl,
  getSampleUrl,
} from "./shortUrl";

export function getInternalUrl(accession: string): string | null {
  const a = accession.toUpperCase();
  if (/^(GSE|[SED]RP)\d+$/.test(a) || /^E-[A-Z]{4}-\d+$/.test(a))
    return getProjectUrl(accession);
  if (/^[SED]RX\d+$/.test(a)) return getExperimentUrl(accession);
  if (/^[SED]RR\d+$/.test(a)) return getRunUrl(accession);
  if (/^([SED]RS|GSM)\d+$/.test(a)) return getSampleUrl(accession);
  return null;
}

export type ExternalArchive = { url: string; archive: string; label: string };

export function getExternalArchiveUrl(
  accession: string,
): ExternalArchive | null {
  const a = accession.toUpperCase();

  if (/^(GSM|GSE|GPL)\d+$/.test(a))
    return {
      url: `https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=${accession}`,
      archive: "GEO",
      label: "View on GEO",
    };
  if (/^E-[A-Z]{4}-\d+$/.test(a))
    return {
      url: `https://www.ebi.ac.uk/biostudies/ArrayExpress/studies/${accession}`,
      archive: "ArrayExpress",
      label: "View on ArrayExpress",
    };
  if (/^PRJ[A-Z]+\d+$/.test(a))
    return {
      url: `https://www.ncbi.nlm.nih.gov/bioproject/${accession}`,
      archive: "BioProject",
      label: "View on BioProject",
    };
  if (/^SAM[A-Z]*\d+$/.test(a))
    return {
      url: `https://www.ncbi.nlm.nih.gov/biosample/${accession}`,
      archive: "BioSample",
      label: "View on BioSample",
    };

  const m = a.match(/^([SED])R([PXRS])\d+$/);
  if (m) {
    const ns = m[1];
    const kind = m[2] as "P" | "X" | "R" | "S";
    if (ns === "E")
      return {
        url: `https://www.ebi.ac.uk/ena/browser/view/${accession}`,
        archive: "ENA",
        label: "View on ENA",
      };
    if (ns === "D") {
      const resource = { P: "sra-study", X: "sra-experiment", R: "sra-run", S: "sra-sample" }[kind];
      return {
        url: `https://ddbj.nig.ac.jp/resource/${resource}/${accession}`,
        archive: "DDBJ",
        label: "View on DDBJ",
      };
    }
    return {
      url:
        kind === "P"
          ? `https://trace.ncbi.nlm.nih.gov/Traces/?view=study&acc=${accession}`
          : `https://www.ncbi.nlm.nih.gov/sra/${accession}[accn]`,
      archive: "SRA",
      label: "View on SRA",
    };
  }

  return null;
}

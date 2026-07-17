import {
  getExperimentUrl,
  getProjectUrl,
  getRunUrl,
  getSampleUrl,
  getSubmissionUrl,
} from "./shortUrl";

// One accession-shape pattern, shared by the single-token classifier and the
// whole-string extractor so the two can never drift. PRJ* is recognized for
// extraction but routed via the async /prj resolver (see useSearchHistory).
const ACC_BODY =
  "(?:GSE\\d+|GSM\\d+|[SED]RA\\d+|[SED]R[PXRS]\\d+|PRJ[A-Z]+\\d+|E-[A-Z]{4}-\\d+|(?:CRA|CRX|HRA|HRX|HRS)\\d+)";
// End boundary: any non-alphanumeric, underscore included. \b treats _ as a word
// char, so it would reject "GSE244832_Kim" (a GEO supp-file prefix people paste);
// this lookahead still rejects "GSE12345abc" since a letter can't follow.
const ACC_END = "(?![0-9A-Za-z])";
const ACC_GLOBAL = new RegExp(`\\b${ACC_BODY}${ACC_END}`, "gi");
const ACC_ANCHORED = new RegExp(`^${ACC_BODY}${ACC_END}`, "i");

type AccessionKind = "project" | "experiment" | "run" | "sample";

const URL_BY_KIND: Record<AccessionKind, (a: string) => string> = {
  project: getProjectUrl,
  experiment: getExperimentUrl,
  run: getRunUrl,
  sample: getSampleUrl,
};

// Internal page kind for one accession, or null if unrecognized. PRJ* returns
// null here (it needs a server round-trip to resolve) — matching prior behavior.
function accessionKind(accession: string): AccessionKind | null {
  const a = accession.toUpperCase();
  if (/^(GSE|[SED]RP)\d+$/.test(a) || /^E-[A-Z]{4}-\d+$/.test(a))
    return "project";
  if (/^[SED]RX\d+$/.test(a)) return "experiment";
  if (/^[SED]RR\d+$/.test(a)) return "run";
  if (/^([SED]RS|GSM)\d+$/.test(a)) return "sample";
  // GSA (CNCB-NGDC): CRA/HRA studies, CRX/HRX experiments, SAMC/HRS samples have
  // internal pages; CRR/HRR runs have no download data → external link only.
  if (/^(CRA|HRA)\d+$/.test(a)) return "project";
  if (/^(CRX|HRX)\d+$/.test(a)) return "experiment";
  if (/^(HRS|SAMC)\d+$/.test(a)) return "sample";
  return null;
}

export function getInternalUrl(accession: string): string | null {
  const kind = accessionKind(accession);
  return kind ? URL_BY_KIND[kind](accession) : null;
}

export type ParsedAccession = {
  raw: string;
  url: string;
  isPrj: boolean;
  isSubmission: boolean;
};

// Every accession mentioned in a free-form query, in order, deduped. Known
// kinds route to their internal page; PRJ* and submission accessions get a URL
// with a flag set so the caller can resolve them server-side (one submission can
// map to many studies) before navigating in the primary tab.
export function parseAccessions(query: string): ParsedAccession[] {
  const out: ParsedAccession[] = [];
  const seen = new Set<string>();
  for (const match of query.toUpperCase().matchAll(ACC_GLOBAL)) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (/^PRJ[A-Z]+\d+$/.test(raw)) {
      out.push({
        raw,
        url: getProjectUrl(raw),
        isPrj: true,
        isSubmission: false,
      });
      continue;
    }
    if (/^[SED]RA\d+$/.test(raw)) {
      out.push({
        raw,
        url: getSubmissionUrl(raw),
        isPrj: false,
        isSubmission: true,
      });
      continue;
    }
    const kind = accessionKind(raw);
    if (kind)
      out.push({
        raw,
        url: URL_BY_KIND[kind](raw),
        isPrj: false,
        isSubmission: false,
      });
  }
  return out;
}

// True when the query *begins* with an accession — the signal that the user
// pasted "<accession> <title/notes>" (or a list) and wants to jump, not search.
// Anchoring on start avoids hijacking searches that merely mention an accession.
export function startsWithAccession(query: string): boolean {
  return ACC_ANCHORED.test(query.trim());
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
  if (/^E-GEAD-\d+$/.test(a))
    return {
      url: `https://ddbj.nig.ac.jp/search/entry/gea/${accession}`,
      archive: "GEA",
      label: "View on GEA",
    };
  if (/^E-[A-Z]{4}-\d+$/.test(a))
    return {
      url: `https://www.ebi.ac.uk/biostudies/ArrayExpress/studies/${accession}`,
      archive: "ArrayExpress",
      label: "View on ArrayExpress",
    };
  // GSA — CNCB-NGDC (China National Genomics Data Center). Checked before the
  // generic PRJ*/SAM* cases so PRJCA/SAMC route to GSA, not NCBI.
  if (/^CRA\d+$/.test(a))
    return {
      url: `https://ngdc.cncb.ac.cn/gsa/browse/${accession}`,
      archive: "GSA",
      label: "View on GSA",
    };
  if (/^HRA\d+$/.test(a))
    return {
      url: `https://ngdc.cncb.ac.cn/gsa-human/browse/${accession}`,
      archive: "GSA",
      label: "View on GSA",
    };
  if (/^(CRX|CRR|SAMC|PRJCA|HRX|HRR|HRS|HRI)\d+$/.test(a))
    return {
      url: `https://ngdc.cncb.ac.cn/search/all?q=${accession}`,
      archive: "GSA",
      label: "View on GSA",
    };
  if (/^PRJDB\d+$/.test(a))
    return {
      url: `https://ddbj.nig.ac.jp/resource/bioproject/${accession}`,
      archive: "DRA",
      label: "View on DRA",
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
      const resource = {
        P: "sra-study",
        X: "sra-experiment",
        R: "sra-run",
        S: "sra-sample",
      }[kind];
      return {
        url: `https://ddbj.nig.ac.jp/resource/${resource}/${accession}`,
        archive: "DRA",
        label: "View on DRA",
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

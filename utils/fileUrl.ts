const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function fileUrl(path: string): string {
  return HAS_SCHEME.test(path) ? path : `https://${path}`;
}

/**
 * Display/save names for a run's `;`-joined fastq_ftp, positionally aligned with
 * it.
 *
 * fastq_filenames is authoritative where present: a FASTQ served from NCBI's
 * originals has a version suffix in its object key (..._R1_001.fastq.gz.1) that
 * the actual file does not carry, so the URL basename is the wrong name. The API
 * fills the column for every run -- for ENA rows it is the URL basename already
 * -- so the fallback here only matters against an older API response.
 */
export function fastqFileNames(
  fastqFtp: string | null,
  fastqFilenames: string | null,
): string[] {
  const urls = fastqFtp ? fastqFtp.split(";").filter(Boolean) : [];
  const names = fastqFilenames ? fastqFilenames.split(";").filter(Boolean) : [];
  return urls.map((url, i) => names[i] || url.split("/").pop() || url);
}

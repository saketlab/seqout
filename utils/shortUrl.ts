/**
 * Generate a project URL
 * @param accession - Project accession (e.g., "GSE123456" or "SRP123456")
 * @returns Project URL path (e.g., "/p/GSE123456" or "/p/SRP123456")
 */
export function getProjectUrl(accession: string): string {
  return `/p/${accession}`;
}

// Alias for backward compatibility
export function getProjectShortUrl(accession: string): string {
  return getProjectUrl(accession);
}

export function getExperimentUrl(accession: string): string {
  return `/e/${accession}`;
}

export function getRunUrl(accession: string): string {
  return `/r/${accession}`;
}

export function getSampleUrl(accession: string): string {
  return `/s/${accession}`;
}

// Submission accession (SRA######/ERA######/DRA######) — the page resolves it to
// its one-or-many studies.
export function getSubmissionUrl(accession: string): string {
  return `/submission/${accession}`;
}

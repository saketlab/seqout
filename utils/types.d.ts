import type { DbSource } from "./db-colors";

export type SourceTotals = Record<
  DbSource,
  { projects: number; samples: number }
>;
export type LastUpdated = {
  last_updated: string | null;
  by_source?: Record<DbSource, string | null>;
};

export type EnrichedCrosstab = {
  group: string;
  breakdown: string;
  groups: {
    value: string;
    total: number;
    distinct: number;
    breakdowns: { value: string; count: number }[];
  }[];
};

export type SearchResult = {
  accession: string;
  title: string;
  summary: string;
  updated_at: string;
  organisms: string[] | null;
  source: string;
  rank: number;
  pmid: string | null;
  publication_title: string | null;
  journal: string | null;
  countries?: string[] | null;
  library_strategies?: string[] | null;
  instrument_models?: string[] | null;
  platforms?: string[] | null;
  doi: string | null;
  citation_count: number | null;
  authors: string | null;
  center_name: string | null;
  country_code: string | null;
  publications: unknown[] | null;
  sort_val?: string | number | null;
  is_single_cell?: boolean | null;
  single_cell_modality?: string | null;
};

export type SearchResults = SearchResult[];

export type StudyPublication = {
  pmid: string | null;
  title: string | null;
  journal: string | null;
  doi: string | null;
  pub_date: string | number | null;
  authors: string | null;
  issn: string | null;
  citation_count: number | null;
  journal_h_index: number | null;
  journal_i10_index: number | null;
  journal_2yr_mean_citedness: number | null;
  journal_cited_by_count: number | null;
  journal_works_count: number | null;
};

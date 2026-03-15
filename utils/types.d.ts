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
  doi: string | null;
  citation_count: number | null;
  authors: string | null;
  center_name: string | null;
  publications: unknown[] | null;
  sort_val?: string | number | null;
};

export type SearchResults = SearchResult[];

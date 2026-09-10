"""
Sample-cohort filter names validated before requests.

Unknown filters fail locally because the server drops them silently.
"""

from __future__ import annotations

import difflib
from typing import Any

COHORT_FILTERS = frozenset(
    {
        # substring matching: "liver" matches "liver, left lobe"
        "tissue",
        "disease",
        "cell_type",
        "assay",
        "assay_category",
        "phenotype",
        "treatment",
        "development_stage",
        "sample_type",
        "genetic_modification",
        "strain",
        "cell_line",
        "ethnicity",
        "tissue_primary_site",
        # exact matching: "male" does not match "female"
        "organism",
        "sex",
        "taxid",
        "study_accession",
        # ontology CURIE, expanded through the graph unless told otherwise
        "disease_ontology_id",
        "tissue_ontology_id",
        "cell_type_ontology_id",
        "assay_ontology_id",
        "development_stage_ontology_id",
        # range filters require recorded values; age_min_years=0 means recorded age
        "age_min_years",
        "age_max_years",
        "min_cell_count",
        "max_cell_count",
        "min_gene_count",
        "max_gene_count",
        # read-derived, from the Pentimento screen of the reads
        "single_cell_only",
        "has_viral_reads",
        "has_bacterial_reads",
        "hpv_type",
        "microbe",
        "microbe_class",
        "microbe_min_breadth",
        "microbe_min_kmer_mass",
        "microbe_validated_only",
    }
)

SORTABLE = ("sample", "study_accession", "age_days", "cell_count", "gene_count")

# /samples/search caps a page at 500 rows.
PAGE = 500


def check_filters(filters: dict[str, Any]) -> None:
    """Refuse a filter the cohort search does not have, and suggest the real one."""
    unknown = sorted(set(filters) - COHORT_FILTERS)
    if not unknown:
        return
    near = [
        m
        for name in unknown
        for m in difflib.get_close_matches(name, sorted(COHORT_FILTERS), n=2)
    ]
    msg = f"unknown sample filter(s): {', '.join(unknown)}."
    if near:
        msg += f" Did you mean {', '.join(dict.fromkeys(near))}?"
    msg += " See help(sq.sample_search) for the filters."
    raise ValueError(msg)

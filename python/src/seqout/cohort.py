"""
Filter names for the sample cohort, checked before a request is made.

An unknown filter would be dropped by the server without a word, which is the
same failure the search models were changed to prevent. The set is checked here
instead, with a suggestion when the name is close to a real one.
"""

from __future__ import annotations

import difflib
from typing import Any

COHORT_FILTERS = frozenset(
    {
        # Substring: "liver" matches "liver, left lobe".
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
        # Exact, case-insensitive: "male" as a substring also matches "female".
        "organism",
        "sex",
        "taxid",
        "study_accession",
        # Ontology CURIE, expanded through the graph unless told otherwise.
        "disease_ontology_id",
        "tissue_ontology_id",
        "cell_type_ontology_id",
        "assay_ontology_id",
        "development_stage_ontology_id",
        # Ranges. An age filter excludes a sample whose age was never
        # recorded, so age_min_years=0 means "has a recorded age".
        "age_min_years",
        "age_max_years",
        "min_cell_count",
        "max_cell_count",
        "min_gene_count",
        "max_gene_count",
        # Read-derived, from the Pentimento screen of the reads themselves.
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

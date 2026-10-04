"""
Sample-cohort filter names validated before requests, and cohort helpers.

Unknown filters fail locally because the server drops them silently.
"""

from __future__ import annotations

import difflib
from typing import TYPE_CHECKING, Any

import pandas as pd

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence

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


def check_names(
    given: Iterable[str], allowed: Iterable[str], noun: str, see: str
) -> None:
    """Refuse a filter name an endpoint does not have, and suggest the real one."""
    known = sorted(allowed)
    unknown = sorted(set(given) - set(known))
    if not unknown:
        return
    near = [m for name in unknown for m in difflib.get_close_matches(name, known, n=2)]
    msg = f"unknown {noun}(s): {', '.join(unknown)}."
    if near:
        msg += f" Did you mean {', '.join(dict.fromkeys(near))}?"
    msg += f" See {see} for the filters."
    raise ValueError(msg)


def check_filters(filters: dict[str, Any]) -> None:
    """Refuse a filter the cohort search does not have, and suggest the real one."""
    check_names(filters, COHORT_FILTERS, "sample filter", "help(sq.sample_search)")


DETECTION_COLUMNS = ("organism", "class", "kingdom", "breadth_frac", "kmer_mass")


def _scalar(value: Any) -> Any:
    """Keep one value; a missing or many-valued field becomes None."""
    if value is None or isinstance(value, (list, tuple, dict)):
        return None
    return value


def _sample_microbes(samples: Any) -> list[tuple[Any, list[dict] | None]]:
    """Pair each sample's accession with its detections, from rows or a frame."""
    if isinstance(samples, pd.DataFrame):
        if "microbes" not in samples.columns:
            return []
        names = (
            samples["sample"] if "sample" in samples.columns else [None] * len(samples)
        )
        return list(zip(names, samples["microbes"], strict=True))
    out = []
    for s in samples:
        row = s if isinstance(s, dict) else vars(s)
        out.append((row.get("sample"), row.get("microbes")))
    return out


def microbe_detections(
    samples: Any,
    *,
    validated_only: bool = False,
    columns: Sequence[str] = DETECTION_COLUMNS,
) -> pd.DataFrame:
    """
    Flatten a cohort's microbe detections into one row per detection.

    Each row is one (sample, organism, run) the Pentimento screen found.

    Args:
        samples: A `sample_search` result, its `to_df()`, or its rows. The
            detections are only there when a `microbe*` filter was given.
        validated_only: Keep only detections that pass the stored gates.
        columns: Detection fields to keep beside `sample`.

    Raises:
        ValueError: When no sample carries a `microbes` field.

    """
    pairs = _sample_microbes(samples)
    if pairs and all(m is None for _, m in pairs):
        msg = (
            "samples carry no microbes field. sample_search adds one when a "
            "microbe* filter is given, e.g. sample_search(microbe='HPV')."
        )
        raise ValueError(msg)
    rows = []
    for sample, detections in pairs:
        for d in detections or []:
            if validated_only and not (
                d.get("is_validated_viral") is True
                or d.get("is_validated_bacterial") is True
            ):
                continue
            rows.append({"sample": sample, **{c: _scalar(d.get(c)) for c in columns}})
    out = pd.DataFrame(rows, columns=["sample", *columns])
    for c in ("breadth_frac", "kmer_mass"):
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    return out

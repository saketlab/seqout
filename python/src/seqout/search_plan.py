"""
Choose the search endpoint and local result work.

Date bounds and sort apply locally for structured search.
Filters with conflicting endpoint meanings are rejected.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from seqout.models.api_models import (
    SearchParams,
    SearchResult,
    StructuredSearchParams,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable

# defined here to avoid the client/import cycle
SearchParamsType = SearchParams | StructuredSearchParams

# full-text-only fields; exclude_ontology belongs here because expansion does
FULLTEXT_ONLY = frozenset(
    {
        "db",
        "library_source",
        "date_from",
        "date_to",
        "exclude_ontology",
        "long_read",
        "case_sensitive",
    }
)

# applied locally when structured filters choose the structured endpoint
# updated_at matches the full-text endpoint's date field
LOCAL_FILTERS = frozenset({"date_from", "date_to"})

# structured-only filters; source is translated from db
STRUCTURED_ONLY = frozenset(
    {
        "assay_l1",
        "assay_l2",
        "geo_country",
        "geo_country_code",
        "geo_country_code_iso2",
        "geo_city",
        "geo_state",
        "geo_district",
        "geo_postcode",
        "geo_lat",
        "geo_lng",
        "geo_radius_km",
        "published_after",
        "published_before",
        "pub_date_after",
        "pub_date_before",
        "sample_tissue",
        "sample_disease",
        "sample_cell_type",
    }
)

# Unsupported filters with replacement guidance
REMOVED = {
    "year_from": (
        "bounded the publication year on one endpoint and the last-updated "
        "year on the other. Use date_from for the record's date, or "
        "published_after for the study's release date."
    ),
    "year_to": (
        "bounded the publication year on one endpoint and the last-updated "
        "year on the other. Use date_to for the record's date, or "
        "published_before for the study's release date."
    ),
    "center": (
        "is ignored by the full-text search. Every result row carries "
        "center_name; filter the results on that instead."
    ),
}

# server boolean trigger: grouping, quotes, wildcard, or uppercase operator
_BOOLEAN = re.compile(r'[()"*]|\b(?:OR|AND|NOT)\b')


def is_boolean_query(q: str | None) -> bool:
    """Whether the server reads this query as a boolean expression."""
    return bool(q) and bool(_BOOLEAN.search(q))


@dataclass
class SearchPlan:
    """Search request plus local filtering or sorting work."""

    params: SearchParamsType
    structured_endpoint: bool = False
    date_from: str | None = None
    date_to: str | None = None
    sortby: str | None = None
    order: str = "desc"

    @property
    def has_local_work(self) -> bool:
        """Whether all pages must be read before applying a limit."""
        return any((self.date_from, self.date_to, self.sortby))


def plan_search(
    q: str | None = None,
    /,
    sortby: str | None = None,
    order: str = "desc",
    structured: bool | None = None,
    *,
    expand: bool = True,
    **filters: Any,
) -> SearchPlan:
    """
    Build the endpoint request plus local work.

    `expand=False` uses exact terms through the server's `structured` wire flag.
    `exclude_ontology` removes selected ontology sources from expansion.
    `case_sensitive=True` keeps matches with the query words in the exact case.
    """
    filters = {k: v for k, v in filters.items() if v is not None}
    _reject_removed(filters)

    narrowed = bool(STRUCTURED_ONLY & filters.keys())
    if not narrowed:
        if "source" in filters:  # the two names mean the same archive
            filters["db"] = filters.pop("source")
        return SearchPlan(
            params=SearchParams(
                q=q,
                sortby=sortby,
                order=order,
                # one wire flag covers expansion off and exact-term requests
                structured=structured or (not expand) or None,
                **filters,
            )
        )

    # structured endpoint uses exact terms; reject full-text-only switches below

    _reject_boolean(q, structured, filters)
    _reject_unanswerable(filters)
    if "db" in filters:
        filters["source"] = filters.pop("db")
    local = {k: filters.pop(k) for k in LOCAL_FILTERS & filters.keys()}

    return SearchPlan(
        params=StructuredSearchParams(q=q, **filters),
        structured_endpoint=True,
        date_from=local.get("date_from"),
        date_to=local.get("date_to"),
        sortby=sortby,
        order=order,
    )


def apply_plan(results: Iterable[SearchResult], plan: SearchPlan) -> list[SearchResult]:
    """Apply the day bounds and the sort the endpoint could not."""
    rows = list(results)
    if plan.date_from or plan.date_to:
        rows = [r for r in rows if _within(r.updated_at, plan.date_from, plan.date_to)]
    if plan.sortby:
        rows.sort(key=_sort_key(plan.sortby), reverse=plan.order == "desc")
    return rows


def _within(updated_at: str | None, date_from: str | None, date_to: str | None) -> bool:
    if not updated_at:
        return False
    day = updated_at[:10]
    if date_from and day < date_from:
        return False
    return not (date_to and day > date_to)


def _sort_key(sortby: str) -> Callable[[SearchResult], Any]:
    if sortby == "citations":
        return lambda r: r.citation_count or 0
    if sortby == "journal":
        return lambda r: r.journal or ""
    return lambda r: r.updated_at or ""  # year


def _reject_removed(filters: dict[str, Any]) -> None:
    for name, why in REMOVED.items():
        if name in filters:
            msg = f"{name} {why}"
            raise ValueError(msg)


def _reject_unanswerable(filters: dict[str, Any]) -> None:
    clash = FULLTEXT_ONLY - LOCAL_FILTERS - {"db"}
    bad = sorted(clash & filters.keys())
    if not bad:
        return
    with_ = sorted(STRUCTURED_ONLY & filters.keys())
    msg = (
        f"{', '.join(bad)} cannot be combined with {', '.join(with_)}: "
        f"no search answers both. Drop one of them."
    )
    raise ValueError(msg)


def _reject_boolean(
    q: str | None, structured: bool | None, filters: dict[str, Any]
) -> None:
    if not (structured or is_boolean_query(q)):
        return
    with_ = sorted(STRUCTURED_ONLY & filters.keys())
    msg = (
        f"a boolean query cannot be combined with {', '.join(with_)}: only the "
        'full-text search reads (), "", * and OR/AND/NOT, and the other one '
        "would read them as words. Drop the filter, or write the query as "
        "plain text."
    )
    raise ValueError(msg)

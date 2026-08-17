"""
Pick the endpoint from the filters, and do in Python what it cannot do.

Two endpoints answer a project search and they take different filter sets, so
without this the caller has to know which one owns which filter. That is an
implementation detail of the server, not something a client should teach.

This mirrors the R client (``R/search.R``) so the two answer the same question
the same way:

* the filters choose the endpoint, never the caller;
* ``date_from``/``date_to`` and ``sortby`` are applied here when the structured
  endpoint wins, because it has neither and FastAPI drops a query parameter it
  does not declare -- so sending them would fail in silence;
* ``year_from``, ``year_to`` and ``center`` are refused, because each meant two
  different things depending on which endpoint answered.
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

# Defined here rather than imported from the client, which imports this module.
SearchParamsType = SearchParams | StructuredSearchParams

# Only the full-text endpoint has these.
FULLTEXT_ONLY = frozenset({"db", "library_source", "date_from", "date_to"})

# Applied here rather than sent, when a structured filter took the other
# endpoint. `updated_at` is on every result row and is the column the full-text
# endpoint bounds, so the answer is the same one it would have given.
LOCAL_FILTERS = frozenset({"date_from", "date_to"})

# Only the structured endpoint has these; naming one selects it.
# `source` is deliberately absent: it is the structured spelling of `db`, so it
# is translated rather than treated as a reason to change endpoint.
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

# Gone, with what to use instead. Each of these meant one thing on one endpoint
# and something else on the other, which is not a filter, it is a coin toss.
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

# Mirrors _TRIGGER in the API's boolean_query.py: a group, a quoted phrase, a
# wildcard, or a standalone uppercase operator. Lowercase "colon or gut" is
# prose and must not trigger.
_BOOLEAN = re.compile(r'[()"*]|\b(?:OR|AND|NOT)\b')


def is_boolean_query(q: str | None) -> bool:
    """Say whether the server would read this query as a boolean expression."""
    return bool(q) and bool(_BOOLEAN.search(q))


@dataclass
class SearchPlan:
    """One search, and whatever has to happen to its results afterwards."""

    params: SearchParamsType
    structured_endpoint: bool = False
    date_from: str | None = None
    date_to: str | None = None
    sortby: str | None = None
    order: str = "desc"

    @property
    def has_local_work(self) -> bool:
        """
        Say whether the results need filtering or reordering after they arrive.

        When they do, every page has to be read before a limit can be applied:
        a row dropped or moved here has to move before the count does.
        """
        return any((self.date_from, self.date_to, self.sortby))


def plan_search(
    q: str | None = None,
    /,
    sortby: str | None = None,
    order: str = "desc",
    structured: bool | None = None,
    **filters: Any,
) -> SearchPlan:
    """Build the request, and say what is left for the client to do."""
    filters = {k: v for k, v in filters.items() if v is not None}
    _reject_removed(filters)

    narrowed = bool(STRUCTURED_ONLY & filters.keys())
    if not narrowed:
        if "source" in filters:  # the two names mean the same archive
            filters["db"] = filters.pop("source")
        return SearchPlan(
            params=SearchParams(
                q=q, sortby=sortby, order=order, structured=structured, **filters
            )
        )

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

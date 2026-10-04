"""Live country, single-cell and disease collections."""

from __future__ import annotations

from contextlib import contextmanager

import pytest
import requests

from seqout import connect


def _looks_offline(exc: Exception) -> bool:
    return isinstance(
        exc, (requests.exceptions.ConnectionError, requests.exceptions.Timeout)
    )


@contextmanager
def _skip_if_offline():
    try:
        yield
    except Exception as e:
        if _looks_offline(e):
            pytest.skip(f"API unreachable: {e}")
        raise


@pytest.mark.network
def test_country_summary_and_projects_agree_on_totals():
    sq = connect("api")
    with _skip_if_offline():
        summary = sq.fetch_country_summary("US")
        projects = sq.fetch_country_projects("US", limit=5)
    assert summary.studies > 0
    assert projects.total == summary.studies
    assert len(projects) == 5


@pytest.mark.network
def test_country_facets_feed_projects_filters():
    sq = connect("api")
    with _skip_if_offline():
        facets = sq.fetch_country_facets("US")
    assert "organism" in facets
    organism = facets["organism"][0].value
    projects = sq.fetch_country_projects("US", organism=organism, limit=1)
    assert projects.total > 0


@pytest.mark.network
def test_singlecell_summary_and_projects_agree_on_totals():
    sq = connect("api")
    with _skip_if_offline():
        summary = sq.fetch_singlecell_summary()
        projects = sq.fetch_singlecell_projects(limit=5)
    assert summary.studies > 0
    assert projects.total == summary.studies


@pytest.mark.network
@pytest.mark.parametrize("collection", ["rare", "nord"])
def test_curated_disease_collections_agree_on_totals(collection):
    sq = connect("api")
    with _skip_if_offline():
        summary = sq.fetch_disease_summary(collection)
        projects = sq.fetch_disease_projects(collection, limit=5)
    assert summary.studies > 0
    assert len(projects) == 5


@pytest.mark.network
def test_disease_aliases_resolves_a_known_name():
    sq = connect("api")
    with _skip_if_offline():
        out = sq.fetch_disease_aliases("liver", limit=3)
    assert out.total > 0
    assert len(out) <= 3


@pytest.mark.network
def test_tissue_and_disease_term_are_not_yet_deployed():
    """/tissue and free-text /disease 404 until deployed; then assert real data."""
    sq = connect("api")
    with _skip_if_offline():
        with pytest.raises(requests.HTTPError):
            sq.fetch_tissue_summary("liver")
        with pytest.raises(requests.HTTPError):
            sq.fetch_disease_summary("fatty liver disease")

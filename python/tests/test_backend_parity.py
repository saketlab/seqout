"""Both backends expose the same methods and models."""

import pytest

from seqout.clients.api import SeqoutAPIClient
from seqout.clients.parquet import SeqoutParquetClient
from seqout.counts import SeqoutCounts
from seqout.models.parquet_models import GeoSample, Study

SHARED_METHODS = [
    "fetch_study",
    "fetch_samples",
    "fetch_project_metadata",
    "fetch_geo_sample_detailed_metadata",
    "fetch_run",
    "fetch_study_runs",
    "fetch_study_experiments",
    "resolve_study",
    "gsm_series",
    "linked_study",
    "linked_geo",
    "download_files",
    "paper",
    "author",
    "classify",
    "summaries",
    "citations",
    "fetch_citations",
    "sample_search",
    "fetch_single_cell",
    "fetch_microbes",
    "single_cell",
    "microbes",
    "ontology",
    "fetch_ontology_term",
    "fetch_longread_summary",
    "fetch_longread_facets",
    "fetch_longread_projects",
    "fetch_longread_chemistry",
    "longread_summary",
    "longread_facets",
    "longread_projects",
    "longread_chemistry",
    "fetch_country_summary",
    "fetch_country_facets",
    "fetch_country_projects",
    "country_summary",
    "country_facets",
    "country_projects",
    "fetch_singlecell_summary",
    "fetch_singlecell_facets",
    "fetch_singlecell_projects",
    "singlecell_summary",
    "singlecell_facets",
    "singlecell_projects",
    "fetch_perturbation_summary",
    "fetch_perturbation_facets",
    "fetch_perturbation_projects",
    "perturbation_summary",
    "perturbation_facets",
    "perturbation_projects",
    "fetch_spatial_summary",
    "fetch_spatial_facets",
    "fetch_spatial_projects",
    "spatial_summary",
    "spatial_facets",
    "spatial_projects",
    "fetch_disease_summary",
    "fetch_disease_facets",
    "fetch_disease_projects",
    "fetch_disease_aliases",
    "disease_summary",
    "disease_facets",
    "disease_projects",
    "disease_aliases",
    "fetch_tissue_summary",
    "fetch_tissue_facets",
    "fetch_tissue_projects",
    "tissue_summary",
    "tissue_facets",
    "tissue_projects",
    "fetch_search_suggest",
    "fetch_search_facets",
    "search_suggest",
    "search_facets",
    "fetch_organisms",
    "fetch_library_strategies",
    "fetch_instrument_models",
    "fetch_platforms",
    "fetch_centers",
    "fetch_journals",
    "fetch_assays",
    "list_organisms",
    "list_library_strategies",
    "list_instrument_models",
    "list_platforms",
    "list_centers",
    "list_journals",
    "list_assays",
    "fetch_single_cell_studies",
    "fetch_single_cell_status",
    "fetch_single_cell_summary",
    "single_cell_studies",
    "single_cell_status",
    "single_cell_summary",
    "tables",
]


@pytest.mark.parametrize("method", SHARED_METHODS)
def test_both_clients_expose(method):
    assert hasattr(SeqoutAPIClient, method), f"api client lost {method}"
    assert hasattr(SeqoutParquetClient, method), f"parquet client lost {method}"


def test_counts_rejects_a_client_that_cannot_back_it():
    class Useless:
        pass

    with pytest.raises(TypeError) as excinfo:
        SeqoutCounts("GSE1", client=Useless())
    msg = str(excinfo.value)
    assert "cannot back SeqoutListCounts" in msg
    assert "connect('api')" in msg
    assert "connect('parquet')" in msg


def test_counts_accepts_a_client_carrying_only_what_it_calls():
    class Stub:
        def fetch_geo_sample_detailed_metadata(self, _a): ...
        def download_files(self, urls, out_dir, **kw): ...

    assert SeqoutCounts("GSE1", client=Stub()).accession == "GSE1"


def _channel(characteristics):
    return {
        "position": 1,
        "characteristics": characteristics,
        "molecule": "total RNA",
        "organism": "Homo sapiens",
        "taxonomy_id": 9606,
        "source": "PBMC",
        "extract_protocol": None,
        "growth_protocol": None,
        "treatment_protocol": None,
    }


def _sample(characteristics):
    return GeoSample.model_validate(
        {
            "accession": "GSM1",
            "supplementary_data": [],
            "channel_count": 1,
            "channels": [_channel(characteristics)],
            "platform": "GPL24676",
        }
    )


def test_one_characteristic_arrives_as_a_bare_object():
    # GEO does not wrap a lone Characteristics in a list
    ch = _sample({"@tag": "tissue", "#text": "PBMC"}).channels[0]
    assert ch.characteristics == [{"@tag": "tissue", "#text": "PBMC"}]


def test_several_characteristics_stay_a_list():
    given = [{"@tag": "tissue", "#text": "PBMC"}, {"@tag": "age", "#text": "45"}]
    assert _sample(given).channels[0].characteristics == given


def test_absent_characteristics_becomes_empty():
    assert _sample(None).channels[0].characteristics == []


def test_geo_sample_answers_to_platform_ref():
    sample = _sample([])
    assert sample.platform_ref == sample.platform == "GPL24676"


def test_study_leaves_unavailable_fields_none_not_empty():
    n_samples = 3
    study = Study(
        accession="GSE1",
        title="t",
        citation_count=0,
        aliases=[],
        organisms=[],
        num_samples=n_samples,
        center_names=[],
        is_single_cell=False,
    )
    assert study.library_strategies is None
    assert study.assay_l1 is None
    assert study.assay_l2 is None
    assert study.num_experiments is None
    assert study.num_samples == n_samples


@pytest.mark.network
def test_fetch_study_agrees_across_backends():
    from seqout import connect

    api, parquet = connect("api"), connect("parquet")
    a, p = api.fetch_study("GSE297547"), parquet.fetch_study("GSE297547")
    assert a.accession == p.accession
    assert a.title == p.title
    assert a.num_samples == p.num_samples
    assert a.is_single_cell == p.is_single_cell
    # the REST API carries no assay breakdown; parquet does
    assert a.assay_l2 is None
    assert p.assay_l2


@pytest.mark.network
def test_counts_manifest_agrees_across_backends():
    from seqout import connect

    api, parquet = connect("api"), connect("parquet")
    for accession in ("GSE297547", "GSM8994520"):
        a = SeqoutCounts(accession, client=api, progress=False)
        p = SeqoutCounts(accession, client=parquet, progress=False)
        assert len(a.files()) == len(p.files())
        assert sorted(a.manifest()["unit"]) == sorted(p.manifest()["unit"])

"""Bulk RNA-seq layouts: per-sample tables and series-level matrices."""

import gzip

import numpy as np
import pandas as pd
import pytest

from seqout.counts import SeqoutCounts, bind_counts
from seqout.counts_model import CountMatrix, match_gsm
from seqout.counts_readers import read_table

FIELDS = pd.DataFrame(
    {
        "title": ["NAFL_1", "NAFL_2", "Obese_1"],
        "description": ["869", "872", "2683"],
        "disease": ["NAFLD", "NAFLD", "obese"],
    },
    index=["GSM1", "GSM2", "GSM3"],
)


def test_series_columns_map_to_gsms_through_a_one_to_one_field():
    # GEO drops the leading zero the matrix header keeps
    assert match_gsm(["0869", "2683"], FIELDS) == ["GSM1", "GSM3"]
    assert match_gsm(["NAFL_2"], FIELDS) == ["GSM2"]


def test_an_ambiguous_or_partial_match_maps_nothing():
    assert match_gsm(["NAFLD"], FIELDS) is None
    assert match_gsm(["0869", "9999"], FIELDS) is None


def test_numeric_sample_ids_under_a_key_header_stay_a_header(tmp_path):
    path = tmp_path / "GSE1_counts.txt.gz"
    with gzip.open(path, "wt") as f:
        f.write("key\t0869\t0872\nENSG1\t1\t2\nENSG2\t3\t4\n")
    x, obs, var = read_table(path)
    assert list(obs.index) == ["0869", "0872"]
    assert list(var.index) == ["ENSG1", "ENSG2"]
    assert x.shape == (2, 2)


def test_agilent_feature_extraction_output_is_named(tmp_path):
    path = tmp_path / "GSM1.txt"
    path.write_text(
        "TYPE\ttext\tinteger\nFEPARAMS\tProtocol_Name\tScan\nDATA\tGE1\t1\n"
    )
    with pytest.raises(ValueError, match="Agilent Feature Extraction"):
        read_table(path)


def test_a_one_column_bulk_unit_is_not_renamed_twice_by_bind():
    pytest.importorskip("anndata")

    def one(gsm: str) -> CountMatrix:
        obs = pd.DataFrame({"label": [f"{gsm}_S1"]}, index=[gsm])
        var = pd.DataFrame(index=["g1", "g2"])
        return CountMatrix(
            X=np.array([[1, 2]]), obs=obs, var=var, kind="bulk", fmt="table"
        )

    a = bind_counts({"GSM1": one("GSM1"), "GSM2": one("GSM2")})
    assert list(a.obs_names) == ["GSM1", "GSM2"]
    assert list(a.obs["label"]) == ["GSM1_S1", "GSM2_S1"]


@pytest.mark.network
def test_per_sample_bulk_series_names_columns_by_gsm():
    pytest.importorskip("anndata")
    with SeqoutCounts("GSE135251", progress=False) as c:
        a = c.anndata(sample=["GSM3998167", "GSM3998168"])
    assert a.shape == (2, 64253)
    assert list(a.obs_names) == ["GSM3998167", "GSM3998168"]
    assert list(a.obs["label"]) == [
        "GSM3998167_017-Ann-Daly_S1",
        "GSM3998168_018-Ann-Daly_S2",
    ]
    assert a.obs["disease"].notna().all()


@pytest.mark.network
def test_series_level_bulk_matrix_maps_columns_to_gsms():
    pytest.importorskip("anndata")
    with SeqoutCounts("GSE126848", progress=False) as c:
        a = c.anndata()
    # the R client asserts the same dims and names
    assert a.shape == (57, 19786)
    assert list(a.obs_names[:2]) == ["GSM3615324", "GSM3615338"]
    assert list(a.obs["label"][:2]) == ["0869", "0872"]
    assert [a.var_names[0], a.var_names[-1]] == ["ENSG00000186092", "ENSG00000160310"]
    assert a.obs_names.str.startswith("GSM").all()
    assert a.obs["disease"].notna().all()

"""Cohort microbe flattener and exported file names."""

from __future__ import annotations

import pandas as pd
import pytest

import seqout
from seqout.models.cohort_models import Cohort, CohortSample


def _det(organism, *, viral=False, bacterial=False, breadth=0.2, **extra):
    return {
        "organism": organism,
        "class": "virus",
        "kingdom": "viral",
        "breadth_frac": breadth,
        "kmer_mass": 100.5,
        "run_accession": "ERR1",
        "is_validated_viral": viral,
        "is_validated_bacterial": bacterial,
        **extra,
    }


def _cohort():
    return Cohort(
        [
            CohortSample(
                sample="S1", microbes=[_det("HPV18"), _det("HPV16", viral=True)]
            ),
            CohortSample(sample="S2", microbes=[]),
            CohortSample(sample="S3", microbes=[_det("E. coli", bacterial=True)]),
        ]
    )


class TestMicrobeDetections:
    def test_one_row_per_detection(self):
        out = seqout.microbe_detections(_cohort())
        assert list(out.columns) == [
            "sample",
            "organism",
            "class",
            "kingdom",
            "breadth_frac",
            "kmer_mass",
        ]
        assert out["sample"].tolist() == ["S1", "S1", "S3"]
        assert out["breadth_frac"].dtype.kind == "f"

    def test_validated_only_keeps_gated_detections(self):
        out = seqout.microbe_detections(_cohort(), validated_only=True)
        assert out["organism"].tolist() == ["HPV16", "E. coli"]

    def test_a_frame_from_to_df_works_too(self):
        out = seqout.microbe_detections(_cohort().to_df(), columns=["organism"])
        assert out.to_dict("records")[0] == {"sample": "S1", "organism": "HPV18"}

    def test_a_list_valued_field_becomes_missing(self):
        c = Cohort([CohortSample(sample="S1", microbes=[_det("X", breadth=[1, 2])])])
        assert pd.isna(seqout.microbe_detections(c).loc[0, "breadth_frac"])

    def test_no_detections_is_an_empty_frame_with_the_columns(self):
        out = seqout.microbe_detections(Cohort([CohortSample(sample="S", microbes=[])]))
        assert out.empty
        assert list(out.columns)[:2] == ["sample", "organism"]

    def test_samples_without_a_microbes_field_are_refused(self):
        with pytest.raises(ValueError, match="microbe"):
            seqout.microbe_detections(Cohort([CohortSample(sample="S")]))


@pytest.mark.parametrize(
    ("name", "role"),
    [
        ("GSM123_matrix.mtx.gz", "mtx"),
        ("GSM123_barcodes.tsv.gz", "barcodes"),
        ("GSE1_cell_metadata.csv.gz", "metadata"),
        ("GSM1_fragments.tsv.gz", "skip"),
        ("https://x/GSE1_counts.h5ad", "h5ad"),
    ],
)
def test_file_role_names_the_role(name, role):
    assert seqout.file_role(name) == role


def test_file_name_rules_are_exported():
    assert seqout.is_filtered("filtered_feature_bc_matrix.h5")
    assert not seqout.is_filtered("unfiltered.h5")
    assert seqout.group_key("GSM1_barcodes.tsv.gz") == seqout.group_key(
        "GSM1_matrix.mtx.gz"
    )

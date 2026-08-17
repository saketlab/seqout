import numpy as np
import pandas as pd
import pytest

from seqout.counts import SeqoutCounts
from seqout.counts_model import (
    CountMatrix,
    SuppFile,
    check_hdf5_complete,
    group,
    infer_kind,
)
from seqout.counts_names import Role, classify, group_key, is_filtered

FTP = "https://ftp.ncbi.nlm.nih.gov/geo/samples/GSM8207nnn/GSM8207499/suppl"
_R_WITHOUT_PKGS = 42  # R is present and Seurat/SCE packages are absent
_TRIPLET_PARTS = ("matrix.mtx.gz", "barcodes.tsv.gz", "features.tsv.gz")


def _triplet(gsm: str, prefix: str) -> list[SuppFile]:
    return [
        SuppFile(f"{FTP}/{prefix}_{part}", classify(f"{prefix}_{part}"), gsm)
        for part in _TRIPLET_PARTS
    ]


def test_classify_roles():
    assert classify("GSM123_matrix.mtx.gz") is Role.Mtx
    assert classify("GSM123_barcodes.tsv.gz") is Role.Barcodes
    assert classify("GSM123_features.tsv.gz") is Role.Features
    assert classify("GSM123_genes.tsv.gz") is Role.Features
    assert classify("GSM123_filtered_feature_bc_matrix.h5") is Role.H5
    assert classify("GSE1_adata.h5ad.gz") is Role.H5ad
    assert classify("GSE1_seurat.rds.gz") is Role.Rds
    assert classify("GSE1_RAW.tar") is Role.Tar
    assert classify("GSE1_counts.csv.gz") is Role.Table
    assert classify("GSM1_atac_fragments.tsv.gz") is Role.Skip
    assert classify("GSM1_README.txt") is Role.Skip
    assert classify("GSM1_tissue_positions_list.csv.gz") is Role.Skip
    assert classify("GSM1.bam") is Role.Skip
    assert classify("GSM1_image.tif.gz") is Role.Skip
    assert classify("GSM1_scalefactors.json.gz") is Role.Skip


def test_sidecar_list_does_not_eat_real_counts_files():
    for name in (
        "GSM1.bwa_counts.tsv.gz",
        "GSM1_summary_counts.tsv",
        "GSM1.bedtools_counts.tsv",
        "GSE1_rawcounts.json.tsv",
    ):
        assert classify(name) is Role.Table, name


def test_group_key_unites_a_triplet():
    keys = {
        group_key(n)
        for n in (
            "GSM123_pbmc_matrix.mtx.gz",
            "GSM123_pbmc_barcodes.tsv.gz",
            "GSM123_pbmc_features.tsv.gz",
        )
    }
    assert keys == {"gsm123_pbmc"}


def test_group_key_prefers_cellranger_dir():
    assert (
        group_key("GSM123/filtered_feature_bc_matrix/matrix.mtx.gz")
        == "gsm123/filtered_feature_bc_matrix"
    )
    assert group_key("GSM123/raw_feature_bc_matrix/matrix.mtx.gz") != group_key(
        "GSM123/filtered_feature_bc_matrix/matrix.mtx.gz"
    )


def test_group_builds_one_unit_per_triplet():
    files = _triplet("GSM1", "GSM1_a") + _triplet("GSM2", "GSM2_b")
    units = group(files, "GSE1")
    assert [u.fmt for u in units] == ["10x_mtx", "10x_mtx"]
    assert {u.sample for u in units} == {"GSM1", "GSM2"}
    assert all(len(u.files) == len(_TRIPLET_PARTS) for u in units)


def test_group_drops_incomplete_triplet():
    files = _triplet("GSM1", "GSM1_a")[:2]
    assert group(files, "GSE1") == []


def test_group_prefers_structured_over_table_but_keeps_both():
    gsm = "GSM1"
    files = [
        *_triplet(gsm, "GSM1_filtered"),
        SuppFile(f"{FTP}/GSM1_counts.csv.gz", Role.Table, gsm),
    ]
    units = group(files, "GSE1")
    preferred = [u for u in units if u.preferred]
    assert [u.fmt for u in preferred] == ["10x_mtx"]
    assert {u.label for u in units} == {"GSM1:10x_mtx", "GSM1:table"}


def test_series_level_files_are_never_auto_selected():
    files = [
        *_triplet("GSM1", "GSM1_a"),
        SuppFile(f"{FTP}/GSE1_RAW.tar", Role.Tar, None),
        SuppFile(f"{FTP}/GSE1_counts.csv.gz", Role.Table, None),
    ]
    units = group(files, "GSE1")
    preferred = [u for u in units if u.preferred]
    assert [u.sample for u in preferred] == ["GSM1"]
    assert {u.label for u in units if not u.preferred} == {
        "GSE1_RAW.tar",
        "GSE1_counts.csv.gz",
    }


def test_series_level_file_is_selected_when_it_is_all_there_is():
    files = [SuppFile(f"{FTP}/GSE1_counts.csv.gz", Role.Table, None)]
    units = group(files, "GSE1")
    assert len(units) == 1
    assert units[0].preferred


def test_is_filtered():
    assert is_filtered("GSM1_filtered_feature_bc_matrix.h5")
    assert not is_filtered("GSM1_raw_feature_bc_matrix.h5")
    assert not is_filtered("GSM1_unfiltered_matrix.h5")


def test_infer_kind_from_barcodes():
    barcodes = ["AAACCTGAGAAACCAT-1", "AAACCTGAGAAACCGC-1"] * 300
    obs = pd.DataFrame(index=pd.Index(barcodes))
    kind, _ = infer_kind(obs)
    assert kind == "single_cell"


def test_infer_kind_bulk_from_gsm_labels():
    obs = pd.DataFrame(index=pd.Index([f"GSM{i}" for i in range(1000, 1012)]))
    kind, ev = infer_kind(obs)
    assert kind == "bulk"
    assert "GSM accessions" in ev[0]


def test_infer_kind_uses_series_sample_count():
    # 68 unlabeled columns in an 87-sample series are sample rows.
    obs = pd.DataFrame(index=pd.Index([f"SD{i:03d}" for i in range(68)]))
    assert infer_kind(obs, 87)[0] == "bulk"
    assert infer_kind(obs)[0] == "unknown"


def test_detects_truncated_hdf5(tmp_path):
    h5py = pytest.importorskip("h5py")
    import numpy as np

    p = tmp_path / "m.h5"
    with h5py.File(p, "w") as f:
        f["x"] = np.arange(100_000)
    check_hdf5_complete(p, "u")

    cut = tmp_path / "cut.h5"
    cut.write_bytes(p.read_bytes()[: p.stat().st_size // 2])
    with pytest.raises(OSError, match="truncated"):
        check_hdf5_complete(cut, "http://example/m.h5")


def test_non_hdf5_files_are_not_checked(tmp_path):
    p = tmp_path / "matrix.mtx"
    p.write_text("%%MatrixMarket matrix coordinate integer general\n3 2 1\n1 1 5\n")
    check_hdf5_complete(p, "u")


def test_infer_kind_is_honest_about_smartseq_plates():
    # 384 columns are in the undecided Smart-seq range.
    obs = pd.DataFrame(index=pd.Index([f"cell_{i}" for i in range(384)]))
    kind, ev = infer_kind(obs)
    assert kind == "unknown"
    assert any("Smart-seq" in e for e in ev)


def test_summary_reports_what_was_read():
    m = CountMatrix(
        X=np.zeros((3, 2)),
        obs=pd.DataFrame({"celltype": list("abc")}, index=pd.Index(list("xyz"))),
        var=pd.DataFrame(index=pd.Index(["g1", "g2"])),
        kind="single_cell",
        fmt="h5ad",
        accession="GSM1",
        source="GSM1_adata.h5ad",
        evidence=["h5ad file"],
        metadata_fields={"celltype": ["celltype"]},
    )
    s = m.summary
    assert (s["observations"], s["features"]) == m.shape
    assert s["sparse"] is False
    assert s["metadata_fields"] == "celltype"
    assert s.name == "GSM1"


def _matrix(x):
    return CountMatrix(
        X=x,
        obs=pd.DataFrame(index=pd.Index(["c1", "c2", "c3"])),
        var=pd.DataFrame(index=pd.Index(["g1", "g2"])),
        kind="single_cell",
        fmt="mtx",
    )


def test_orientation_properties_agree_with_shape():
    m = _matrix(np.arange(6).reshape(3, 2))

    assert m.cellxgene.shape == m.shape == (3, 2)
    assert m.genexcell.shape == (2, 3)
    assert m.cellxgene is m.X
    assert (m.genexcell == m.X.T).all()


def test_orientation_properties_keep_the_matrix_sparse():
    sparse = pytest.importorskip("scipy.sparse")
    m = _matrix(sparse.csr_matrix(np.arange(6).reshape(3, 2)))

    assert sparse.issparse(m.cellxgene)
    assert sparse.issparse(m.genexcell)
    assert m.genexcell.format == "csc"
    assert (m.genexcell.toarray() == m.cellxgene.toarray().T).all()


def test_snake_case_alias_is_the_same_object():
    from seqout import SeqoutCounts as Camel
    from seqout import seqout_counts

    assert seqout_counts is Camel is SeqoutCounts


def test_rejects_non_geo_accessions():
    with pytest.raises(ValueError, match="only GSE and GSM"):
        SeqoutCounts("SRP123456")
    with pytest.raises(ValueError, match="only one of"):
        SeqoutCounts("GSE1", gsm="GSM1")


@pytest.mark.network
def test_gsm_manifest_end_to_end():
    with SeqoutCounts(gsm="GSM8207499") as c:
        man = c.manifest()
    assert not man.empty
    assert man["format"].isin({"10x_mtx", "10x_h5"}).any()


def test_triplet_group_key_does_not_collide_on_missing_sample():
    # stringifying sample=None once merged unrelated series-level triplets
    files = [
        SuppFile(f"{FTP}/GSE1_a_{part}", classify(part), None)
        for part in _TRIPLET_PARTS
    ] + [
        SuppFile(f"{FTP}/GSE1_b_{part}", classify(part), None)
        for part in _TRIPLET_PARTS
    ]
    units = group(files, "GSE1")
    assert len(units) == 2, [u.label for u in units]


def test_read_table_transposes_genes_by_samples(tmp_path):
    from seqout.counts_readers import read_table

    p = tmp_path / "counts.csv"
    p.write_text("gene,S1,S2,S3\nA,1,2,3\nB,4,5,6\n")
    x, obs, var = read_table(p)
    assert list(obs.index) == ["S1", "S2", "S3"]
    assert list(var.index) == ["A", "B"]
    assert x.shape == (3, 2)
    assert x[0].tolist() == [1.0, 4.0]


def test_read_table_drops_a_text_annotation_column(tmp_path):
    from seqout.counts_readers import read_table

    p = tmp_path / "counts.tsv"
    p.write_text("gene_id\tsymbol\tS1\tS2\nENSG1\tACTB\t7\t8\n")
    x, obs, _ = read_table(p)
    assert list(obs.index) == ["S1", "S2"]
    assert x.shape == (2, 1)


def test_rejects_a_client_that_cannot_back_it():
    class FakeParquetClient:
        pass

    with pytest.raises(TypeError, match="fetch_geo_sample_detailed_metadata"):
        SeqoutCounts("GSE1", client=FakeParquetClient())


def test_pairs_a_triplet_whose_names_share_no_prefix():
    # GSE165686 names barcodes/features after the series and the matrix after an assay
    files = [
        SuppFile(f"{FTP}/GSE165686_barcodes.tsv.gz", Role.Barcodes, None),
        SuppFile(f"{FTP}/GSE165686_features.tsv.gz", Role.Features, None),
        SuppFile(f"{FTP}/GSE165686_yeastdropseq_dge.mtx.gz", Role.Mtx, None),
    ]
    units = group(files, "GSE165686")
    assert [u.fmt for u in units] == ["10x_mtx"]
    assert len(units[0].files) == len(_TRIPLET_PARTS)


def test_does_not_guess_when_leftover_pairing_is_ambiguous():
    # two matrices with one barcode file are ambiguous leftovers
    files = [
        SuppFile(f"{FTP}/GSE1_barcodes.tsv.gz", Role.Barcodes, None),
        SuppFile(f"{FTP}/GSE1_features.tsv.gz", Role.Features, None),
        SuppFile(f"{FTP}/GSE1_assayA_dge.mtx.gz", Role.Mtx, None),
        SuppFile(f"{FTP}/GSE1_assayB_dge.mtx.gz", Role.Mtx, None),
    ]
    assert group(files, "GSE1") == []


def test_leftover_pairing_is_scoped_to_one_sample():
    files = [
        SuppFile(f"{FTP}/GSM1_barcodes.tsv.gz", Role.Barcodes, "GSM1"),
        SuppFile(f"{FTP}/GSM1_features.tsv.gz", Role.Features, "GSM1"),
        SuppFile(f"{FTP}/GSM2_thing_dge.mtx.gz", Role.Mtx, "GSM2"),
    ]
    assert group(files, "GSE1") == []


class _FakeFTP:
    """Minimal ftplib.FTP stand-in: serves `payload`, reports `reported` size."""

    def __init__(self, payload=b"hello", reported=None):
        self.payload = payload
        self.reported = len(payload) if reported is None else reported

    def size(self, _path):
        return self.reported

    def retrbinary(self, _cmd, callback, blocksize=8192):
        for i in range(0, len(self.payload), blocksize):
            callback(self.payload[i : i + blocksize])

    def quit(self):
        pass


def test_ftp_fetch_writes_only_on_a_complete_transfer(tmp_path, monkeypatch):
    from seqout import counts_ftp

    monkeypatch.setattr(counts_ftp, "_ftp_blocked", False)
    monkeypatch.setattr(counts_ftp, "_connect", lambda _h: _FakeFTP(b"abcdef"))
    dest = tmp_path / "m.mtx.gz"
    assert counts_ftp.fetch("ftp://host/path/m.mtx.gz", dest) is True
    assert dest.read_bytes() == b"abcdef"
    assert not list(tmp_path.glob("*.part"))


def test_ftp_short_transfer_falls_back_and_leaves_no_partial(tmp_path, monkeypatch):
    from seqout import counts_ftp

    monkeypatch.setattr(counts_ftp, "_ftp_blocked", False)
    # FTP SIZE can report 999 bytes while transfer sends 6
    monkeypatch.setattr(counts_ftp, "_connect", lambda _h: _FakeFTP(b"abcdef", 999))
    dest = tmp_path / "m.h5"
    assert counts_ftp.fetch("ftp://host/path/m.h5", dest) is False
    assert not dest.exists()
    assert not list(tmp_path.glob("*.part"))


def test_intercepted_port_disables_ftp_for_the_rest_of_the_run(tmp_path, monkeypatch):
    import ftplib

    from seqout import counts_ftp

    monkeypatch.setattr(counts_ftp, "_ftp_blocked", False)
    calls = []

    def boom(_host):
        calls.append(1)
        # Squid intercepts port 21 and answers with an HTTP status line
        msg = "HTTP/1.1 403 Forbidden"
        raise ftplib.error_proto(msg)  # noqa: S321, fake error only; no FTP is opened

    monkeypatch.setattr(counts_ftp, "_connect", boom)
    for i in range(5):
        assert counts_ftp.fetch(f"ftp://host/p/f{i}", tmp_path / f"f{i}") is False
    # port interception performs one FTP probe for the run
    assert len(calls) == 1
    assert counts_ftp.ftp_unavailable()


def _write_r_objects(tmp_path):
    """Build real Seurat/SCE/dgCMatrix objects; skip if R or Seurat is absent."""
    import shutil
    import subprocess

    rscript = shutil.which("Rscript")
    if rscript is None:
        pytest.skip("no Rscript on PATH")
    script = tmp_path / "make.R"
    script.write_text(f"""
        ok <- requireNamespace("Seurat", quietly=TRUE) &&
              requireNamespace("SingleCellExperiment", quietly=TRUE)
        if (!ok) quit(status=42)
        suppressPackageStartupMessages({{library(Seurat); library(Matrix)
            library(SingleCellExperiment)}})
        set.seed(1)
        m <- abs(Matrix::rsparsematrix(30, 8, density=0.4,
                                       rand.x=function(n) rpois(n, 5)))
        rownames(m) <- paste0("GENE", 1:30); colnames(m) <- paste0("CELL", 1:8)
        so <- Seurat::CreateSeuratObject(counts=m)
        so$condition <- rep(c("ctrl","treat"), 4)
        saveRDS(so, "{tmp_path}/seurat.rds")
        saveRDS(SingleCellExperiment(assays=list(counts=m),
                colData=DataFrame(condition=rep(c("ctrl","treat"), 4)),
                rowData=DataFrame(symbol=paste0("SYM", 1:30))),
                "{tmp_path}/sce.rds")
        saveRDS(m, "{tmp_path}/plain.rds")
        cat(sum(m))
    """)
    p = subprocess.run(  # noqa: S603, rscript path from shutil.which and script we wrote
        [rscript, "--vanilla", str(script)], capture_output=True, text=True, check=False
    )
    if p.returncode == _R_WITHOUT_PKGS:
        pytest.skip("R present but Seurat/SingleCellExperiment are not installed")
    assert p.returncode == 0, p.stderr
    return int(p.stdout.strip())


@pytest.mark.network  # system R required; excluded from plain CI
def test_reads_seurat_sce_and_plain_rds(tmp_path):
    from seqout.counts_rds import read_rds

    total = _write_r_objects(tmp_path)
    for name in ("seurat.rds", "sce.rds", "plain.rds"):
        x, obs, var = read_rds(tmp_path / name)
        assert x.shape == (8, 30), f"{name}: want cells x genes"
        assert hasattr(x, "nnz"), f"{name}: must stay sparse, never densified"
        assert x.sum() == total, f"{name}: counts must round-trip exactly"
        assert list(obs.index[:2]) == ["CELL1", "CELL2"]
        assert list(var.index[:2]) == ["GENE1", "GENE2"]


def test_unreadable_rds_names_both_ways_to_fix_it(tmp_path, monkeypatch):
    import shutil

    from seqout import counts_rds as cr

    monkeypatch.setattr(shutil, "which", lambda _: None)
    p = tmp_path / "x.rds"
    p.write_bytes(b"not really an rds")
    with pytest.raises(RuntimeError, match=r"counts.*extra|R on PATH"):
        cr.read_rds(p)


@pytest.mark.network  # system R required to build fixtures
def test_extracts_cell_and_gene_metadata_from_r_objects(tmp_path):
    from seqout.counts_rds import read_rds

    _write_r_objects(tmp_path)

    _, obs, _ = read_rds(tmp_path / "seurat.rds")
    assert "condition" in obs.columns, "Seurat meta.data must reach obs"
    assert list(obs["condition"].astype(str))[:2] == ["ctrl", "treat"]

    _, obs, var = read_rds(tmp_path / "sce.rds")
    assert "condition" in obs.columns, "SCE colData must reach obs"
    # SCE rowData can hide under rowRanges/elementMetadata
    assert "symbol" in var.columns, "SCE rowData must reach var"
    assert list(var["symbol"].astype(str))[:2] == ["SYM1", "SYM2"]


@pytest.mark.network  # system R required to build fixtures
def test_pure_python_and_r_rds_paths_agree(tmp_path):
    import numpy as np

    import seqout.counts_rds as cr

    _write_r_objects(tmp_path)
    for name in ("seurat.rds", "sce.rds", "plain.rds"):
        pure = cr._rds_via_rdata(tmp_path / name)
        if pure is None:
            pytest.skip("rdata not installed")
        original = cr._rds_via_rdata
        cr._rds_via_rdata = lambda _p: None
        try:
            viar = cr.read_rds(tmp_path / name)
        finally:
            cr._rds_via_rdata = original
        assert np.array_equal(pure[0].toarray(), viar[0].toarray()), name
        assert list(pure[1].index) == list(viar[1].index), name
        assert list(pure[2].index) == list(viar[2].index), name


def test_classifies_per_cell_annotation_as_metadata_not_counts():
    for name in (
        "GSE1_cell_metadata.csv.gz",
        "GSM1_meta_data.tsv",
        "GSE1_celltype_annotation.csv",
        "GSE1_obs.csv.gz",
    ):
        assert classify(name) is Role.Metadata, name
    # counts table names have priority over annotation hints
    assert classify("GSE1_counts.csv.gz") is Role.Table
    assert classify("GSM1_matrix.mtx.gz") is Role.Mtx


def test_metadata_attaches_to_units_instead_of_becoming_one():
    files = [
        *_triplet("GSM1", "GSM1_a"),
        SuppFile(f"{FTP}/GSM1_cell_metadata.csv.gz", Role.Metadata, "GSM1"),
    ]
    units = group(files, "GSE1")
    assert [u.fmt for u in units] == ["10x_mtx"], "metadata must not be its own unit"
    assert units[0].has_metadata
    assert [f.name for f in units[0].metadata_files] == ["GSM1_cell_metadata.csv.gz"]
    # metadata files stay in unit URL sets for download
    assert any("cell_metadata" in u for u in units[0].urls)


def test_series_level_metadata_reaches_every_sample():
    files = [
        *_triplet("GSM1", "GSM1_a"),
        *_triplet("GSM2", "GSM2_b"),
        SuppFile(f"{FTP}/GSE1_cell_metadata.csv.gz", Role.Metadata, None),
    ]
    units = group(files, "GSE1")
    assert {u.sample for u in units} == {"GSM1", "GSM2"}
    assert all(u.has_metadata for u in units), "one shared table describes both samples"


def test_rds_and_h5ad_report_metadata_without_a_sidecar():
    # RDS and h5ad containers embed per-cell annotation
    for role, fmt in ((Role.Rds, "rds"), (Role.H5ad, "h5ad")):
        u = group([SuppFile(f"{FTP}/GSE1_x.{fmt}", role, None)], "GSE1")[0]
        assert u.has_metadata, fmt
    u = group([SuppFile(f"{FTP}/GSE1_counts.csv.gz", Role.Table, None)], "GSE1")[0]
    assert not u.has_metadata


def test_describe_metadata_maps_columns_to_categories():
    from seqout.counts_io import describe_metadata

    got = describe_metadata(
        ["barcode", "cell_type", "disease_status", "donor_id", "age_years", "nUMI"]
    )
    assert got["celltype"] == ["cell_type"]
    assert got["condition"] == ["disease_status"]
    assert got["subject"] == ["donor_id"]
    assert got["age"] == ["age_years"]
    # token-aware matching keeps age separate from percentage
    assert "age" not in describe_metadata(["percentage_mito"])


def test_drops_header_rows_from_10x_label_files(tmp_path):
    import gzip as gz

    pytest.importorskip("scipy")
    from seqout.counts_readers import read_10x_mtx

    # GSE165686 label files include headers on a 3 genes x 2 cells matrix
    (tmp_path / "matrix.mtx").write_text(
        "%%MatrixMarket matrix coordinate integer general\n3 2 3\n1 1 5\n2 2 7\n3 1 9\n"
    )
    with gz.open(tmp_path / "barcodes.tsv.gz", "wt") as f:
        f.write("barcode\nCELL1\nCELL2\n")
    with gz.open(tmp_path / "features.tsv.gz", "wt") as f:
        f.write("gene_id\tsymbol\nG1\tA\nG2\tB\nG3\tC\n")

    x, obs, var = read_10x_mtx(
        tmp_path / "matrix.mtx",
        tmp_path / "barcodes.tsv.gz",
        tmp_path / "features.tsv.gz",
    )
    assert x.shape == (2, 3)
    assert list(obs.index) == ["CELL1", "CELL2"], "header must not become a barcode"
    assert list(var.index) == ["G1", "G2", "G3"]
    assert x.sum() == 5 + 7 + 9


def test_headerless_10x_label_files_are_untouched(tmp_path):
    pytest.importorskip("scipy")
    from seqout.counts_readers import read_10x_mtx

    (tmp_path / "matrix.mtx").write_text(
        "%%MatrixMarket matrix coordinate integer general\n2 2 2\n1 1 4\n2 2 6\n"
    )
    (tmp_path / "barcodes.tsv").write_text("CELL1\nCELL2\n")
    (tmp_path / "features.tsv").write_text("G1\nG2\n")
    x, obs, _ = read_10x_mtx(
        tmp_path / "matrix.mtx", tmp_path / "barcodes.tsv", tmp_path / "features.tsv"
    )
    assert x.shape == (2, 2)
    assert list(obs.index) == ["CELL1", "CELL2"]
    assert x.sum() == 4 + 6


def test_metadata_named_rds_is_annotation_not_counts():
    # these real GEO meta.data RDS names fail R counts export
    for name in (
        "GSE264648_metadata_astrocytes.rds",
        "GSE225663_mBAL.combined_meta.data.rds",
    ):
        assert classify(name) is Role.Metadata, name
    assert classify("GSE235191_All_Cells_Integrated.rds") is Role.Rds
    # h5ad carries counts alongside annotation.
    assert classify("GSE1_cell_metadata.h5ad") is Role.H5ad


def test_reads_10x_h5_without_an_explicit_shape_dataset(tmp_path):
    h5py = pytest.importorskip("h5py")
    import numpy as np

    from seqout.counts_readers import read_10x_h5

    # some GEO 10x h5 files omit /shape
    p = tmp_path / "m.h5"
    with h5py.File(p, "w") as f:
        g = f.create_group("matrix")
        g["data"] = np.array([1.0, 2.0, 3.0], dtype="f4")
        g["indices"] = np.array([0, 2, 1], dtype="i8")
        g["indptr"] = np.array([0, 2, 3], dtype="i8")
        g["barcodes"] = np.array([b"CELL1", b"CELL2"])
        feats = g.create_group("features")
        feats["id"] = np.array([b"G1", b"G2", b"G3"])
        feats["name"] = np.array([b"A", b"B", b"C"])

    x, obs, var = read_10x_h5(p)
    assert x.shape == (2, 3)
    assert list(obs.index) == ["CELL1", "CELL2"]
    assert list(var.index) == ["G1", "G2", "G3"]
    assert x.sum() == 1 + 2 + 3


def test_counts_words_win_over_annotation_words():
    assert classify("GSE264648_counts_all_celltype.rds.gz") is Role.Rds
    assert classify("GSE1_raw_umi_by_celltype.csv.gz") is Role.Table
    assert classify("GSE1_filtered_expr_annotation.tsv") is Role.Table
    assert classify("GSE1_celltype_annotation.csv") is Role.Metadata
    assert classify("GSE1_cell_metadata.rds") is Role.Metadata


class _FakeResponse:
    """Minimal requests.Response stand-in for the download path."""

    def __init__(self, body, headers, status=200):
        self._body = body
        self.headers = headers
        self.status_code = status

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        for i in range(0, len(self._body), chunk_size):
            yield self._body[i : i + chunk_size]

    def close(self):
        pass


def test_download_accepts_a_transport_compressed_body(tmp_path, monkeypatch):
    """
    NCBI serves some .rds/.gz with Content-Encoding: gzip and a compressed
    Content-Length. requests decompresses transparently, so the bytes on disk
    legitimately exceed the header and the size check must not fire.
    """
    from seqout import helpers

    body = b"RDX3\nX\n" + b"payload" * 500

    def fake_get(url, headers=None, **_kw):
        assert headers["Accept-Encoding"] == "identity", "must ask for raw bytes"
        return _FakeResponse(
            body, {"Content-Length": "17", "Content-Encoding": "x-gzip"}
        )

    monkeypatch.setattr(helpers._session, "get", fake_get)
    dest = tmp_path / "x.rds"
    helpers._download_file(
        "http://example/x.rds",
        dest,
        chunk_size=64,
        num_retries=1,
        timeout=5,
        max_wait=1,
        with_pbar=False,
    )
    assert dest.read_bytes() == body


def test_download_still_checks_size_when_not_encoded(tmp_path, monkeypatch):
    from seqout import helpers

    def fake_get(url, headers=None, **_kw):
        # HTTP Content-Length can claim 999 bytes while transfer sends 10
        return _FakeResponse(b"0123456789", {"Content-Length": "999"})

    monkeypatch.setattr(helpers._session, "get", fake_get)
    with pytest.raises(OSError, match="expected 999"):
        helpers._download_file(
            "http://example/x.bin",
            tmp_path / "x.bin",
            chunk_size=64,
            num_retries=1,
            timeout=5,
            max_wait=1,
            with_pbar=False,
        )


def test_10x_h5_ignores_root_level_datasets(tmp_path):
    h5py = pytest.importorskip("h5py")
    import numpy as np

    from seqout.counts_readers import read_10x_h5

    # root datasets may sort before CellRanger v2 per-genome groups
    p = tmp_path / "m.h5"
    with h5py.File(p, "w") as f:
        f["attrs_note"] = np.array([1, 2, 3])
        g = f.create_group("hg19")  # CellRanger v2 per-genome layout
        g["data"] = np.array([4.0, 5.0], dtype="f4")
        g["indices"] = np.array([0, 1], dtype="i8")
        g["indptr"] = np.array([0, 1, 2], dtype="i8")
        g["shape"] = np.array([2, 2], dtype="i8")
        g["barcodes"] = np.array([b"CELL1", b"CELL2"])
        g["genes"] = np.array([b"G1", b"G2"])

    x, obs, _ = read_10x_h5(p)
    assert x.shape == (2, 2)
    assert list(obs.index) == ["CELL1", "CELL2"]
    assert x.sum() == 4 + 5


def test_qualifier_words_do_not_make_a_file_look_like_counts():
    # raw, filtered, normalized and seurat appear in counts and metadata names alike
    for name in (
        "GSE164378_sc.meta.data_3P.csv.gz",
        "GSE1_seurat_metadata.tsv.gz",
        "GSE1_filtered_cell_metadata.csv",
        "GSE1_raw_cell_annotations.csv",
        "GSE1_normalized_cell_metadata.csv",
    ):
        assert classify(name) is Role.Metadata, name
    for name in (
        "GSE264648_counts_all_celltype.rds.gz",
        "GSE1_raw_umi_matrix.csv.gz",
        "GSE1_filtered_expr_annotation.tsv",
    ):
        assert classify(name) in (Role.Table, Role.Rds), name


def test_gene_expression_beats_an_antibody_panel():
    # CITE-seq ADT files can sort before RNA files and carry antibody features
    files = [
        SuppFile(f"{FTP}/GSM1_adt_C001.h5ad", Role.H5ad, "GSM1"),
        SuppFile(f"{FTP}/GSM1_rna_C001.h5ad", Role.H5ad, "GSM1"),
    ]
    units = group(files, "GSE1")
    preferred = [u for u in units if u.preferred]
    assert len(preferred) == 1
    assert "rna" in preferred[0].files[0].name
    assert len(units) == len(files)


def test_assay_selects_among_a_samples_modalities():
    from seqout.counts_model import modality_of

    files = [
        SuppFile(f"{FTP}/GSM1_adt_C001.h5ad", Role.H5ad, "GSM1"),
        SuppFile(f"{FTP}/GSM1_rna_C001.h5ad", Role.H5ad, "GSM1"),
    ]
    assert [modality_of(u) for u in group(list(files), "GSE1")] == ["adt", "rna"]

    rna = [u for u in group(list(files), "GSE1") if u.preferred]
    assert modality_of(rna[0]) == "rna", "rna is the default"

    adt = [u for u in group(list(files), "GSE1", assay="adt") if u.preferred]
    assert modality_of(adt[0]) == "adt", "an explicit assay wins"


def test_same_format_units_get_distinct_labels():
    files = [
        SuppFile(f"{FTP}/GSM1_adt_C001.h5ad", Role.H5ad, "GSM1"),
        SuppFile(f"{FTP}/GSM1_rna_C001.h5ad", Role.H5ad, "GSM1"),
    ]
    labels = [u.label for u in group(files, "GSE1")]
    assert len(set(labels)) == len(labels), labels


def test_progress_can_be_silenced(tmp_path):
    # progress=False has to reach the downloader itself
    seen = {}

    class _Client:
        def fetch_geo_sample_detailed_metadata(self, _a):
            msg = "not reached"
            raise AssertionError(msg)

        def download_files(self, urls, out_dir, **kw):
            seen["with_pbar"] = kw["with_pbar"]
            for u in urls:
                (out_dir / u.rsplit("/", 1)[-1]).write_text("x")

    for constructed, per_call, expected in [
        (True, None, True),
        (False, None, False),
        (True, False, False),
        (False, True, True),
    ]:
        c = SeqoutCounts(
            "GSE1", client=_Client(), cache_dir=tmp_path / "c", progress=constructed
        )
        seen.clear()
        c._fetch([f"{FTP}/f_{constructed}_{per_call}.tsv"], progress=per_call)
        assert seen["with_pbar"] is expected, (constructed, per_call)


class _Chan:
    def __init__(self, characteristics):
        self.characteristics = characteristics


class _Samp:
    def __init__(self, accession, title, characteristics=None, **flat):
        self.accession = accession
        self.title = title
        self.channels = [_Chan(characteristics)] if characteristics is not None else []
        for k, v in flat.items():
            setattr(self, k, v)


def test_sample_frame_handles_both_backend_shapes():
    from seqout.utils import sample_frame

    # API, parquet and ArrayExpress samples expose characteristics in different shapes
    frame = sample_frame(
        [
            _Samp("GSM1", "a", {"tissue": "PBMC", "age": "45"}),
            _Samp("GSM2", "b", [{"@tag": "tissue", "#text": "liver"}]),
            _Samp("E-MTAB-1", "c", None, source_name="blood", organism="Homo sapiens"),
        ]
    )
    assert list(frame.index) == ["GSM1", "GSM2", "E-MTAB-1"]
    assert frame.loc["GSM1", "tissue"] == "PBMC"
    assert frame.loc["GSM2", "tissue"] == "liver"
    assert frame.loc["E-MTAB-1", "source_name"] == "blood"


def test_sample_frame_is_empty_not_broken_for_no_samples():
    from seqout.utils import sample_frame

    assert sample_frame([]).empty

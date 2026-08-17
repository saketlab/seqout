"""
Accession-first access: sq.get("GSE168652") resolves the archive for you.

A Dataset wraps one accession and fills each field on first access,
hopping between archives on its own; a GEO series reaches its linked SRA study
for runs, an SRA study reaches its GEO series for samples. Callers never branch
on the prefix.

ShortNames carries the one-word aliases; both clients mix it in. The
long fetch_* names stay, so existing code and the CLI are unaffected.
"""

from __future__ import annotations

import re
from functools import cached_property
from typing import TYPE_CHECKING, Any

from seqout.exception import SeqoutError
from seqout.models.api_models import StudyExperimentsResults, StudyRunsResults

if TYPE_CHECKING:
    from seqout.models.api_models import (
        AccessionClassification,
        AuthorProjectsResponse,
        ProjectCrossReferenceList,
        ProjectMetadataResult,
        ProjectSummaryResultList,
        Publication,
        PublicationLookupResult,
    )

# Mirrors the backend classifier; E-GEAD-N and PRJC/SAMC overlap older accession shapes.
_ENTITY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^GSE\d+$"), "series"),
    (re.compile(r"^GSM\d+$"), "sample"),
    (re.compile(r"^[SED]RP\d+$"), "study"),
    (re.compile(r"^[SED]RX\d+$"), "experiment"),
    (re.compile(r"^[SED]RS\d+$"), "sample"),
    (re.compile(r"^[SED]RR\d+$"), "run"),
    (re.compile(r"^[SED]RA\d+$"), "submission"),
    (re.compile(r"^SAM[A-Z]*\d+$"), "biosample"),
    (re.compile(r"^E-GEAD-\d+$"), "series"),
    (re.compile(r"^E-[A-Z]{4}-\d+$"), "series"),
    (re.compile(r"^PRJ[A-Z]+\d+$"), "study"),
    (re.compile(r"^(CRA|HRA)\d+$"), "study"),
    (re.compile(r"^(CRR|HRR)\d+$"), "run"),
    (re.compile(r"^(CRX|HRX)\d+$"), "experiment"),
    (re.compile(r"^HRS\d+$"), "sample"),
)

_SHAPES = (
    "GSE/GSM (GEO), SRP/SRX/SRS/SRR (SRA), ERP/DRP (ENA, DDBJ), "
    "CRA/HRA/CRX/HRX/CRR/HRR/HRS (GSA), E-MTAB-N and E-GEAD-N "
    "(ArrayExpress, GEA), PRJ and SAM (BioProject, BioSample)"
)

_STUDY_PREFIXES = ("SRP", "ERP", "DRP", "CRA", "HRA", "PRJ")
_GEO_PREFIXES = ("GSE", "E-")
_RUN_PREFIXES = ("SRR", "ERR", "DRR", "CRR", "HRR")
_EXP_PREFIXES = ("SRX", "ERX", "DRX", "CRX", "HRX")
_SAMPLE_PREFIXES = ("GSM", "SRS", "ERS", "DRS", "HRS", "SAM")
_ROOT_ENTITIES = ("series", "study")


def _call(client: Any, name: str, *args: Any, **kwargs: Any) -> Any:
    """Call a client method, with a clear error when the backend lacks it."""
    fn = getattr(client, name, None)
    if fn is None:
        short = name.removeprefix("fetch_").removeprefix("project_")
        msg = (
            f"{short} is not available on the parquet backend "
            f"(no such table in the dump). Use the API backend for it: "
            f"connect() instead of connect('parquet')."
        )
        raise SeqoutError(msg)
    return fn(*args, **kwargs)


def _kind(accession: str) -> str | None:
    """Name what an accession refers to, offline. None if unrecognized."""
    up = accession.strip().upper()
    for pattern, entity in _ENTITY_PATTERNS:
        if pattern.match(up):
            return entity
    return None


class Dataset:
    """
    Everything reachable from one accession, fetched lazily and cached.

    Accepts any accession (series, study, experiment, sample or run) and
    resolves the rest itself::

        d = sq.get("GSE168652")
        d.meta       # project metadata
        d.samples    # GEO samples here, SRA experiments elsewhere
        d.runs       # follows the link to the SRA study
        d.pubs       # publications
    """

    def __init__(self, client: Any, accession: str) -> None:
        self._sq = client
        self.accession = accession.strip()
        self.kind = _kind(self.accession)
        if self.kind is None:
            msg = (
                f"{self.accession!r} is not an accession this library recognizes. "
                f"Expected one of: {_SHAPES}. "
                f"To search for it as text instead, use sq.search({self.accession!r})."
            )
            raise SeqoutError(msg)

    def __repr__(self) -> str:
        return f"Dataset({self.accession!r}, kind={self.kind!r})"

    def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        return _call(self._sq, name, *args, **kwargs)

    @cached_property
    def project(self) -> str:
        """
        The study / series this accession belongs to (itself, if it is one).

        Raises when the archive exposes no path from this accession to its
        study; the message says what was tried.
        """
        if self.kind in _ROOT_ENTITIES:
            return self.accession
        if self.accession.upper().startswith("GSM"):
            found = self._sq.gsm_series(self.accession)
        else:
            found = self._sq.resolve_study(self.accession)
        if found:
            return found
        msg = (
            f"could not find the study that {self.accession} "
            f"(a {self.kind}) belongs to. Nothing links it back: the archive "
            f"serves no parent for this accession and it is not in the search "
            f"index. Start from the study or series accession instead, or call "
            f"sq.search({self.accession!r}) to look for it."
        )
        raise SeqoutError(msg)

    @cached_property
    def sra(self) -> str | None:
        """The archive study holding the sequencing runs (SRP/ERP/PRJ)."""
        project = self.project
        if project.upper().startswith(_STUDY_PREFIXES):
            return project
        return self._sq.linked_study(project)

    @cached_property
    def geo(self) -> str | None:
        """The series holding the processed and supplementary files (GSE, E-)."""
        project = self.project
        if project.upper().startswith(_GEO_PREFIXES):
            return project
        return self._sq.linked_geo(project)

    @cached_property
    def meta(self) -> ProjectMetadataResult:
        """Project metadata for project."""
        return self._sq.fetch_project_metadata(self.project)

    def _samples_of(self, accession: str) -> Any:
        # GEO/AE/GEA list channel samples; other archives list experiments
        if accession.upper().startswith(_GEO_PREFIXES):
            return self._sq.fetch_samples(accession)
        return self._sq.fetch_study_experiments(accession)

    @cached_property
    def samples(self) -> Any:
        """
        The per-sample records, from whichever archive holds them.

        GEO, ArrayExpress and GEA list channel samples; SRA, ENA, DDBJ and GSA
        list experiments. Falls back to the linked archive when this side has
        none, so a study and its series answer the same.
        """
        native = self._samples_of(self.project)
        if len(native):
            return native
        other = self.geo if self.sra == self.project else self.sra
        if other and other != self.project:
            return self._samples_of(other)
        return native

    @cached_property
    def experiments(self) -> StudyExperimentsResults:
        """
        The library preparations, one row per experiment.

        Reached through the linked sequencing study, so an ArrayExpress or GEA
        series answers too. Empty only when the dataset really has none, as
        with microarray-only submissions.
        """
        study = self.sra
        if not study:
            return StudyExperimentsResults([])
        return self._sq.fetch_study_experiments(study)

    @cached_property
    def runs(self) -> StudyRunsResults:
        """
        Every sequencing run, via the linked sequencing study when needed.

        The link is followed however the archive files it: a cross-reference for
        GEO and ArrayExpress, the BioProject for GEA. Empty only when the dataset
        really has no runs, as with microarray-only submissions.
        """
        study = self.sra
        if not study:
            return StudyRunsResults([])
        return self._sq.fetch_study_runs(study, full=True)

    @cached_property
    def supplementary(self) -> Any:
        """
        The processed files a submitter uploaded: matrices, annotations, archives.

        A series or study lists its own files and every sample's; `sample` is
        None on the ones the series carries itself. A GEO sample lists only its
        own, because reading them through the series would ask for a parent the
        archive does not always serve and would answer with the whole series.

        Read this before downloading. GEO writes a literal "NONE" for a sample
        with no files, so an entry without a URL is dropped rather than turned
        into a row that cannot be fetched.
        """
        from seqout.models.api_models import (  # noqa: PLC0415 - cycle
            SupplementaryFile,
            SupplementaryFiles,
        )

        def rows(raw: Any, sample: str | None) -> list:
            if not raw:
                return []
            entries = raw if isinstance(raw, (list, tuple)) else [raw]
            found = (SupplementaryFile.from_record(e, sample) for e in entries)
            return [f for f in found if f is not None]

        if self.kind == "sample":
            record = getattr(self.detail, "sample", None) or self.detail
            return SupplementaryFiles(
                rows(getattr(record, "supplementary_data", None), self.accession)
            )

        out = rows(getattr(self.meta, "supplementary_data", None), None)
        for sample in getattr(self.samples, "root", self.samples) or []:
            out.extend(
                rows(
                    getattr(sample, "supplementary_data", None),
                    getattr(sample, "accession", None),
                )
            )
        return SupplementaryFiles(out)

    @cached_property
    def bams(self) -> Any:
        """
        The alignment files the submitter sent, where there are any.

        Not the reads. Read this before downloading: a study can run to
        hundreds of gigabytes and most files are requester-pays.

        The archive files alignments against the SRA-side study, so a GEO or
        ArrayExpress accession is resolved to its linked study first. One with
        no such link, or no alignments, answers with an empty list.

        An experiment or run accession narrows the result to its own files
        rather than handing back the whole study's.
        """
        from seqout.models.api_models import BamFiles  # noqa: PLC0415 - cycle

        study = self.sra
        if not study:
            return BamFiles([])
        try:
            files = self._call("fetch_bams", study)
        except Exception:
            return BamFiles([])

        # The endpoint answers per study, so narrowing happens here. Matching
        # on the rows rather than on the accession's shape means a study
        # accession keeps everything without having to be recognised as one.
        want = self.accession.upper()
        mine = [
            b
            for b in files.root
            if want
            in {
                (b.run_accession or "").upper(),
                (b.experiment_accession or "").upper(),
            }
        ]
        return BamFiles(mine) if mine else files

    @cached_property
    def links(self) -> ProjectCrossReferenceList:
        """Cross-references to the same data in other archives."""
        return self._call("fetch_cross_references", self.project)

    @cached_property
    def enriched(self) -> Any:
        """LLM-enriched per-sample metadata (tissue, disease, assay)."""
        return self._call("fetch_project_enriched_metadata", self.project)

    @cached_property
    def pubs(self) -> list[Publication]:
        """Publications linked to this project."""
        return self.meta.publications or []

    @cached_property
    def detail(self) -> Any:
        """
        The record for this exact accession: sample detail or run row.

        None when the accession is itself a study or series; use
        meta there.
        """
        if self.kind in _ROOT_ENTITIES:
            return None
        if self.kind == "run":
            return self._sq.fetch_run(self.accession)
        if self.kind in ("sample", "experiment", "biosample"):
            name = (
                "fetch_geo_sample_detailed_metadata"
                if self.accession.upper().startswith("GSM")
                else "fetch_sample_detailed_metadata"
            )
            return self._call(name, self.accession)
        msg = (
            f"there is no detail record for {self.accession} "
            f"(a {self.kind}). Use .meta for the project it resolves to, "
            f"or .samples / .runs for its contents."
        )
        raise SeqoutError(msg)


class ShortNames:
    """One-word aliases over the fetch_* surface. Mixed into both clients."""

    def get(self, accession: str) -> Dataset:
        """Open any accession: series, study, experiment, sample or run."""
        return Dataset(self, accession)

    def paper(
        self, *, pmid: str | None = None, doi: str | None = None
    ) -> PublicationLookupResult:
        """Reverse lookup: a publication -> the projects that back it."""
        return _call(self, "find_publication", pmid=pmid, doi=doi)

    def author(self, name: str, limit: int = 200) -> AuthorProjectsResponse:
        """Every dataset linked to an author, across archives."""
        return _call(self, "search_author_projects", name, limit=limit)

    def classify(self, accession: str) -> AccessionClassification:
        """Report what kind of accession this is, and which archive owns it."""
        return _call(self, "classify_accession", accession)

    def sample_search(self, **kwargs: Any) -> Any:
        """Search samples across every study, on the harmonised data."""
        return _call(self, "sample_search", **kwargs)

    def single_cell(
        self, accession: str, limit: int | None = None, offset: int = 0
    ) -> Any:
        """Per-sample matrix dimensions and read-derived calls for a study."""
        return _call(self, "fetch_single_cell", accession, limit=limit, offset=offset)

    def microbes(self, accession: str, kind: str = "all", **kwargs: Any) -> Any:
        """Report the microbial sequence in one sample's reads, by organism."""
        return _call(self, "fetch_microbes", accession, kind=kind, **kwargs)

    def citations(
        self,
        accession: str,
        type: str = "original",  # noqa: A002
    ) -> str:
        """BibTeX for the papers behind a dataset. Empty when there are none."""
        return _call(self, "fetch_citations", accession, type=type)

    def summaries(self, accessions: list[str]) -> ProjectSummaryResultList:
        """Title / description / organisms for many projects in one request."""
        return _call(self, "bulk_fetch_project_summary", accessions)

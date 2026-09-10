"""Accession-first lazy access through Dataset and ShortNames."""

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

# Mirrors the backend classifier; E-GEAD-N and PRJC/SAMC overlap broader shapes.
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
    Lazy fields reachable from one accession.

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
        """Project metadata for this accession's root."""
        return self._sq.fetch_project_metadata(self.project)

    def _samples_of(self, accession: str) -> Any:
        # GEO/AE/GEA list channel samples; other archives list experiments
        if accession.upper().startswith(_GEO_PREFIXES):
            return self._sq.fetch_samples(accession)
        return self._sq.fetch_study_experiments(accession)

    @cached_property
    def samples(self) -> Any:
        """
        Per-sample records from the native archive or linked archive.

        GEO and ArrayExpress list channel samples; sequence archives list
        experiments. Empty native results fall back to the linked archive.
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
        """Library preparations from the linked sequencing study."""
        study = self.sra
        if not study:
            return StudyExperimentsResults([])
        return self._sq.fetch_study_experiments(study)

    @cached_property
    def runs(self) -> StudyRunsResults:
        """Sequencing runs from the linked study, if one exists."""
        study = self.sra
        if not study:
            return StudyRunsResults([])
        return self._sq.fetch_study_runs(study, full=True)

    @cached_property
    def supplementary(self) -> Any:
        """
        Processed files from the series/study and its samples.

        Series-scope files have sample=None. A GSM lists only its own files.
        GEO literal "NONE" entries are dropped because they have no URL.
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
        Submitted alignment files resolved through the SRA-side study.

        Missing linked studies or BAMs return an empty list.
        Experiment and run accessions narrow the result.
        """
        from seqout.models.api_models import BamFiles  # noqa: PLC0415 - cycle

        study = self.sra
        if not study:
            return BamFiles([])
        try:
            files = self._call("fetch_bams", study)
        except Exception:
            return BamFiles([])

        # endpoint answers per study; narrow by run or experiment accession
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

        None for study or series accessions.
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

    def longread_summary(self) -> Any:
        """Corpus-wide totals for studies with a PacBio or Oxford Nanopore run."""
        return _call(self, "fetch_longread_summary")

    def longread_facets(self) -> Any:
        """Study counts per technology, platform, instrument, organism, archive."""
        return _call(self, "fetch_longread_facets")

    def longread_projects(self, **kwargs: Any) -> Any:
        """Studies with a PacBio or Oxford Nanopore experiment, any archive."""
        return _call(self, "fetch_longread_projects", **kwargs)

    def longread_chemistry(self, accession: str) -> Any:
        """Every PacBio/Oxford Nanopore run for a study."""
        return _call(self, "fetch_longread_chemistry", accession)

    def citations(
        self,
        accession: str,
        type: str = "original",  # noqa: A002
    ) -> str:
        """BibTeX for the papers behind a dataset. Empty when there are none."""
        return _call(self, "fetch_citations", accession, type=type)

    def ontology(self, term: str, max_hops: int = 2, **kwargs: Any) -> Any:
        """Look a term up in the ontology graph. None when it is not there."""
        return _call(self, "fetch_ontology_term", term, max_hops, **kwargs)

    def summaries(self, accessions: list[str]) -> ProjectSummaryResultList:
        """Title / description / organisms for many projects in one request."""
        return _call(self, "bulk_fetch_project_summary", accessions)

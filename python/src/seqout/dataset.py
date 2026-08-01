"""
Accession-first access: ``sq.get("GSE168652")`` instead of routing by archive.

A :class:`Dataset` wraps one accession and fills each field on first access,
hopping between archives on its own — a GEO series reaches its linked SRA study
for runs, an SRA study reaches its GEO series for samples. Callers never branch
on the prefix.

:class:`ShortNames` carries the one-word aliases; both clients mix it in. The
long ``fetch_*`` names stay, so existing code and the CLI are unaffected.
"""

from __future__ import annotations

from functools import cached_property
from typing import TYPE_CHECKING, Any

from seqout.exception import SeqoutError
from seqout.models.api_models import StudyRunsResults

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

# study/project roots across SRA, ENA, DDBJ, GSA and BioProjects.
_STUDY_PREFIXES = ("SRP", "ERP", "DRP", "CRA", "HRA", "PRJ")
# series-style roots: GEO and ArrayExpress (E-MTAB-*, E-GEAD-*).
_GEO_PREFIXES = ("GSE", "E-")
_RUN_PREFIXES = ("SRR", "ERR", "DRR", "CRR", "HRR")
_SAMPLE_PREFIXES = (
    "GSM", "SRS", "SRX", "ERS", "ERX", "DRS", "DRX", "CRS", "CRX", "HRS", "HRX", "SAM",
)  # fmt: skip


def _call(client: Any, name: str, *args: Any, **kwargs: Any) -> Any:
    """Call a client method, with a clear error when the backend lacks it."""
    fn = getattr(client, name, None)
    if fn is None:
        msg = f"{name} is not available on this backend"
        raise SeqoutError(msg)
    return fn(*args, **kwargs)


def _kind(accession: str) -> str:
    """Classify an accession offline: run, sample or project."""
    up = accession.upper()
    if up.startswith(_RUN_PREFIXES):
        return "run"
    if up.startswith(_SAMPLE_PREFIXES):
        return "sample"
    return "project"


class Dataset:
    """
    Everything reachable from one accession, fetched lazily and cached.

    Accepts any accession — series, study, experiment, sample or run — and
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

    def __repr__(self) -> str:
        return f"Dataset({self.accession!r}, kind={self.kind!r})"

    def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        return _call(self._sq, name, *args, **kwargs)

    # --- archive routing ---

    @cached_property
    def project(self) -> str:
        """The study / series this accession belongs to (itself, if it is one)."""
        if self.kind == "project":
            return self.accession
        if self.accession.upper().startswith("GSM"):
            return self._sq.gsm_series(self.accession) or self.accession
        return self._sq.resolve_study(self.accession) or self.accession

    @cached_property
    def sra(self) -> str | None:
        """The archive study holding the sequencing runs (SRP/ERP/PRJ…)."""
        project = self.project
        if project.upper().startswith(_STUDY_PREFIXES):
            return project
        return self._sq.linked_study(project)

    @cached_property
    def geo(self) -> str | None:
        """The series holding the processed / supplementary files (GSE, E-…)."""
        project = self.project
        if project.upper().startswith(_GEO_PREFIXES):
            return project
        return self._sq.linked_geo(project)

    # --- data ---

    @cached_property
    def meta(self) -> ProjectMetadataResult:
        """Project metadata for :attr:`project`."""
        return self._sq.fetch_project_metadata(self.project)

    def _samples_of(self, accession: str) -> Any:
        if accession.upper().startswith(_GEO_PREFIXES):
            return self._sq.fetch_samples(accession)
        return self._sq.fetch_study_experiments(accession)

    @cached_property
    def samples(self) -> Any:
        """
        Sample records: GEO/AE channel samples, or SRA experiments.

        Falls back to the linked archive when this side lists none.
        """
        native = self._samples_of(self.project)
        if len(native):
            return native
        other = self.geo if self.sra == self.project else self.sra
        if other and other != self.project:
            return self._samples_of(other)
        return native

    @cached_property
    def runs(self) -> StudyRunsResults:
        """Every sequencing run, via the linked SRA study when needed."""
        study = self.sra
        if not study:
            return StudyRunsResults([])
        return self._sq.fetch_study_runs(study, full=True)

    @cached_property
    def links(self) -> ProjectCrossReferenceList:
        """Cross-references to the same data in other archives."""
        return self._call("fetch_cross_references", self.project)

    @cached_property
    def enriched(self) -> Any:
        """LLM-enriched per-sample metadata (tissue, disease, assay…)."""
        return self._call("fetch_project_enriched_metadata", self.project)

    @cached_property
    def pubs(self) -> list[Publication]:
        """Publications linked to this project."""
        return self.meta.publications or []

    @cached_property
    def detail(self) -> Any:
        """
        The record for this exact accession — sample detail or run row.

        ``None`` for a project accession; use :attr:`meta` there.
        """
        if self.kind == "run":
            return self._sq.fetch_run(self.accession)
        if self.kind == "sample":
            name = (
                "fetch_geo_sample_detailed_metadata"
                if self.accession.upper().startswith("GSM")
                else "fetch_sample_detailed_metadata"
            )
            return self._call(name, self.accession)
        return None


class ShortNames:
    """One-word aliases over the ``fetch_*`` surface. Mixed into both clients."""

    def get(self, accession: str) -> Dataset:
        """Open any accession — series, study, experiment, sample or run."""
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

    def summaries(self, accessions: list[str]) -> ProjectSummaryResultList:
        """Title / description / organisms for many projects in one request."""
        return _call(self, "bulk_fetch_project_summary", accessions)

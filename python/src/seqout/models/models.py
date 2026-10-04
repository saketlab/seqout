import csv
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd
from pydantic import BaseModel, ConfigDict, RootModel


class FacetValue(BaseModel):
    """
    One value of one collection's `/facets` facet: a name and its study count.

    Shared by every collection whose `/facets` endpoint returns exactly one
    `{value, studies}` pair per facet name (country, disease, perturbation,
    single-cell, spatial, tissue, longread).
    """

    model_config = ConfigDict(extra="ignore")

    value: str | None = None
    studies: int = 0


# every collection's /facets envelope
Facets = RootModel[dict[str, list[FacetValue]]]


class BaseContainer[T: BaseModel](RootModel[list[T]]):
    """A list of records that also converts to a dict, a DataFrame, or a CSV."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def to_dict(self) -> list[dict]:
        """Return the records as a list of plain dictionaries."""
        return [r.model_dump() for r in self.root]

    def to_csv(self, path: Path | str) -> None:
        """Write the records to a CSV file. An empty container writes nothing."""
        path_obj = Path(path)
        with path_obj.open("w", newline="") as f:
            if not self.root:
                return

            writer = csv.DictWriter(f, fieldnames=self.root[0].model_fields.keys())
            writer.writeheader()
            writer.writerows(self.to_dict())

    def to_df(self) -> pd.DataFrame:
        """Return the records as a pandas DataFrame, one row each."""
        return pd.DataFrame(self.to_dict())

    def __len__(self) -> int:
        return len(self.root)

    def __iter__(self) -> Iterator[T]:
        return iter(self.root)

    def __getitem__(self, index: int) -> T:
        return self.root[index]


class OffsetPage[T: BaseModel](BaseModel):
    """A `/projects` envelope paged by `offset`."""

    model_config = ConfigDict(extra="ignore")

    total: int = 0
    count: int = 0
    offset: int = 0
    results: list[T] = []


class SingleCellEvidenceProject(BaseModel):
    """
    Shared row shape for a single-cell study with population-specific evidence.

    Common to `/perturbation/projects` (`PerturbationProject`) and
    `/spatial/projects` (`SpatialProject`); each subclass appends its own
    evidence fields.
    """

    model_config = ConfigDict(extra="allow")

    study_accession: str
    title: str | None = None
    organism: str | None = None
    organisms: list[str] | None = None
    tissues: list[str] | None = None
    single_cell_modality: str | None = None
    is_long_read: bool = False
    assay_l1: str | None = None
    readout_assays: list[str] | None = None
    cell_lines: list[str] | None = None
    sample_types: list[str] | None = None
    n_samples: int | None = None
    n_cells: int | None = None
    has_matrix: bool = False
    has_fastq: bool | None = None
    has_sra: bool | None = None
    n_fastq_runs: int | None = None
    n_runs: int | None = None
    data_availability: str | None = None


class TotalContainer[T: BaseModel](BaseContainer[T]):
    """A `BaseContainer` that also carries the server's un-paginated total."""

    def __init__(self, root: list[T], /, **kwargs: Any) -> None:
        super().__init__(root)
        self.__dict__["total"] = kwargs.get("total", len(root))

    @property
    def total(self) -> int:
        """How many records match, before `limit` cut the result."""
        return self.__dict__["total"]

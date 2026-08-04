import csv
from collections.abc import Iterator
from pathlib import Path
from typing import TypeVar

import pandas as pd
from pydantic import BaseModel, ConfigDict, RootModel

T = TypeVar("T", bound=BaseModel)


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

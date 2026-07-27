import csv
from collections.abc import Iterator
from pathlib import Path
from typing import TypeVar

import pandas as pd
from pydantic import BaseModel, ConfigDict, RootModel

T = TypeVar("T", bound=BaseModel)


class BaseContainer[T: BaseModel](RootModel[list[T]]):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def to_dict(self) -> list[dict]:
        return [r.model_dump() for r in self.root]

    def to_csv(self, path: Path | str) -> None:
        path_obj = Path(path)
        with path_obj.open("w", newline="") as f:
            if not self.root:
                return

            writer = csv.DictWriter(f, fieldnames=self.root[0].model_fields.keys())
            writer.writeheader()
            writer.writerows(self.to_dict())

    def to_df(self) -> pd.DataFrame:
        return pd.DataFrame(self.to_dict())

    def __len__(self) -> int:
        return len(self.root)

    def __iter__(self) -> Iterator[T]:
        return iter(self.root)

    def __getitem__(self, index: int) -> T:
        return self.root[index]

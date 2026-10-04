from importlib.metadata import version as _version

from seqout.annotate import quick_annotation
from seqout.cohort import microbe_detections
from seqout.counts import (
    CountMatrix,
    SeqoutCounts,
    SeqoutListCounts,
    bind_counts,
    seqout_counts,
    seqout_list_counts,
)
from seqout.counts_names import file_role, group_key, is_filtered
from seqout.dataset import Dataset
from seqout.models import api_models, parquet_models
from seqout.models.api_models import SearchParams, StudyRunsResults
from seqout.seqout import Seqout, connect, connect_to_seqout
from seqout.utils import country_code_to_name, country_name_to_code, sample_frame

__version__ = _version("seqout")

__all__ = [
    "CountMatrix",
    "Dataset",
    "SearchParams",
    "Seqout",
    "SeqoutCounts",
    "SeqoutListCounts",
    "StudyRunsResults",
    "__version__",
    "api_models",
    "bind_counts",
    "connect",
    "connect_to_seqout",
    "country_code_to_name",
    "country_name_to_code",
    "file_role",
    "group_key",
    "is_filtered",
    "microbe_detections",
    "parquet_models",
    "quick_annotation",
    "sample_frame",
    "seqout_counts",
    "seqout_list_counts",
]

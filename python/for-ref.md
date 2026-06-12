SYS_PROMPT = "You are a biomedical data extractor. You extract data from given text to the following 16 fields ((always all present, null when not determinable)):organism, tissue, tissue_primary_site, tissue_site_type, cell_type, cell_line, disease, phenotype, strain, ethnicity, development_stage, treatment, genetic_modification, assay, assay_category, sample_type. You only output valid JSON."


<!-- How to create the user prompt -->
<!-- This is how I do this with my local DB, but here we have to do with Seqout's API -->
<!-- Only care about relevant part -->
<!-- Seqout's API can be found here: https://seqout.org/api-docs -->
<!-- Also we should support ArrayExpress and ENA projects too -->
<!-- You can also refer to my backend code for reference at: /Users/amkhrjee/Developer/pysradb-server  -->

"""Build a conversational JSONL + parquet dataset of (raw project details -> enriched labels).

Each line:
    {"messages": [
        {"role": "user",      "content": "<JSON string of raw project details>"},
        {"role": "assistant", "content": "<JSON string of enriched labels>"}
    ]}

USER content (raw project details), per sample:
  - study/series level: title, summary, overall_design (GEO) or title, abstract (SRA),
    cleaned (URLs / HTML tags / non-alphanumeric symbols / extra whitespace removed).
  - GEO super/sub-series: if a series' own (summary + overall_design) is thin
    (< MIN_CONTEXT_WORDS words), concatenate title/summary/overall_design from its
    superseries (if it is a subseries) or its subseries (if it is a superseries).
  - all sample attributes: GEO channel Characteristics (+ source/sample title/description)
    or SRA attributes_json (+ sample title/description).

ASSISTANT content (enriched labels): exactly these 16 fields from ontology_samples,
all keys always present (null where missing):
    ethnicity, phenotype, cell_type, tissue, strain, disease, assay, assay_category,
    cell_line, treatment, development_stage, sample_type, genetic_modification,
    organism, tissue_primary_site, tissue_site_type.

Excluded: any sample present in wrong_organism.pkl, wrong_attributes.pkl, or
wrong_h9.pkl (keyed on (study_accession, sample)).

Only GEO (GSE / E-GEOD studies, GSM samples) and SRA (SRP/ERP/DRP studies,
SRS/ERS/DRS samples) are sourceable; ArrayExpress-only studies (E-MTAB ...) have no
joinable source here and are skipped.

Outputs (written to OUTPUT_DIR):
    seqout_enrichment.jsonl
    seqout_enrichment.parquet   (column `messages`: list<struct<role, content>>)
"""

import json
import multiprocessing as mp
import pickle
import re
import shutil
import sqlite3
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from tqdm import tqdm

ENRICHED_DB = Path("/data/share/enriched_metadata_v3_merge.db")
GEO_DB = Path("/NAS/aniruddham/ncbi_data/geo_metadata_2026-01-27.db")
SRA_DB = Path("/NAS/pysraweb/pysradbv3.db")

WRONG_PKLS = [
    Path("wrong_organism.pkl"),
    Path("wrong_attributes.pkl"),
    Path("wrong_h9.pkl"),
]

OUTPUT_DIR = Path("/NAS/aniruddham/hf-seqout")
JSONL_PATH = OUTPUT_DIR / "seqout_enrichment.jsonl"
# Parquet is written as HuggingFace-style shards: seqout_enrichment-00000-of-NNNNN.parquet
# (HF loads the directory directly). JSONL is merged into one file.
SHARD_DIR = OUTPUT_DIR / "_jsonl_shards"

# Parallelism: shard ontology_samples by rowid; each worker scans one slice once
# and writes its own JSONL + parquet shard (no serial merge/encode bottleneck).
NWORKERS = 32
NSHARDS = 64

# Excluded (study_accession, sample) pairs; loaded before the pool forks so
# workers inherit the set for free.
EXCLUDE = set()

# Enriched label fields emitted in the assistant turn (always all present).
LABEL_FIELDS = [
    "ethnicity",
    "phenotype",
    "cell_type",
    "tissue",
    "strain",
    "disease",
    "assay",
    "assay_category",
    "cell_line",
    "treatment",
    "development_stage",
    "sample_type",
    "genetic_modification",
    "organism",
    "tissue_primary_site",
    "tissue_site_type",
]

# Below this many words in a GEO series' own (summary + overall_design), pull
# context from its super/sub-series.
MIN_CONTEXT_WORDS = 15

# Parquet row-group size (rows buffered before each write).
PARQUET_BATCH = 50_000

PARQUET_SCHEMA = pa.schema(
    [
        (
            "messages",
            pa.list_(
                pa.struct([("role", pa.string()), ("content", pa.string())])
            ),
        )
    ]
)


# ----------------------------------------------------------------------------
# text helpers
# ----------------------------------------------------------------------------
_TAG_RE = re.compile(r"<[^>]+>")
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_NONALNUM_RE = re.compile(r"[^A-Za-z0-9]+")
_WS_RE = re.compile(r"\s+")


def clean_text(s) -> str:
    """Strip HTML tags, URLs, non-alphanumeric symbols, and collapse whitespace."""
    if not s:
        return ""
    s = _TAG_RE.sub(" ", str(s))
    s = _URL_RE.sub(" ", s)
    s = _NONALNUM_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def _word_count(*parts) -> int:
    return len(clean_text(" ".join(p or "" for p in parts)).split())


def _gse_accession(study_accession):
    """Enriched study accession -> GEO series accession, or None if not GEO."""
    if study_accession and study_accession.startswith(("GSE", "E-GEOD-")):
        return "GSE" + re.sub(r"\D", "", study_accession)
    return None


# ----------------------------------------------------------------------------
# attribute extraction
# ----------------------------------------------------------------------------
def geo_attributes(channels_json, sample_title, sample_description) -> dict:
    """All sample attributes from GEO channels (+ sample title/description)."""
    attrs = {}
    if channels_json:
        try:
            channels = json.loads(channels_json)
        except Exception:
            channels = None
        if isinstance(channels, dict):
            channels = [channels]
        if isinstance(channels, list):
            for ch in channels:
                if not isinstance(ch, dict):
                    continue
                chars = ch.get("Characteristics")
                if isinstance(chars, dict):
                    chars = [chars]
                if isinstance(chars, list):
                    for c in chars:
                        if isinstance(c, dict) and c.get("@tag"):
                            _add_attr(attrs, c.get("@tag"), c.get("#text"))
                for key in ("Source", "Molecule"):
                    if ch.get(key):
                        _add_attr(attrs, key.lower(), ch.get(key))
    if sample_title:
        _add_attr(attrs, "sample_title", sample_title)
    if sample_description:
        _add_attr(attrs, "sample_description", sample_description)
    return attrs


def sra_attributes(attributes_json, sample_title, sample_description) -> dict:
    """All sample attributes from SRA attributes_json (+ sample title/description)."""
    attrs = {}
    if attributes_json:
        try:
            obj = json.loads(attributes_json)
        except Exception:
            obj = None
        if isinstance(obj, dict):
            for k, v in obj.items():
                _add_attr(attrs, k, v)
    if sample_title:
        _add_attr(attrs, "sample_title", sample_title)
    if sample_description:
        _add_attr(attrs, "sample_description", sample_description)
    return attrs


def _add_attr(attrs, key, value):
    if key is None or value is None:
        return
    key = str(key).strip()
    value = value if isinstance(value, (str, int, float)) else json.dumps(value)
    value = str(value).strip()
    if not key or not value:
        return
    if key in attrs:
        if isinstance(attrs[key], list):
            if value not in attrs[key]:
                attrs[key].append(value)
        elif attrs[key] != value:
            attrs[key] = [attrs[key], value]
    else:
        attrs[key] = value


# ----------------------------------------------------------------------------
# study/series text (with GEO super/sub-series augmentation), memoized
# ----------------------------------------------------------------------------
class StudyText:
    def __init__(self, conn):
        self.conn = conn  # enriched conn with geo + sra ATTACHed
        self.cache = {}

    def _geo_series_row(self, gse):
        return self.conn.execute(
            "SELECT title, summary, overall_design, relation FROM geo.geo_series WHERE accession=?",
            (gse,),
        ).fetchone()

    def _related_gses(self, relation_json):
        """Super/sub-series GEO accessions referenced in a relation field."""
        out = []
        if not relation_json:
            return out
        try:
            rels = json.loads(relation_json)
        except Exception:
            return out
        if isinstance(rels, dict):
            rels = [rels]
        if isinstance(rels, list):
            for r in rels:
                if isinstance(r, dict) and r.get("@type") in (
                    "SubSeries of",
                    "SuperSeries of",
                ):
                    tgt = r.get("@target")
                    if tgt and tgt.startswith("GSE"):
                        out.append(tgt)
        return out

    def get(self, study_accession):
        if study_accession in self.cache:
            return self.cache[study_accession]
        details = self._compute(study_accession)
        self.cache[study_accession] = details
        return details

    def _compute(self, study_accession):
        gse = _gse_accession(study_accession)
        if gse:
            row = self._geo_series_row(gse)
            if not row:
                return {}
            title, summary, design, relation = row
            # Augment thin series from super/sub-series.
            if _word_count(summary, design) < MIN_CONTEXT_WORDS:
                for rel_gse in self._related_gses(relation):
                    rel = self._geo_series_row(rel_gse)
                    if rel:
                        title = f"{title or ''} {rel[0] or ''}"
                        summary = f"{summary or ''} {rel[1] or ''}"
                        design = f"{design or ''} {rel[2] or ''}"
            return _study_dict(title=title, summary=summary, overall_design=design)

        if study_accession and study_accession.startswith(("SRP", "ERP", "DRP")):
            row = self.conn.execute(
                "SELECT title, abstract FROM sra.sra_studies WHERE accession=?",
                (study_accession,),
            ).fetchone()
            if not row:
                return {}
            return _study_dict(title=row[0], summary=row[1])

        return {}  # not sourceable (e.g. E-MTAB)


def _study_dict(title=None, summary=None, overall_design=None):
    out = {}
    for key, val in (
        ("title", title),
        ("summary", summary),
        ("overall_design", overall_design),
    ):
        cleaned = clean_text(val)
        if cleaned:
            out[key] = cleaned
    return out


# ----------------------------------------------------------------------------
# exclusions
# ----------------------------------------------------------------------------
def load_exclusions():
    exclude = set()
    for path in WRONG_PKLS:
        if not path.exists():
            print(f"WARNING: {path} not found; skipping")
            continue
        with open(path, "rb") as f:
            for entry in pickle.load(f):
                exclude.add((entry[0], entry[1]))  # (study_accession, sample)
        print(f"  loaded {path} (total excluded so far: {len(exclude):,})")
    return exclude


# ----------------------------------------------------------------------------
# sharding
# ----------------------------------------------------------------------------
def _rowid_ranges(db_path, table, nshards):
    """Split a table's rowid space into ~equal contiguous [lo, hi] ranges."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    mn, mx = conn.execute(f"SELECT MIN(rowid), MAX(rowid) FROM {table}").fetchone()
    conn.close()
    if mn is None:
        return []
    span = mx - mn + 1
    step = max(1, (span + nshards - 1) // nshards)
    ranges = []
    lo = mn
    while lo <= mx:
        ranges.append((lo, min(lo + step - 1, mx)))
        lo += step
    return ranges


def _build_record(row, n_label, study_text):
    """Return (jsonl_line, record) or a skip reason string."""
    study, sample = row[0], row[1]
    if (study, sample) in EXCLUDE:
        return "excluded"

    labels = row[2 : 2 + n_label]
    i = 2 + n_label
    g_channels, g_title, g_desc = row[i], row[i + 1], row[i + 2]
    s_attrs, s_title, s_desc = row[i + 3], row[i + 4], row[i + 5]

    details = dict(study_text.get(study))  # copy (cache value is shared)

    if _gse_accession(study) is not None or g_channels is not None:
        attrs = geo_attributes(g_channels, g_title, g_desc)
    elif study and study.startswith(("SRP", "ERP", "DRP")):
        attrs = sra_attributes(s_attrs, s_title, s_desc)
    else:
        attrs = {}
    if attrs:
        details["attributes"] = attrs

    if not details:
        return "no_source"

    enriched = {
        field: (value if (value is not None and value != "") else None)
        for field, value in zip(LABEL_FIELDS, labels)
    }
    record = {
        "messages": [
            {"role": "user", "content": json.dumps(details, ensure_ascii=False)},
            {"role": "assistant", "content": json.dumps(enriched, ensure_ascii=False)},
        ]
    }
    return (json.dumps(record, ensure_ascii=False), record)


def _process_shard(task):
    """Worker: scan one rowid slice, write a JSONL shard + a parquet shard."""
    idx, lo, hi, nshards = task
    jsonl_path = SHARD_DIR / f"part-{idx:05d}.jsonl"
    parquet_path = OUTPUT_DIR / f"seqout_enrichment-{idx:05d}-of-{nshards:05d}.parquet"

    conn = sqlite3.connect(ENRICHED_DB)
    conn.execute("PRAGMA cache_size=-200000")
    conn.execute(f"ATTACH DATABASE '{GEO_DB}' AS geo")
    conn.execute(f"ATTACH DATABASE '{SRA_DB}' AS sra")
    study_text = StudyText(conn)

    n_label = len(LABEL_FIELDS)
    label_cols = ", ".join(f"o.{c}" for c in LABEL_FIELDS)
    rows = conn.execute(
        f"""
        SELECT o.study_accession, o.sample, {label_cols},
               g.channels, g.title, g.description,
               s.attributes_json, s.title, s.description
        FROM ontology_samples o
        LEFT JOIN geo.geo_samples g ON o.sample = g.accession
        LEFT JOIN sra.sra_samples s ON o.sample = s.accession
        WHERE o.rowid BETWEEN ? AND ?
        """,
        (lo, hi),
    )

    written = excluded = no_source = 0
    writer = None
    buf = []
    with open(jsonl_path, "w", encoding="utf-8") as out:
        for row in rows:
            result = _build_record(row, n_label, study_text)
            if result == "excluded":
                excluded += 1
                continue
            if result == "no_source":
                no_source += 1
                continue
            line, record = result
            out.write(line + "\n")
            buf.append(record)
            written += 1
            if len(buf) >= PARQUET_BATCH:
                if writer is None:
                    writer = pq.ParquetWriter(parquet_path, PARQUET_SCHEMA)
                writer.write_table(pa.Table.from_pylist(buf, schema=PARQUET_SCHEMA))
                buf.clear()
        if buf:
            if writer is None:
                writer = pq.ParquetWriter(parquet_path, PARQUET_SCHEMA)
            writer.write_table(pa.Table.from_pylist(buf, schema=PARQUET_SCHEMA))

    if writer is not None:
        writer.close()
    conn.close()
    return (idx, str(jsonl_path), written, excluded, no_source)


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    global EXCLUDE
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if SHARD_DIR.exists():
        shutil.rmtree(SHARD_DIR)
    SHARD_DIR.mkdir()
    # clear any stale parquet shards from a previous run
    for old in OUTPUT_DIR.glob("seqout_enrichment-*.parquet"):
        old.unlink()

    print("Loading exclusion lists...")
    EXCLUDE = load_exclusions()
    print(f"Total excluded (study, sample) pairs: {len(EXCLUDE):,}")

    ranges = _rowid_ranges(ENRICHED_DB, "ontology_samples", NSHARDS)
    tasks = [(idx, lo, hi, len(ranges)) for idx, (lo, hi) in enumerate(ranges)]
    print(f"Building dataset with {NWORKERS} workers over {len(tasks)} shards...")

    # IMPORTANT: fork (not the 3.14 default 'forkserver') so workers inherit the
    # EXCLUDE set populated above. forkserver/spawn re-import the module with
    # EXCLUDE empty -> exclusions would silently not apply. fork shares it
    # copy-on-write (one ~hundreds-of-MB copy, not one per worker).
    ctx = mp.get_context("fork")
    results = []
    with ctx.Pool(NWORKERS) as pool:
        for res in tqdm(
            pool.imap_unordered(_process_shard, tasks),
            total=len(tasks),
            desc="Shards",
        ):
            results.append(res)

    # merge JSONL shards (in shard order) into the single output file
    print("Merging JSONL shards...")
    results.sort(key=lambda r: r[0])
    with open(JSONL_PATH, "wb") as out:
        for _, shard_path, *_ in results:
            with open(shard_path, "rb") as f:
                shutil.copyfileobj(f, out, length=1 << 20)
    shutil.rmtree(SHARD_DIR)

    written = sum(r[2] for r in results)
    excluded = sum(r[3] for r in results)
    no_source = sum(r[4] for r in results)
    n_parquet = len(list(OUTPUT_DIR.glob("seqout_enrichment-*.parquet")))

    print()
    print(f"Written:               {written:,}")
    print(f"Skipped (excluded):    {excluded:,}")
    print(f"Skipped (no source):   {no_source:,}")
    print(f"JSONL:   {JSONL_PATH}")
    print(f"Parquet: {OUTPUT_DIR}/seqout_enrichment-*.parquet ({n_parquet} shards)")


if __name__ == "__main__":
    main()


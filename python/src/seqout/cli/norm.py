"""
seqout --norm: build per-sample prompts and run through a GGUF model.

Only the user turn is built here (raw project details -> the model produces the
enriched labels). The prompt-construction mirrors the offline dataset builder in
for-ref.md, adapted to the Seqout HTTP API.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from collections.abc import Callable

    from seqout.clients.api import SeqoutAPIClient
    from seqout.models.api_models import ProjectMetadataResult

from seqout.models.api_models import ExperimentSample, SampleMetadataResult

logger = logging.getLogger(__name__)

# System prompt verbatim from for-ref.md.
SYS_PROMPT = (
    "You are a biomedical data extractor. You extract data from given text to the "
    "following 16 fields ((always all present, null when not determinable)):"
    "organism, tissue, tissue_primary_site, tissue_site_type, cell_type, cell_line, "
    "disease, phenotype, strain, ethnicity, development_stage, treatment, "
    "genetic_modification, assay, assay_category, sample_type. "
    "You only output valid JSON."
)

LABEL_FIELDS = [
    "organism",
    "tissue",
    "tissue_primary_site",
    "tissue_site_type",
    "cell_type",
    "cell_line",
    "disease",
    "phenotype",
    "strain",
    "ethnicity",
    "development_stage",
    "treatment",
    "genetic_modification",
    "assay",
    "assay_category",
    "sample_type",
]

# Below this many words in a series' own (summary + overall_design), pull extra
# context from its super/sub-series.
MIN_CONTEXT_WORDS = 15

DEFAULT_ENGINE = "ollama"
# HuggingFace GGUF repo, referenced in each engine's native form.
DEFAULT_HF_REPO = "saketlab/seqoutlm-1B-GGUF"
DEFAULT_OLLAMA_MODEL = f"hf.co/{DEFAULT_HF_REPO}"
KNOWN_ENGINES = ("ollama", "llamacpp", "lmstudio")

DEFAULT_PORTS = {"ollama": 11434, "llamacpp": 8080, "lmstudio": 1234}

# HTTP status code threshold for server errors.
_SERVER_ERROR_THRESHOLD = 500


_TAG_RE = re.compile(r"<[^>]+>")
_URL_RE = re.compile(r"https?://\S+|www\.\S+")
_NONALNUM_RE = re.compile(r"[^A-Za-z0-9]+")
_WS_RE = re.compile(r"\s+")


def clean_text(s: str) -> str:
    """Strip HTML tags, URLs, non-alphanumeric symbols; collapse whitespace."""
    if not s:
        return ""
    s = _TAG_RE.sub(" ", str(s))
    s = _URL_RE.sub(" ", s)
    s = _NONALNUM_RE.sub(" ", s)
    return _WS_RE.sub(" ", s).strip()


def _word_count(*parts: str | None) -> int:
    return len(clean_text(" ".join(p or "" for p in parts)).split())


def _add_attr(attrs: dict[str, Any], key: str | None, value: Any) -> None:
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


def _study_dict(
    title: str | None = None,
    summary: str | None = None,
    overall_design: str | None = None,
) -> dict:
    out = {}
    for key, val in (
        ("title", title),
        ("summary", summary),
        ("overall_design", overall_design),
    ):
        if not val:
            continue
        cleaned = clean_text(val)
        if cleaned:
            out[key] = cleaned
    return out


@dataclass
class SampleRecord:
    sample: str
    title: str
    details: dict  # the user-turn payload (study text + attributes)
    attributes: dict = field(default_factory=dict)

    def user_prompt(self) -> str:
        """Return the JSON user-turn payload for this sample."""
        return json.dumps(self.details, ensure_ascii=False)


def _study_text_geo(meta: ProjectMetadataResult, sq: SeqoutAPIClient) -> dict:
    """GEO series text, augmented from super/sub-series when thin."""
    title, summary, design = meta.title, meta.summary, meta.overall_design
    if _word_count(summary, design) < MIN_CONTEXT_WORDS:
        for rel in meta.relations:
            if rel.type in ("SuperSeries of", "SubSeries of") and rel.target:
                if not rel.target.startswith("GSE"):
                    continue
                try:
                    other = sq.fetch_project_metadata(rel.target)
                except Exception as exc:
                    logger.warning(
                        "Failed to fetch related project %s: %s", rel.target, exc
                    )
                    continue
                title = f"{title or ''} {other.title or ''}"
                summary = f"{summary or ''} {other.summary or ''}"
                design = f"{design or ''} {other.overall_design or ''}"
    return _study_dict(title=title, summary=summary, overall_design=design)


def _geo_sample_attrs(sample: ExperimentSample) -> dict:
    """All attributes for one GEO sample (channels + source/molecule + title/desc)."""
    attrs: dict = {}
    for ch in sample.channels:
        for tag, text in (ch.characteristics or {}).items():
            _add_attr(attrs, tag, text)
        _add_attr(attrs, "source", ch.source)
        _add_attr(attrs, "molecule", ch.molecule)
    _add_attr(attrs, "sample_title", sample.title)
    _add_attr(attrs, "sample_description", sample.description)
    return attrs


def _sra_sample_attrs(sample: SampleMetadataResult) -> dict:
    """All attributes for one SRA sample (attributes_json + title/desc)."""
    attrs: dict = {}
    for key, value in (sample.attributes or {}).items():
        _add_attr(attrs, key, value)
    _add_attr(attrs, "sample_title", sample.title)
    _add_attr(attrs, "sample_description", sample.description)
    return attrs


def build_records(
    sq: SeqoutAPIClient,
    accession: str,
    on_progress: Callable[[str], None] | None = None,
) -> list[SampleRecord]:
    """
    Fetch a project's samples and build one user-turn record per sample.

    Supports GEO series (GSE), SRA/ENA studies (SRP/ERP/DRP) for "all samples",
    and single SRA samples/experiments (SRS/SRX). Raises ValueError with guidance
    for inputs that can't be resolved to sample records.
    """
    acc = accession.strip()
    up = acc.upper()

    def progress(msg: str) -> None:
        if on_progress:
            on_progress(msg)

    # GEO series -> all samples
    if up.startswith("GSE"):
        progress("Fetching series metadata")
        meta = sq.fetch_project_metadata(acc)
        study = _study_text_geo(meta, sq)
        progress("Fetching samples")
        samples = sq.fetch_samples(acc)
        records = []
        for s in samples:
            attrs = _geo_sample_attrs(s)
            details = dict(study)
            if attrs:
                details["attributes"] = attrs
            records.append(SampleRecord(s.accession, s.title or "", details, attrs))
        return records

    # SRA / ENA study -> all samples (via experiments -> sample metadata)
    if up.startswith(("SRP", "ERP", "DRP")):
        progress("Fetching study metadata")
        meta = sq.fetch_project_metadata(acc)
        study = _study_dict(title=meta.title, summary=meta.summary)
        progress("Fetching experiments")
        experiments = sq.fetch_study_experiments(acc)
        sample_ids = list(dict.fromkeys(sid for e in experiments for sid in e.samples))
        records = []
        for i, sid in enumerate(sample_ids, 1):
            progress(f"Fetching sample metadata ({i}/{len(sample_ids)})")
            try:
                sm = sq.fetch_sample_metadata(sid)
            except Exception as exc:
                logger.warning("Failed to fetch sample metadata %s: %s", sid, exc)
                continue
            attrs = _sra_sample_attrs(sm)
            details = dict(study)
            if attrs:
                details["attributes"] = attrs
            records.append(SampleRecord(sm.accession, sm.title or "", details, attrs))
        return records

    # Single SRA sample / experiment
    if up.startswith(("SRS", "ERS", "DRS", "SRX", "ERX", "DRX")):
        progress("Fetching sample metadata")
        detail = sq.fetch_sample_detailed_metadata(acc)
        study = _study_dict(
            title=detail.project.title,
            summary=detail.project.summary,
            overall_design=detail.project.overall_design,
        )
        s = detail.sample
        if not isinstance(s, SampleMetadataResult):
            raise TypeError(
                f"expected SRA sample metadata for {acc}, got {type(s).__name__}"
            )
        attrs = _sra_sample_attrs(s)
        details = dict(study)
        if attrs:
            details["attributes"] = attrs
        return [SampleRecord(s.accession, s.title or "", details, attrs)]

    # Single GEO sample
    if up.startswith("GSM"):
        progress("Fetching sample metadata")
        detail = sq.fetch_geo_sample_detailed_metadata(acc)
        study = _study_text_geo(detail.project, sq)
        s = detail.sample
        if not isinstance(s, ExperimentSample):
            raise TypeError(
                f"expected GEO sample metadata for {acc}, got {type(s).__name__}"
            )
        attrs: dict = {}
        for ch in s.channels:
            for tag, text in (ch.characteristics or {}).items():
                _add_attr(attrs, tag, text)
            _add_attr(attrs, "source", ch.source)
            _add_attr(attrs, "molecule", ch.molecule)
        _add_attr(attrs, "sample_title", s.title)
        _add_attr(attrs, "sample_description", s.description)
        details = dict(study)
        if attrs:
            details["attributes"] = attrs
        return [SampleRecord(s.accession, s.title or "", details, attrs)]

    raise ValueError(f"don't know how to fetch samples for accession '{acc}'")


class EngineError(RuntimeError):
    """Raised with a user-facing message when an engine can't be prepared."""


_HF_TOKEN_ENV = ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACE_TOKEN")


def hf_token_from_env() -> str | None:
    for key in _HF_TOKEN_ENV:
        if os.environ.get(key):
            return os.environ[key]
    return None


def set_hf_token(token: str) -> None:
    """Make a token visible to ollama serve / llama-server / huggingface_hub."""
    for key in _HF_TOKEN_ENV:
        os.environ[key] = token


def hf_repo_is_private(repo: str) -> bool:
    """Return True if the HF repo requires auth (gated/private) with no access."""
    repo = repo.split(":", maxsplit=1)[0]  # drop any quant tag, e.g. ':BF16'
    headers = {}
    token = hf_token_from_env()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        resp = httpx.get(
            f"https://huggingface.co/api/models/{repo}",
            headers=headers,
            timeout=10,
        )
    except httpx.HTTPError:
        return False  # network issue -> let the actual download surface it
    return resp.status_code in (401, 403)


def _subprocess_env() -> dict:
    """Child-process env that carries any HF token we hold."""
    return {**os.environ}


def parse_model_spec(spec: str | None) -> tuple[str, str]:
    """
    ollama/llama3 -> ('ollama', 'llama3'). Bare names default to ollama.

    Returns (engine, model). For llamacpp/lmstudio the model is an HF repo and
    defaults to the seqoutlm repo when only the engine is given.
    """
    if not spec:
        return DEFAULT_ENGINE, DEFAULT_OLLAMA_MODEL
    spec = spec.strip()
    if "/" in spec:
        head, rest = spec.split("/", 1)
        if head in KNOWN_ENGINES:
            engine, model = head, rest.strip()
        else:
            engine, model = DEFAULT_ENGINE, spec
    else:
        engine = spec if spec in KNOWN_ENGINES else DEFAULT_ENGINE
        model = "" if spec in KNOWN_ENGINES else spec
    if not model:
        model = DEFAULT_OLLAMA_MODEL if engine == "ollama" else DEFAULT_HF_REPO
    return engine, model


def _wait_for(url: str, timeout: float = 20.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(url, timeout=2).status_code < _SERVER_ERROR_THRESHOLD:
                return True
        except httpx.HTTPError:
            time.sleep(0.4)
    return False


def _pull_error(model: str, err: str) -> str:
    """Turn ollama's raw pull error into something actionable."""
    low = err.lower()
    auth_ish = any(
        s in low for s in ("realm host", "401", "unauthorized", "access", "gated")
    )
    if auth_ish and model.startswith("hf.co/"):
        repo = model[len("hf.co/") :]
        return (
            f"Could not pull '{model}' — the HuggingFace repo appears to be "
            "gated or private (HTTP 401).\n"
            f"  • Request/accept access at https://huggingface.co/{repo}\n"
            "  • Log in so ollama can use your token (`huggingface-cli login`), "
            "or set HF_TOKEN.\n"
            "  • Or point at a model you already have, e.g. "
            "`--model ollama/<your-model>`.\n"
            f"  (raw error: {err})"
        )
    return f"ollama pull failed: {err}"


class OllamaEngine:
    """Fully managed: starts ollama serve, pulls the model, and chats."""

    name = "ollama"
    detected = False

    def __init__(self, model: str, port: int = DEFAULT_PORTS["ollama"]) -> None:
        """Initialize with model name and optional port."""
        self.model = model
        self.base = f"http://localhost:{port}"

    def hf_repo(self) -> str | None:
        """Return the HF repo to download, or None if already loaded."""
        if self.detected:
            return None  # already loaded; nothing to download
        return self.model[len("hf.co/") :] if self.model.startswith("hf.co/") else None

    def ensure_ready(self, status: Callable[[str], None] | None = None) -> None:
        """Ensure the ollama server is running and the model is available."""
        if self.detected:
            return
        ollama_path = shutil.which("ollama")
        if ollama_path is None:
            msg = (
                "Ollama is not installed.\n"
                "  Install it from https://ollama.com/download "
                "(or `brew install ollama`),\n"
                "  then re-run this command."
            )
            raise EngineError(msg)
        # server
        try:
            httpx.get(f"{self.base}/api/version", timeout=2)
        except httpx.HTTPError:
            if status:
                status("Starting ollama server")
            subprocess.Popen(  # noqa: S603
                [ollama_path, "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=_subprocess_env(),
            )
            if not _wait_for(f"{self.base}/api/version"):
                msg = (
                    "Could not start the ollama server. Try running `ollama serve` "
                    "in another terminal."
                )
                raise EngineError(msg) from None
        # model present?
        tags = httpx.get(f"{self.base}/api/tags", timeout=10).json()
        have = {m["name"] for m in tags.get("models", [])}
        have |= {n.split(":")[0] for n in have}
        if self.model not in have and f"{self.model}:latest" not in have:
            self._pull(status)

    def _pull(self, status: Callable[[str], None] | None = None) -> None:
        if status:
            status(f"Pulling {self.model} (first run only)")
        with httpx.stream(
            "POST",
            f"{self.base}/api/pull",
            json={"name": self.model, "stream": True},
            timeout=None,  # noqa: S113
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                msg = json.loads(line)
                if msg.get("error"):
                    raise EngineError(_pull_error(self.model, msg["error"]))
                if status and msg.get("status"):
                    total, done = msg.get("total"), msg.get("completed")
                    if total and done:
                        pct = done / total * 100
                        status(f"Pulling {self.model}: {msg['status']} {pct:.0f}%")
                    else:
                        status(f"Pulling {self.model}: {msg['status']}")

    def chat(self, system: str, user: str) -> str:
        """Send a chat request and return the model response."""
        resp = httpx.post(
            f"{self.base}/api/chat",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "stream": False,
                "options": {"temperature": 0},
            },
            timeout=300,
        )
        resp.raise_for_status()
        return resp.json()["message"]["content"]


class _OpenAICompatEngine:
    """Shared client for llama.cpp / LM Studio OpenAI-compatible servers."""

    name = "openai-compat"
    base = ""  # set per instance, e.g. http://localhost:8080/v1
    api_model = "default"
    repo = ""
    detected = False

    def hf_repo(self) -> str | None:
        """Return the HF repo to download, or None if already loaded."""
        if self.detected:
            return None  # already being served; nothing to download
        return self.repo or None

    def ensure_ready(self, status: Callable[[str], None] | None = None) -> None:
        """Ensure the server is ready (base: no-op for already-running servers)."""
        del status

    def chat(self, system: str, user: str) -> str:
        resp = httpx.post(
            f"{self.base}/chat/completions",
            json={
                "model": self.api_model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": 0,
            },
            timeout=300,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


class LlamaCppEngine(_OpenAICompatEngine):
    """Serves the HF repo with llama-server -hf <repo>."""

    name = "llamacpp"

    def __init__(self, repo: str, port: int = DEFAULT_PORTS["llamacpp"]) -> None:
        """Initialize with an HF repo and optional port."""
        self.repo = repo
        self.port = port
        self.base = f"http://localhost:{port}/v1"

    def ensure_ready(self, status: Callable[[str], None] | None = None) -> None:
        """Ensure the llama.cpp server is running with the model loaded."""
        if self.detected:
            return
        llama_server_path = shutil.which("llama-server")
        if llama_server_path is None:
            msg = (
                "llama.cpp is not installed.\n"
                "  Install it (e.g. `brew install llama.cpp`) and re-run, or use "
                "`--model ollama/...`."
            )
            raise EngineError(msg)
        health = f"http://localhost:{self.port}/health"
        try:
            httpx.get(health, timeout=2)
        except httpx.HTTPError:
            pass
        else:
            return
        if status:
            status(f"Starting llama-server with {self.repo}")
        subprocess.Popen(  # noqa: S603
            [llama_server_path, "-hf", self.repo, "--port", str(self.port), "--jinja"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=_subprocess_env(),
        )
        if not _wait_for(health, timeout=180):
            raise EngineError(
                "llama-server did not become ready (model download can take a while). "
                "Try starting it manually: "
                f"`llama-server -hf {self.repo} --port {self.port} --jinja`"
            )


class LMStudioEngine(_OpenAICompatEngine):
    """Uses the lms CLI to start the server and load the model."""

    name = "lmstudio"

    def __init__(self, repo: str, port: int = DEFAULT_PORTS["lmstudio"]) -> None:
        """Initialize with an HF repo and optional port."""
        self.repo = repo
        self.api_model = repo
        self.port = port
        self.base = f"http://localhost:{port}/v1"

    def ensure_ready(self, status: Callable[[str], None] | None = None) -> None:
        """Ensure LM Studio server is running and the model is loaded."""
        if self.detected:
            return
        lms_path = shutil.which("lms")
        if lms_path is None:
            msg = (
                "LM Studio CLI (`lms`) is not installed.\n"
                "  Install LM Studio from https://lmstudio.ai and run `lms bootstrap`, "
                "or use `--model ollama/...`."
            )
            raise EngineError(msg)
        if status:
            status("Starting LM Studio server")
        subprocess.run(  # noqa: S603
            [lms_path, "server", "start"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=_subprocess_env(),
            check=False,
        )
        if not _wait_for(f"{self.base}/models", timeout=30):
            msg = "Could not start the LM Studio server (`lms server start`)."
            raise EngineError(msg)
        if status:
            status(f"Loading {self.repo} into LM Studio")
        subprocess.run(  # noqa: S603
            [lms_path, "load", self.repo, "--yes"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=_subprocess_env(),
            check=False,
        )


def _openai_loaded_model(base: str) -> str | None:
    """First model id served by an OpenAI-compatible server, or None if down."""
    try:
        resp = httpx.get(f"{base}/models", timeout=1.5)
        resp.raise_for_status()
        data = resp.json().get("data") or []
    except (httpx.HTTPError, ValueError):
        return None
    return data[0].get("id") if data else None


def _ollama_running_model(port: int = DEFAULT_PORTS["ollama"]) -> str | None:
    """Name of a model currently loaded in ollama (/api/ps), or None."""
    try:
        resp = httpx.get(f"http://localhost:{port}/api/ps", timeout=1.5)
        resp.raise_for_status()
        models = resp.json().get("models") or []
    except (httpx.HTTPError, ValueError):
        return None
    return models[0].get("name") if models else None


def autodetect_engine(
    port: int | None = None,
) -> tuple[LlamaCppEngine | LMStudioEngine | OllamaEngine, str, str] | None:
    """
    Find a model on an already-running server.

    Returns (engine, name, model) with the engine marked as detected (so it
    won't download or prompt), or None.  With port set, only that port is
    probed (in llama.cpp -> LM Studio -> ollama order); otherwise each engine's
    default port is tried.
    """
    llamacpp_port = port or DEFAULT_PORTS["llamacpp"]
    model = _openai_loaded_model(f"http://localhost:{llamacpp_port}/v1")
    if model is not None:
        engine = LlamaCppEngine(model, port=llamacpp_port)
        engine.api_model = model or "default"
        engine.detected = True
        return engine, "llamacpp", model or "(loaded model)"

    lmstudio_port = port or DEFAULT_PORTS["lmstudio"]
    model = _openai_loaded_model(f"http://localhost:{lmstudio_port}/v1")
    if model is not None:
        engine = LMStudioEngine(model, port=lmstudio_port)
        engine.api_model = model or "default"
        engine.detected = True
        return engine, "lmstudio", model or "(loaded model)"

    ollama_port = port or DEFAULT_PORTS["ollama"]
    model = _ollama_running_model(ollama_port)
    if model:
        engine = OllamaEngine(model, port=ollama_port)
        engine.detected = True
        return engine, "ollama", model

    return None


def engine_from_base_url(
    base_url: str,
) -> tuple[_OpenAICompatEngine, str, str]:
    """
    Build an OpenAI-compatible engine for an already-running server.

    Uses base_url (e.g. http://host:8080/v1). Marked detected: never launches
    or downloads. Returns (engine, name, model) or raises EngineError if
    unreachable.
    """
    base = base_url.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    model = _openai_loaded_model(base)
    if model is None:
        raise EngineError(
            f"No OpenAI-compatible server reachable at {base}.\n"
            "  Start one there first, e.g. "
            "`llama-server -hf <repo> --port <port> --jinja`."
        )
    engine = _OpenAICompatEngine()
    engine.base = base
    engine.api_model = model or "default"
    engine.detected = True
    return engine, "openai-compat", model or "(loaded model)"


def make_engine(
    engine: str, model: str, port: int | None = None
) -> OllamaEngine | LlamaCppEngine | LMStudioEngine:
    if engine == "ollama":
        return OllamaEngine(model, port=port or DEFAULT_PORTS["ollama"])
    if engine == "llamacpp":
        return LlamaCppEngine(model, port=port or DEFAULT_PORTS["llamacpp"])
    if engine == "lmstudio":
        return LMStudioEngine(model, port=port or DEFAULT_PORTS["lmstudio"])
    raise EngineError(
        f"unknown engine '{engine}'. Use one of: {', '.join(KNOWN_ENGINES)} "
        "(e.g. --model ollama/hf.co/saketlab/seqoutlm-1B-GGUF)"
    )


def parse_labels(text: str) -> dict | None:
    """Best-effort parse of the model's JSON output into the 16 label fields."""
    text = text.strip()
    # tolerate fenced code blocks
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[-1] if "\n" in text else text
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        obj = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return {f: obj.get(f) for f in LABEL_FIELDS} if isinstance(obj, dict) else None

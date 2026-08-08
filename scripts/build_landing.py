"""Render README.md into the seqout.org/cli landing page."""

import importlib
import inspect
import json
import re
import shutil
import sys
from collections.abc import Callable
from pathlib import Path

import markdown

ASSETS = ["og-image.png", "favicon.svg"]

PAGES = ["https://seqout.org/cli/"]

CHILD_SITEMAPS = [
    "https://seqout.org/cli/pages.xml",
    "https://seqout.org/cli/python/sitemap.xml",
    "https://seqout.org/cli/R/sitemap.xml",
]

STYLE = """
:root { color-scheme: light dark; --fg:#1d1d1f; --bg:#fff; --muted:#6e6e73;
        --line:#d2d2d7; --link:#0071e3; --code-bg:#f5f5f7; }
@media (prefers-color-scheme: dark) {
  :root { --fg:#f5f5f7; --bg:#0d1117; --muted:#8b949e;
          --line:#30363d; --link:#5ac8fa; --code-bg:#161b22; }
}
* { box-sizing: border-box; }
body { max-width: 46rem; margin: 0 auto; padding: 3rem 1.25rem 5rem;
       background: var(--bg); color: var(--fg); line-height: 1.7;
       -webkit-font-smoothing: antialiased;
       font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Inter",
                    "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
h1, h2, h3 { letter-spacing: -0.02em; line-height: 1.25;
             font-family: "SF Pro Display", "SF Pro Text", -apple-system,
                          BlinkMacSystemFont, "Inter", sans-serif; }
h1 { font-size: 2.25rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.3rem; margin-top: 2.5rem; padding-bottom: 0.3rem;
     border-bottom: 1px solid var(--line); }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: "SF Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
       font-size: 0.85em; background: var(--code-bg);
       padding: 0.1em 0.35em; border-radius: 0.25rem; }
pre { background: var(--code-bg); border: 1px solid var(--line);
      border-radius: 0.5rem; padding: 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.84rem; }
table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; }
th, td { text-align: left; padding: 0.6rem 0.75rem;
         border-bottom: 1px solid var(--line); }
th { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em;
     color: var(--muted); }
footer { margin-top: 4rem; padding-top: 1.25rem; border-top: 1px solid var(--line);
         font-size: 0.8125rem; color: var(--muted); }
"""

HEAD = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>seqout - genomics metadata for Python and R</title>
<meta name="description" content="Python and R clients for seqout.org. Search study \
metadata across GEO, SRA, ENA, DDBJ, ArrayExpress, GEA and GSA, and read GEO files \
as counts matrices.">
<meta name="keywords" content="seqout, GEO, SRA, ENA, DDBJ, ArrayExpress, GEA, GSA, \
genomics metadata, accession lookup, single-cell, counts matrix, Python, R, DuckDB, Parquet">
<meta name="author" content="Saket Choudhary">
<link rel="canonical" href="https://seqout.org/cli/">
<link rel="icon" type="image/svg+xml" href="/cli/favicon.svg">
<link rel="alternate" type="text/plain" href="https://seqout.org/cli/llms.txt" title="llms.txt">
<meta property="og:type" content="website">
<meta property="og:url" content="https://seqout.org/cli/">
<meta property="og:site_name" content="seqout">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="seqout - genomics metadata for Python and R">
<meta property="og:description" content="Search study metadata across GEO, SRA, ENA, \
DDBJ, ArrayExpress, GEA and GSA, and read GEO supplementary files as counts matrices.">
<meta property="og:image" content="https://seqout.org/cli/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="seqout">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://seqout.org/cli/og-image.png">
<meta name="twitter:title" content="seqout: genomics metadata for Python and R">
<meta name="twitter:description" content="Search study metadata across seven sequencing \
archives from Python or R.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"seqout",
 "applicationCategory":"DeveloperApplication","operatingSystem":"Windows, macOS, Linux",
 "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},
 "license":"https://opensource.org/licenses/MIT",
 "description":"Python and R clients for the seqout.org genomics metadata database, covering NCBI GEO, SRA, ENA, DDBJ, ArrayExpress, GEA and GSA, with counts-matrix readers for GEO supplementary files",
 "author":{"@type":"Person","name":"Saket Choudhary","url":"https://saketlab.org"},
 "url":"https://seqout.org/cli/","codeRepository":"https://github.com/saketlab/seqout",
 "programmingLanguage":["Python","R"]}
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-7MHP1LW5FD"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-7MHP1LW5FD');
</script>
<style>%s</style>
</head><body>
"""

SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
%s
</sitemapindex>
"""

PAGES_XML = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
%s
</urlset>
"""

FOOT = """
<footer>seqout is MIT licensed.
<a href="https://github.com/saketlab/seqout">Source on GitHub</a>.</footer>
</body></html>
"""


def _notebook_to_markdown(path: Path) -> str:
    """Notebook markdown and code, without outputs."""
    cells = json.loads(path.read_text())["cells"]
    out = []
    for cell in cells:
        src = "".join(cell["source"]).rstrip()
        if not src:
            continue
        out.append(src if cell["cell_type"] == "markdown" else f"```python\n{src}\n```")
    return "\n\n".join(out)


def _render_object(path: str) -> str:
    """Render one dotted path: signature, docstring, and a class's methods."""
    module, _, name = path.rpartition(".")
    try:
        obj = getattr(importlib.import_module(module), name)
    except (ImportError, AttributeError):
        return f"### {path}\n\n(not importable at build time)"

    def one(label: str, thing: Callable[..., object]) -> str:
        try:
            sig = str(inspect.signature(thing))
        except (TypeError, ValueError):
            sig = ""
        doc = inspect.getdoc(thing) or ""
        return f"```python\n{label}{sig}\n```\n\n{doc}".rstrip()

    parts = [f"### {path}", one(name, obj)]
    if inspect.isclass(obj):
        parts += [
            one(f"{name}.{m}", fn)
            for m, fn in inspect.getmembers(obj, inspect.isfunction)
            if not m.startswith("_") and fn.__qualname__.startswith(obj.__name__)
        ]
    return "\n\n".join(parts)


def _expand_mkdocstrings(text: str) -> str:
    """Expand `::: dotted.path` mkdocstrings directives."""
    return re.sub(
        r"^:::\s+(\S+)\s*$",
        lambda m: _render_object(m.group(1)),
        text,
        flags=re.MULTILINE,
    )


def _nav_pages(mkdocs: Path) -> list[str]:
    """Page paths in mkdocs nav order."""
    # Regex, not YAML: mkdocs.yml has custom tags safe_load rejects.
    nav = mkdocs.read_text().partition("\nnav:\n")[2]
    nav = re.split(r"\n(?=\S)", nav)[0]
    return re.findall(r":\s*(\S+\.(?:md|ipynb))\s*$", nav, re.MULTILINE)


def build_llms_full(root: Path) -> str:
    """Every documented page of both clients, inlined, in nav order."""
    docs = root / "python" / "docs"
    parts = [
        (root / "llms.txt").read_text().rstrip(),
        "\n\n---\n\n# Full documentation\n\nEvery page below is the source of a"
        " rendered page linked from the index above.\n",
    ]
    sources = [docs / page for page in _nav_pages(root / "python" / "mkdocs.yml")]
    sources += sorted((root / "R" / "vignettes").glob("*.Rmd"))

    for src in sources:
        if not src.exists():
            msg = f"documented page is missing: {src}"
            raise FileNotFoundError(msg)
        text = (
            _notebook_to_markdown(src)
            if src.suffix == ".ipynb"
            else _expand_mkdocstrings(src.read_text().strip())
        )
        parts.append(f"\n---\n\n<!-- {src.relative_to(root)} -->\n\n{text}\n")

    return "\n".join(parts)


def build(root: Path, out_dir: Path) -> list[Path]:
    """Write index.html, llms.txt, llms-full.txt and sitemap.xml into out_dir."""
    body = markdown.markdown(
        (root / "README.md").read_text(), extensions=["tables", "fenced_code"]
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    page = out_dir / "index.html"
    page.write_text(HEAD % STYLE + body + FOOT)

    llms = out_dir / "llms.txt"
    shutil.copyfile(root / "llms.txt", llms)

    llms_full = out_dir / "llms-full.txt"
    llms_full.write_text(build_llms_full(root))

    for name in ASSETS:
        shutil.copyfile(root / "python" / "docs" / "assets" / name, out_dir / name)

    pages = out_dir / "pages.xml"
    pages.write_text(
        PAGES_XML % "\n".join(f"  <url><loc>{loc}</loc></url>" for loc in PAGES)
    )

    sitemap = out_dir / "sitemap.xml"
    sitemap.write_text(
        SITEMAP
        % "\n".join(f"  <sitemap><loc>{s}</loc></sitemap>" for s in CHILD_SITEMAPS)
    )

    return [
        page,
        llms,
        llms_full,
        pages,
        sitemap,
        *(out_dir / name for name in ASSETS),
    ]


if __name__ == "__main__":
    repo = Path(__file__).resolve().parent.parent
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / "landing"
    for written in build(repo, target):
        print(f"wrote {written} ({written.stat().st_size} bytes)")

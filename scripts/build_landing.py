""" """

import sys
from pathlib import Path

import markdown

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
<title>seqout — genomics metadata for Python and R</title>
<meta name="description" content="Clients for seqout.org: search study metadata \
across GEO, SRA, ENA, DDBJ, ArrayExpress, GEA and GSA, and read GEO supplementary \
files as counts matrices.">
<link rel="canonical" href="https://seqout.org/cli/">
<meta property="og:type" content="website">
<meta property="og:url" content="https://seqout.org/cli/">
<meta property="og:title" content="seqout — genomics metadata for Python and R">
<meta name="twitter:card" content="summary_large_image">
<style>%s</style>
</head><body>
"""

FOOT = """
<footer>seqout is MIT licensed.
<a href="https://github.com/saketlab/seqout">Source on GitHub</a>.</footer>
</body></html>
"""


def build(readme: Path, out_dir: Path) -> Path:
    """Write out_dir/index.html from the README."""
    body = markdown.markdown(readme.read_text(), extensions=["tables", "fenced_code"])
    out_dir.mkdir(parents=True, exist_ok=True)
    page = out_dir / "index.html"
    page.write_text(HEAD % STYLE + body + FOOT)
    return page


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "landing"
    written = build(root / "README.md", target)
    print(f"wrote {written} ({written.stat().st_size} bytes)")

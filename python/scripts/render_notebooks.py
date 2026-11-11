"""
Render docs/examples/*.ipynb to Markdown, outputs included, for Zensical.

Zensical has no notebook plugin, so the docs build runs this first. The
notebooks stay the source; the .md files are generated and gitignored.
"""

import json
import re
from pathlib import Path

from nbconvert import MarkdownExporter

EXAMPLES = Path(__file__).resolve().parent.parent / "docs" / "examples"

exporter = MarkdownExporter()
for nb in sorted(EXAMPLES.glob("*.ipynb")):
    body, _ = exporter.from_filename(str(nb))
    # links between notebooks have to follow them to their rendered pages
    body = re.sub(r"(\]\([\w./-]+)\.ipynb([#)])", r"\1.md\2", body)
    # the page description lives in the notebook metadata, as cells would render
    meta = json.loads(nb.read_text(encoding="utf-8"))["metadata"]
    if desc := meta.get("description"):
        body = f"---\ndescription: {json.dumps(desc)}\n---\n\n{body}"
    nb.with_suffix(".md").write_text(body, encoding="utf-8")
    print(f"rendered {nb.name}")  # noqa: T201

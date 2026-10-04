"""The R client carries its own copy of the country table; keep the two equal."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from seqout.constants import COUNTRY_CODE_MAP

R_TABLE = Path(__file__).parents[2] / "R" / "R" / "countries.R"


@pytest.mark.skipif(not R_TABLE.exists(), reason="R client not checked out")
def test_r_country_table_matches_python():
    pairs = re.findall(
        r'^\s+([A-Z]{3}) = "((?:[^"\\]|\\.)*)"', R_TABLE.read_text(), re.MULTILINE
    )
    # CRAN wants ASCII R code, so the R table spells accents as \uXXXX
    unescaped = {
        code: re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m[1], 16)), name)
        for code, name in pairs
    }
    assert unescaped == COUNTRY_CODE_MAP


def test_codes_are_alpha3():
    assert all(re.fullmatch(r"[A-Z]{3}", c) for c in COUNTRY_CODE_MAP)

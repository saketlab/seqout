"""Shared pytest fixtures for offline API-client tests."""

from __future__ import annotations

import pytest

from seqout.clients.api import SeqoutAPIClient


@pytest.fixture
def mock_paginated_client():
    """Return `(client, seen)`: the client replays canned pages; `seen` logs params."""

    def make(pages: list[dict]) -> tuple[SeqoutAPIClient, list[dict]]:
        sq = SeqoutAPIClient()
        seen: list[dict] = []

        def fake(url, params, response_model):
            seen.append(params)
            return response_model.model_validate(pages[len(seen) - 1])

        sq._sender = fake
        return sq, seen

    return make

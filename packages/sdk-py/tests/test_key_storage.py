"""KeyStorage tests — Round 25 seed parity."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from aegis import (
    KeyStorage,
    StoredKey,
    default_key_storage,
    file_system_key_storage,
    memory_key_storage,
)

SAMPLE = StoredKey(
    private_key="priv_b64u",
    public_key="pub_b64u",
    created_at="2026-05-20T00:00:00+00:00",
    label="test",
)


@pytest.mark.asyncio
async def test_memory_round_trip():
    s = memory_key_storage()
    assert await s.get("a") is None
    await s.put("a", SAMPLE)
    assert await s.get("a") == SAMPLE


@pytest.mark.asyncio
async def test_memory_list_and_delete():
    s = memory_key_storage()
    await s.put("a", SAMPLE)
    await s.put("b", SAMPLE)
    assert sorted(await s.list()) == ["a", "b"]
    await s.delete("a")
    assert await s.list() == ["b"]


@pytest.mark.asyncio
async def test_filesystem_round_trip(tmp_path: Path):
    s = file_system_key_storage(dir=tmp_path)
    await s.put("agent-one", SAMPLE)
    out = await s.get("agent-one")
    assert out == SAMPLE
    file = tmp_path / "agent-one.json"
    assert file.exists()
    # POSIX mode bits — owner-rw only.
    mode = file.stat().st_mode & 0o777
    assert mode & 0o077 == 0, f"file should be 0o600, got {oct(mode)}"


@pytest.mark.asyncio
async def test_filesystem_rejects_path_escape(tmp_path: Path):
    s = file_system_key_storage(dir=tmp_path)
    with pytest.raises(ValueError, match="invalid key name"):
        await s.put("../escape", SAMPLE)
    with pytest.raises(ValueError, match="invalid key name"):
        await s.put("with space", SAMPLE)


@pytest.mark.asyncio
async def test_filesystem_list_only_json(tmp_path: Path):
    s = file_system_key_storage(dir=tmp_path)
    await s.put("one", SAMPLE)
    await s.put("two", SAMPLE)
    (tmp_path / "README.txt").write_text("noise")
    assert sorted(await s.list()) == ["one", "two"]


@pytest.mark.asyncio
async def test_filesystem_delete_is_noop_when_missing(tmp_path: Path):
    s = file_system_key_storage(dir=tmp_path)
    await s.delete("nonexistent")  # no exception


def test_default_key_storage_returns_filesystem_on_local(tmp_path: Path):
    # The default picks filesystem on a writable runtime — pass `dir=`
    # to keep test isolation from ~/.aegis.
    s = default_key_storage(dir=tmp_path)
    assert isinstance(s, KeyStorage)


def test_filesystem_refuses_on_lambda(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "fn")
    with pytest.raises(RuntimeError, match="no writable filesystem"):
        file_system_key_storage(dir=tmp_path)

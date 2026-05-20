"""Pluggable persistence for Ed25519 private keys — Round 25 seed.

Mirror of the TS SDK's ``key-storage.ts``. The same threat model applies:
juniors dropping privateKey into a ``.env`` file leaks it via git; this
module gives them a sensible default that doesn't.

Implementations:

  - :func:`memory_key_storage`      — in-process dict. Lambda / tests.
  - :func:`file_system_key_storage` — ``~/.aegis/keys/`` mode 0600.
  - :class:`KmsKeyStorage`          — Protocol for remote signers (AWS
                                       KMS / GCP KMS / Vault). Provider
                                       implementations land in adapter
                                       packages, not the core SDK, to
                                       keep cloud deps optional.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional, Protocol, runtime_checkable

from .runtime import capabilities

_VALID_NAME = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class StoredKey:
    """One Ed25519 keypair record. ``private_key`` is base64url-encoded."""

    private_key: str
    """Base64url-encoded Ed25519 private key (32 bytes after decode)."""

    public_key: str
    """Base64url-encoded Ed25519 public key (32 bytes after decode)."""

    created_at: str
    """ISO 8601 timestamp of original creation."""

    agent_id: Optional[str] = None
    """Optional agentId once the key has been registered with AEGIS."""

    label: Optional[str] = None
    """Free-form human-readable label (matches ``AgentRecord.label``)."""


@runtime_checkable
class KeyStorage(Protocol):
    """Protocol every storage adapter must satisfy."""

    async def get(self, name: str) -> Optional[StoredKey]: ...
    async def put(self, name: str, key: StoredKey) -> None: ...
    async def delete(self, name: str) -> None: ...
    async def list(self) -> list[str]: ...


# ── In-memory ───────────────────────────────────────────────────────────────


@dataclass
class _MemoryKeyStorage:
    """In-process dict-backed storage. Lifetime is the Python process."""

    _store: dict[str, StoredKey] = field(default_factory=dict)

    async def get(self, name: str) -> Optional[StoredKey]:
        return self._store.get(name)

    async def put(self, name: str, key: StoredKey) -> None:
        self._store[name] = key

    async def delete(self, name: str) -> None:
        self._store.pop(name, None)

    async def list(self) -> list[str]:
        return list(self._store.keys())


def memory_key_storage() -> KeyStorage:
    """Build an in-memory KeyStorage. Use for tests and Lambda."""
    return _MemoryKeyStorage()


# ── Filesystem ──────────────────────────────────────────────────────────────


@dataclass
class _FileSystemKeyStorage:
    """Filesystem-backed storage. JSON files at ``<dir>/<name>.json``, mode 0600."""

    dir: Path

    def _file_for(self, name: str) -> Path:
        if not _VALID_NAME.match(name):
            raise ValueError(
                f'invalid key name "{name}" — allowed chars: [a-zA-Z0-9_-]',
            )
        return self.dir / f"{name}.json"

    async def get(self, name: str) -> Optional[StoredKey]:
        path = self._file_for(name)
        if not path.exists():
            return None
        data = json.loads(path.read_text("utf-8"))
        return StoredKey(**data)

    async def put(self, name: str, key: StoredKey) -> None:
        path = self._file_for(name)
        path.write_text(json.dumps(asdict(key)), encoding="utf-8")
        os.chmod(path, 0o600)

    async def delete(self, name: str) -> None:
        path = self._file_for(name)
        if path.exists():
            path.unlink()

    async def list(self) -> list[str]:
        if not self.dir.exists():
            return []
        return [p.stem for p in self.dir.glob("*.json")]


def file_system_key_storage(*, dir: Optional[Path] = None) -> KeyStorage:
    """Build a filesystem KeyStorage.

    Default directory is ``$AEGIS_KEY_DIR`` or ``~/.aegis/keys/`` (mode 0700).
    Refuses to construct on runtimes without a writable filesystem
    (e.g. AWS Lambda root FS).
    """
    caps = capabilities()
    if not caps.has_filesystem:
        raise RuntimeError(
            f"file_system_key_storage: runtime {caps.runtime!r} has no writable filesystem. "
            "Use memory_key_storage() or a KmsKeyStorage instead.",
        )
    target = dir or Path(os.environ.get("AEGIS_KEY_DIR", Path.home() / ".aegis" / "keys"))
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    return _FileSystemKeyStorage(dir=target)


# ── KMS adapter shape (Protocol only — providers in adapter packages) ────────


@runtime_checkable
class KmsKeyStorage(Protocol):
    """Marker Protocol for KMS-backed storage.

    The SDK never holds private bytes for KMS-backed keys; instead
    :meth:`sign` round-trips through the KMS Sign API. Provider
    implementations live in companion packages (``aegis_aws_kms``,
    ``aegis_gcp_kms``, ``aegis_vault``).
    """

    kind: str  # always 'kms'

    async def sign(self, name: str, message: bytes) -> str:
        """Sign ``message`` with the KMS-held private key. Returns base64url."""
        ...

    async def public_key(self, name: str) -> str:
        """Return the public key bytes. Never the private."""
        ...


def default_key_storage(*, dir: Optional[Path] = None) -> KeyStorage:
    """Pick the right default storage adapter for the current runtime.

    Returns :func:`file_system_key_storage` when the filesystem is
    writable, :func:`memory_key_storage` otherwise. Used by
    :func:`aegis.quickstart.quickstart` when the caller doesn't supply
    ``storage`` explicitly.
    """
    caps = capabilities()
    if caps.has_filesystem:
        return file_system_key_storage(dir=dir)
    return memory_key_storage()


__all__ = [
    "KeyStorage",
    "KmsKeyStorage",
    "StoredKey",
    "default_key_storage",
    "file_system_key_storage",
    "memory_key_storage",
]

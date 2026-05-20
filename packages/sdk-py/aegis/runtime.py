"""Runtime detection for the AEGIS Python SDK — Round 25 seed.

Python doesn't have the same fragmentation as the JS ecosystem (no Node
vs. Edge vs. Browser split), but the SDK still needs to introspect a
few things:

  - Are we on CPython, PyPy, or something else?
  - Are we in a serverless environment (AWS Lambda / GCP Functions)?
  - Is the filesystem writable for KeyStorage.file_system()?

These signals drive the same kind of adapter-selection that the TS SDK's
``Aegis.runtime()`` enables — symmetric across languages so cross-team
onboarding doesn't require relearning the concept.
"""
from __future__ import annotations

import os
import platform
import sys
from dataclasses import dataclass
from typing import Literal

PythonRuntime = Literal[
    "cpython",
    "pypy",
    "aws-lambda",
    "gcp-functions",
    "azure-functions",
    "vercel",
    "unknown",
]


def detect_runtime() -> PythonRuntime:
    """Detect the current Python execution environment.

    Order of precedence (most-specific first):

      1. AWS Lambda          — ``AWS_LAMBDA_FUNCTION_NAME`` env present
      2. GCP Cloud Functions — ``K_SERVICE`` env present (Cloud Run / GCF v2)
      3. Azure Functions     — ``FUNCTIONS_WORKER_RUNTIME`` env present
      4. Vercel serverless   — ``VERCEL`` env present
      5. PyPy                — ``platform.python_implementation()`` == 'PyPy'
      6. CPython             — default fallback
    """
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return "aws-lambda"
    if os.environ.get("K_SERVICE"):
        return "gcp-functions"
    if os.environ.get("FUNCTIONS_WORKER_RUNTIME"):
        return "azure-functions"
    if os.environ.get("VERCEL"):
        return "vercel"
    impl = platform.python_implementation().lower()
    if impl == "pypy":
        return "pypy"
    if impl == "cpython":
        return "cpython"
    return "unknown"


@dataclass(frozen=True)
class RuntimeCapabilities:
    """Capability snapshot. Returned by :func:`capabilities`."""

    runtime: PythonRuntime
    """Detected runtime, see :data:`PythonRuntime`."""

    has_filesystem: bool
    """True iff a persistent local filesystem is writable.

    False on Lambda's read-only filesystem (everything except ``/tmp``),
    so :func:`aegis.key_storage.file_system_key_storage` will refuse to
    construct there unless ``dir=`` is passed pointing inside ``/tmp``.
    """

    python_version: str
    """Major.minor.patch of the running Python interpreter."""

    is_async_capable: bool
    """True iff ``asyncio`` is importable.

    Always True for Python 3.11+ (which the SDK requires anyway). Kept
    in the snapshot for forward compatibility and parity with the TS
    SDK's ``hasFetch``-style capability fields.
    """


def capabilities() -> RuntimeCapabilities:
    """Return the runtime capability snapshot.

    Equivalent to TS SDK's ``Aegis.capabilities()`` — used by
    :mod:`aegis.key_storage` to pick a default adapter and by
    :func:`aegis.quickstart.quickstart` to decide whether to persist a
    keypair to disk or hold it in memory.
    """
    runtime = detect_runtime()
    fs_writable = runtime != "aws-lambda"  # Lambda root FS is read-only
    return RuntimeCapabilities(
        runtime=runtime,
        has_filesystem=fs_writable,
        python_version=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        is_async_capable=True,
    )


__all__ = [
    "PythonRuntime",
    "RuntimeCapabilities",
    "capabilities",
    "detect_runtime",
]

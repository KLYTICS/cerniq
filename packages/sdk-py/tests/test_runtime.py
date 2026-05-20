"""Runtime detection tests — Round 25 seed parity."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from aegis import RuntimeCapabilities, capabilities, detect_runtime


def test_detect_runtime_returns_known_literal():
    known = {
        "cpython",
        "pypy",
        "aws-lambda",
        "gcp-functions",
        "azure-functions",
        "vercel",
        "unknown",
    }
    assert detect_runtime() in known


def test_detect_runtime_aws_lambda_via_env():
    with patch.dict(os.environ, {"AWS_LAMBDA_FUNCTION_NAME": "fn"}):
        assert detect_runtime() == "aws-lambda"


def test_detect_runtime_gcp_functions_via_env():
    # K_SERVICE wins when AWS_LAMBDA is absent.
    new_env = {k: v for k, v in os.environ.items() if k != "AWS_LAMBDA_FUNCTION_NAME"}
    new_env["K_SERVICE"] = "my-fn"
    with patch.dict(os.environ, new_env, clear=True):
        assert detect_runtime() == "gcp-functions"


def test_detect_runtime_vercel_via_env():
    new_env = {
        k: v for k, v in os.environ.items()
        if k not in {"AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE", "FUNCTIONS_WORKER_RUNTIME"}
    }
    new_env["VERCEL"] = "1"
    with patch.dict(os.environ, new_env, clear=True):
        assert detect_runtime() == "vercel"


def test_capabilities_snapshot_on_local_python():
    snap = capabilities()
    assert isinstance(snap, RuntimeCapabilities)
    assert snap.is_async_capable is True
    assert snap.python_version.count(".") == 2  # major.minor.patch
    # Local test run isn't serverless, so filesystem should be writable.
    assert snap.has_filesystem is True


def test_capabilities_lambda_has_no_filesystem():
    with patch.dict(os.environ, {"AWS_LAMBDA_FUNCTION_NAME": "fn"}):
        snap = capabilities()
        assert snap.runtime == "aws-lambda"
        assert snap.has_filesystem is False

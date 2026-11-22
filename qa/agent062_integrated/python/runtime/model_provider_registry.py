"""Central model-selection and inventory-readiness helpers for local inference.

This module is intentionally side-effect free: it resolves the selected Ollama
model and evaluates an already-observed inventory. It must never pull models or
start/stop provider processes while answering readiness questions.
"""

from __future__ import annotations

import os
import re
from typing import Any, Mapping, Sequence


OLLAMA_MODEL_ENV = "IWXA_OLLAMA_MODEL"
OLLAMA_BASE_URL_ENV = "IWXA_OLLAMA_BASE_URL"
OLLAMA_PRODUCT_DEFAULT_MODEL = "qwen3:4b-instruct-2507-q4_K_M"
OLLAMA_PRODUCT_EXPECTED_DIGEST = "0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0"
OLLAMA_PRODUCT_EXPECTED_BYTES = 2497293803

MODEL_NOT_PRESENT = "MODEL_NOT_PRESENT"
MODEL_READY = "READY"


def local_model_pin(value):
    """Validate a saved identity; selection alone grants no invocation authority."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"name", "digest"}:
        raise ValueError("local_model_identity_invalid")
    name, digest = value.get("name"), value.get("digest")
    if (not isinstance(name, str) or not name.strip()
            or len(name.encode("utf-8")) > 240
            or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)):
        raise ValueError("local_model_identity_invalid")
    return {"name": name, "digest": digest}


def selected_ollama_model(env: Mapping[str, str] | None = None) -> str:
    """Return the explicit non-empty override or the Phase-1 product default."""

    source = os.environ if env is None else env
    override = str(source.get(OLLAMA_MODEL_ENV, "")).strip()
    return override or OLLAMA_PRODUCT_DEFAULT_MODEL


def _inventory_identity(item: Mapping[str, Any]) -> str:
    """Return the exact Ollama model identity exposed by /api/tags-like data."""

    for key in ("name", "model"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def ollama_model_readiness(
    selected_model: str,
    models: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Evaluate exact selected-model presence from an already-observed inventory.

    The comparison is deliberately exact. A similarly named model or another
    tag must not satisfy the selected model. The matching digest is surfaced only
    when Ollama itself reported one; this function never invents identity data.
    """

    model_name = str(selected_model).strip()
    if not model_name:
        raise ValueError("selected_model must be non-empty")

    for item in models:
        if _inventory_identity(item) != model_name:
            continue
        digest = item.get("digest")
        return {
            "selected_model": model_name,
            "state": MODEL_READY,
            "present": True,
            "digest": digest.strip() if isinstance(digest, str) and digest.strip() else None,
        }

    return {
        "selected_model": model_name,
        "state": MODEL_NOT_PRESENT,
        "present": False,
        "digest": None,
    }


def local_ollama_catalog(models):
    """Only local weight identities; Ollama cloud routes are never eligible."""
    result = []
    seen = set()
    for item in models:
        if not isinstance(item, dict):
            raise ValueError("ollama_inventory_invalid")
        name = _inventory_identity(item)
        digest = str(item.get("digest") or "").lower().removeprefix("sha256:")
        if name in seen:
            raise ValueError("ollama_inventory_duplicate_identity")
        if not name or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            continue
        if item.get("remote_host") or item.get("remote_model") or name.lower().endswith(":cloud"):
            continue
        capabilities = item.get("capabilities")
        if isinstance(capabilities, list) and "embedding" in capabilities and "completion" not in capabilities:
            continue
        seen.add(name)
        result.append({"name": name, "digest": digest, "size": item.get("size")})
    return result

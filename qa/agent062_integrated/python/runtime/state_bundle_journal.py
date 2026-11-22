from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from runtime import personal_agent as core

JOURNAL_SCHEMA = "IWXA_STATE_BUNDLE_JOURNAL/1.0.0"
JOURNAL_FILENAME = ".software-lifecycle-state-bundle.json"


def _canon(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canon(value)).hexdigest()


class StateBundleJournalError(RuntimeError):
    pass


class StateBundleJournal:
    """Crash-recoverable atomic-intent wrapper for a small bundle of JSON state files.

    Each target file is already written atomically by ``core.save_json``. This
    journal adds cross-file recovery: a PREPARED record containing the complete
    intended after-state is durable before any target is replaced. If the process
    stops between replacements, startup replays the exact bundle before any state
    file is loaded. Replay is idempotent because every entry is content-addressed.

    The journal filename is configurable so independent state owners can use this
    primitive under separate roots without sharing recovery locks/intents.

    This is local persistence only. It does not authorize or execute external
    effects and must never be used for provider/network side effects.
    """

    def __init__(self, root: Path, *, journal_filename: str = JOURNAL_FILENAME) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        name = str(journal_filename or "")
        if not name or name in {".", ".."} or Path(name).name != name or "/" in name or "\\" in name:
            raise StateBundleJournalError("state_bundle_journal_filename_invalid")
        self.journal_path = self.root / name

    @property
    def recovery_required(self) -> bool:
        return self.journal_path.exists()

    def _relative_target(self, path: Path) -> str:
        resolved = Path(path).resolve()
        try:
            relative = resolved.relative_to(self.root)
        except ValueError as exc:
            raise StateBundleJournalError("state_bundle_target_outside_root") from exc
        if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
            raise StateBundleJournalError("state_bundle_target_invalid")
        if resolved == self.journal_path:
            raise StateBundleJournalError("state_bundle_target_is_journal")
        return relative.as_posix()

    def _target(self, relative_path: str) -> Path:
        if not isinstance(relative_path, str) or not relative_path:
            raise StateBundleJournalError("state_bundle_relative_path_invalid")
        target = (self.root / relative_path).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as exc:
            raise StateBundleJournalError("state_bundle_journal_path_escape") from exc
        if target == self.journal_path:
            raise StateBundleJournalError("state_bundle_journal_self_target")
        return target

    def _build(self, entries: Mapping[Path, Mapping[str, Any]]) -> dict[str, Any]:
        if not entries:
            raise StateBundleJournalError("state_bundle_entries_required")
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        for path, payload in entries.items():
            relative = self._relative_target(Path(path))
            if relative in seen:
                raise StateBundleJournalError("state_bundle_duplicate_target")
            if not isinstance(payload, Mapping):
                raise StateBundleJournalError("state_bundle_payload_object_required")
            body = dict(payload)
            normalized.append({
                "relative_path": relative,
                "payload": body,
                "payload_digest": _digest(body),
            })
            seen.add(relative)
        normalized.sort(key=lambda item: item["relative_path"])
        seed = {"schema": JOURNAL_SCHEMA, "status": "PREPARED", "entries": normalized}
        return {**seed, "bundle_digest": _digest(seed)}

    def _validate(self, raw: Any) -> list[tuple[Path, dict[str, Any]]]:
        if not isinstance(raw, dict) or raw.get("schema") != JOURNAL_SCHEMA or raw.get("status") != "PREPARED":
            raise StateBundleJournalError("state_bundle_journal_schema_or_status_invalid")
        entries = raw.get("entries")
        if not isinstance(entries, list) or not entries:
            raise StateBundleJournalError("state_bundle_journal_entries_invalid")
        seed = {"schema": JOURNAL_SCHEMA, "status": "PREPARED", "entries": entries}
        if raw.get("bundle_digest") != _digest(seed):
            raise StateBundleJournalError("state_bundle_journal_digest_mismatch")
        checked: list[tuple[Path, dict[str, Any]]] = []
        seen: set[Path] = set()
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {"relative_path", "payload", "payload_digest"}:
                raise StateBundleJournalError("state_bundle_journal_entry_shape_invalid")
            target = self._target(entry["relative_path"])
            payload = entry["payload"]
            if not isinstance(payload, dict) or entry["payload_digest"] != _digest(payload):
                raise StateBundleJournalError("state_bundle_journal_payload_digest_invalid")
            if target in seen:
                raise StateBundleJournalError("state_bundle_journal_duplicate_target")
            checked.append((target, payload))
            seen.add(target)
        return checked

    def recover(self) -> bool:
        if not self.journal_path.exists():
            return False
        try:
            raw = json.loads(self.journal_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise StateBundleJournalError("state_bundle_journal_unreadable") from exc
        entries = self._validate(raw)
        for target, payload in entries:
            core.save_json(target, payload)
        self.journal_path.unlink()
        return True

    def commit(self, entries: Mapping[Path, Mapping[str, Any]]) -> None:
        if self.journal_path.exists():
            raise StateBundleJournalError("state_bundle_recovery_required")
        journal = self._build(entries)
        core.save_json(self.journal_path, journal)
        checked = self._validate(journal)
        for target, payload in checked:
            core.save_json(target, payload)
        self.journal_path.unlink()

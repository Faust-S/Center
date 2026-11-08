#!/usr/bin/env python3
"""IWXA Setup Core: reproducible product-neutral single-EXE package builder.

The native GUI stub is built separately on Windows; no Python is needed on
the user's machine. Hashes prove byte integrity, not publisher authenticity.
"""
from __future__ import annotations

import argparse
import ctypes
import shutil
import hashlib
import json
import os
import re
import stat
import struct
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

MAGIC = b"IWXA_SETUP_CORE1"
FOOTER = struct.Struct("<16sQQQ32s32s32s")
SCHEMA = "IWXA_SETUP_BUNDLE/1"
PRODUCT_SCHEMA = "IWXA_SETUP_PRODUCT/1"
MAX_FILES = 10000
MAX_TOTAL_BYTES = 4 * 1024**3
MAX_FILE_BYTES = 1024**3
MAX_METADATA_BYTES = 2 * 1024**2
CHUNK = 1024 * 1024
PRODUCT_ID = re.compile(r"[a-z][a-z0-9.-]{2,63}\Z")
VERSION = re.compile(r"\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
DISALLOWED_CHARS = set('<>:"|?*')
WINDOWS_NAMES = {"CON", "PRN", "AUX", "NUL", *("COM" + str(i) for i in range(1, 10)), *("LPT" + str(i) for i in range(1, 10))}


class SetupBundleError(ValueError):
    pass


def _canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def _hash_region(handle, offset: int, size: int) -> bytes:
    handle.seek(offset)
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        block = handle.read(min(CHUNK, remaining))
        if not block:
            raise SetupBundleError("bundle_truncated")
        digest.update(block)
        remaining -= len(block)
    return digest.digest()


def safe_relative(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 512 or "\\" in value:
        raise SetupBundleError("unsafe_relative_path")
    if value.startswith("/") or value.startswith("//") or "//" in value:
        raise SetupBundleError("unsafe_relative_path")
    parts = value.split("/")
    for part in parts:
        if (
            part in ("", ".", "..") or part.endswith((".", " "))
            or any(ord(c) < 32 or c in DISALLOWED_CHARS for c in part)
            or part.split(".", 1)[0].upper() in WINDOWS_NAMES
        ):
            raise SetupBundleError("unsafe_relative_path")
    return PurePosixPath(*parts).as_posix()


def simple_folder(value: str) -> str:
    if not isinstance(value, str) or "/" in value or "\\" in value:
        raise SetupBundleError("invalid_install_folder")
    return safe_relative(value)


def validate_product(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "schema", "id", "display_name", "publisher", "version", "architecture",
        "install_dir", "entrypoint", "data_namespace", "requirements"
    }:
        raise SetupBundleError("product_schema_invalid")
    if value["schema"] != PRODUCT_SCHEMA:
        raise SetupBundleError("product_schema_version_invalid")
    if not isinstance(value["id"], str) or not PRODUCT_ID.fullmatch(value["id"]):
        raise SetupBundleError("product_id_invalid")
    if not isinstance(value["version"], str) or not VERSION.fullmatch(value["version"]):
        raise SetupBundleError("product_version_invalid")
    # Native Setup Core currently only installs x64 payloads. Do not allow
    # package metadata to advertise ARM64 before ARM64 native acceptance.
    if value["architecture"] != "windows-x64":
        raise SetupBundleError("product_architecture_unsupported")
    if any(
        not isinstance(value[k], str) or not 1 <= len(value[k]) <= 80
        or any(ord(c) < 32 for c in value[k])
        for k in ("display_name", "publisher", "data_namespace")
    ):
        raise SetupBundleError("product_identity_invalid")
    if not PRODUCT_ID.fullmatch(value["data_namespace"]):
        raise SetupBundleError("product_data_namespace_invalid")
    simple_folder(value["install_dir"])
    safe_relative(value["entrypoint"])
    if not value["entrypoint"].lower().endswith(".exe"):
        raise SetupBundleError("product_entrypoint_not_exe")
    requirements = value["requirements"]
    if not isinstance(requirements, list) or len(requirements) > 8 or len(set(map(str, requirements))) != len(requirements):
        raise SetupBundleError("product_requirements_invalid")
    if any(req not in ("webview2-evergreen",) for req in requirements):
        raise SetupBundleError("product_requirement_unknown")
    return value


def _payload_files(root: Path) -> list[tuple[str, Path, int, str]]:
    if root.is_symlink() or not root.is_dir():
        raise SetupBundleError("payload_root_invalid")
    files: list[tuple[str, Path, int, str]] = []
    seen: set[str] = set()
    total = 0
    for item in sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix().casefold()):
        if item.is_symlink() or stat.S_ISLNK(item.lstat().st_mode):
            raise SetupBundleError("payload_symlink_forbidden")
        if item.is_dir():
            continue
        if not item.is_file():
            raise SetupBundleError("payload_not_regular_file")
        rel = safe_relative(item.relative_to(root).as_posix())
        fold = rel.casefold()
        if fold in seen:
            raise SetupBundleError("payload_duplicate_case_insensitive")
        seen.add(fold)
        size = item.stat().st_size
        total += size
        if size > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES or len(files) >= MAX_FILES:
            raise SetupBundleError("payload_limits_exceeded")
        files.append((rel, item, size, _digest_file(item)))
    if not files:
        raise SetupBundleError("payload_empty")
    return files


def _verify_native_gui_stub(path: Path) -> None:
    """Require PE GUI subsystem; never package a console or non-PE stub."""
    with path.open("rb") as handle:
        if handle.read(2) != b"MZ":
            raise SetupBundleError("native_stub_not_pe")
        handle.seek(0x3C)
        offset_bytes = handle.read(4)
        if len(offset_bytes) != 4:
            raise SetupBundleError("native_stub_not_pe")
        offset = struct.unpack("<I", offset_bytes)[0]
        if offset < 64 or offset > path.stat().st_size - 96:
            raise SetupBundleError("native_stub_not_pe")
        handle.seek(offset)
        if handle.read(4) != b"PE\x00\x00":
            raise SetupBundleError("native_stub_not_pe")
        handle.seek(offset + 24)
        optional_magic = handle.read(2)
        if optional_magic not in (b"\x0b\x01", b"\x0b\x02"):
            raise SetupBundleError("native_stub_not_pe")
        handle.seek(offset + 24 + 68)
        if handle.read(2) != b"\x02\x00":
            raise SetupBundleError("native_stub_not_gui")


def create_bundle(*, product_json: Path, payload_dir: Path, stub: Path,
                  output: Path, source_commit: str, source_tree: str) -> dict[str, Any]:
    if not SHA.fullmatch(source_commit) or not SHA.fullmatch(source_tree):
        raise SetupBundleError("source_identity_invalid")
    product = validate_product(json.loads(Path(product_json).read_text(encoding="utf-8")))
    files = _payload_files(Path(payload_dir))
    if product["entrypoint"].casefold() not in {row[0].casefold() for row in files}:
        raise SetupBundleError("product_entrypoint_missing")
    stub = Path(stub)
    if not stub.is_file() or stub.is_symlink() or stub.stat().st_size < 1024:
        raise SetupBundleError("native_gui_stub_missing")
    _verify_native_gui_stub(stub)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": SCHEMA, "product": product,
        "source": {"commit": source_commit, "tree": source_tree},
        "files": [{"path": path, "bytes": size, "sha256": digest} for path, _, size, digest in files],
    }
    meta = _canonical(manifest)
    if len(meta) > MAX_METADATA_BYTES:
        raise SetupBundleError("bundle_metadata_too_large")
    # ZIP is built on disk to avoid reading large product payloads into memory.
    with tempfile.TemporaryDirectory(prefix="iwxa-setup-pack-", dir=output.parent) as work:
        zip_path = Path(work) / "payload.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as z:
            for rel, file, _, _ in files:
                info = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with file.open("rb") as src, z.open(info, "w", force_zip64=True) as dst:
                    for block in iter(lambda: src.read(CHUNK), b""):
                        dst.write(block)
        fd, temporary = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent)
        try:
            with os.fdopen(fd, "wb") as out:
                sizes: list[int] = []
                hashes: list[bytes] = []
                for path in (stub, zip_path):
                    digest = hashlib.sha256()
                    n = 0
                    with path.open("rb") as src:
                        for block in iter(lambda: src.read(CHUNK), b""):
                            out.write(block)
                            digest.update(block)
                            n += len(block)
                    sizes.append(n)
                    hashes.append(digest.digest())
                out.write(meta)
                out.write(FOOTER.pack(MAGIC, sizes[0], sizes[1], len(meta),
                                      hashes[0], hashes[1], hashlib.sha256(meta).digest()))
                out.flush()
                os.fsync(out.fileno())
            # Verify the complete final bytes before replacing a prior
            # distributable. This also catches payload mutation during build.
            inspected = inspect_bundle(Path(temporary), verify_files=True)
            os.replace(temporary, output)
        finally:
            Path(temporary).unlink(missing_ok=True)
    result = inspected
    result["setup_sha256"] = _digest_file(output)
    result["file_count"] = len(files)
    return result


def inspect_bundle(path: Path, *, verify_files: bool = False) -> dict[str, Any]:
    path = Path(path)
    with path.open("rb") as handle:
        length = path.stat().st_size
        if length < FOOTER.size:
            raise SetupBundleError("bundle_too_short")
        handle.seek(length - FOOTER.size)
        magic, stub_size, zip_size, meta_size, stub_hash, zip_hash, meta_hash = FOOTER.unpack(handle.read(FOOTER.size))
        if magic != MAGIC or stub_size < 1024 or not 0 < zip_size <= length or not 0 < meta_size <= MAX_METADATA_BYTES:
            raise SetupBundleError("bundle_footer_invalid")
        if stub_size + zip_size + meta_size + FOOTER.size != length:
            raise SetupBundleError("bundle_layout_invalid")
        if _hash_region(handle, 0, stub_size) != stub_hash:
            raise SetupBundleError("bundle_stub_sha256_invalid")
        if _hash_region(handle, stub_size, zip_size) != zip_hash:
            raise SetupBundleError("bundle_package_sha256_invalid")
        handle.seek(stub_size + zip_size)
        meta = handle.read(meta_size)
    if hashlib.sha256(meta).digest() != meta_hash:
        raise SetupBundleError("bundle_manifest_sha256_invalid")
    value = json.loads(meta.decode("utf-8"))
    if _canonical(value) != meta or not isinstance(value, dict) or set(value) != {"schema", "product", "source", "files"}:
        raise SetupBundleError("bundle_manifest_invalid")
    if value["schema"] != SCHEMA:
        raise SetupBundleError("bundle_manifest_schema_invalid")
    validate_product(value["product"])
    rows = value["files"]
    if not isinstance(rows, list) or not 0 < len(rows) <= MAX_FILES:
        raise SetupBundleError("bundle_file_index_invalid")
    seen = set()
    total_unpacked = 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"}:
            raise SetupBundleError("bundle_file_row_invalid")
        rel = safe_relative(row["path"])
        if rel.casefold() in seen:
            raise SetupBundleError("bundle_duplicate_file")
        seen.add(rel.casefold())
        if type(row["bytes"]) is not int or not 0 <= row["bytes"] <= MAX_FILE_BYTES:
            raise SetupBundleError("bundle_file_length_invalid")
        total_unpacked += row["bytes"]
        if total_unpacked > MAX_TOTAL_BYTES:
            raise SetupBundleError("bundle_total_extracted_limit_exceeded")
        if not isinstance(row["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", row["sha256"]):
            raise SetupBundleError("bundle_file_hash_invalid")
    if value["product"]["entrypoint"].casefold() not in seen:
        raise SetupBundleError("bundle_entrypoint_missing")
    if verify_files:
        # Stream ZIP into a temporary file: the verifier must not allocate
        # the entire compressed product in RAM, even for multi-GB packages.
        with tempfile.TemporaryFile() as staged_zip:
            with path.open("rb") as source:
                source.seek(stub_size)
                remaining = zip_size
                while remaining:
                    block = source.read(min(CHUNK, remaining))
                    if not block:
                        raise SetupBundleError("bundle_truncated")
                    staged_zip.write(block)
                    remaining -= len(block)
            staged_zip.seek(0)
            with zipfile.ZipFile(staged_zip, "r") as archive:
                entries = archive.infolist()
                if len(entries) != len(rows) or any(info.is_dir() for info in entries):
                    raise SetupBundleError("bundle_zip_file_count_mismatch")
                lookup = {info.filename: info for info in entries}
                if len(lookup) != len(rows) or set(lookup) != {row["path"] for row in rows}:
                    raise SetupBundleError("bundle_zip_file_list_mismatch")
                for row in rows:
                    info = lookup[row["path"]]
                    if safe_relative(info.filename) != info.filename:
                        raise SetupBundleError("bundle_zip_path_invalid")
                    if info.file_size != row["bytes"]:
                        raise SetupBundleError("bundle_zip_entry_size_mismatch")
                    if ((info.external_attr >> 16) & 0o170000) == 0o120000:
                        raise SetupBundleError("bundle_zip_symlink_forbidden")
                    digest = hashlib.sha256()
                    count = 0
                    with archive.open(info) as member:
                        for block in iter(lambda: member.read(CHUNK), b""):
                            count += len(block)
                            if count > row["bytes"]:
                                raise SetupBundleError("bundle_zip_expansion_limit")
                            digest.update(block)
                    if count != row["bytes"] or digest.hexdigest() != row["sha256"]:
                        raise SetupBundleError("bundle_zip_entry_digest_mismatch")
    return {
        "status": "VERIFIED",
        "schema": value["schema"],
        "product": value["product"]["id"],
        "version": value["product"]["version"],
        "architecture": value["product"]["architecture"],
        "source": value["source"],
        "payload_sha256": zip_hash.hex(),
        "stub_sha256": stub_hash.hex(),
        "manifest_sha256": meta_hash.hex(),
        "bytes": length,
    }



# Experimental native signed-delivery format: place the same verified
# ZIP and canonical manifest in the Win32 PE resource section before
# signing. Windows Authenticode covers section bytes; the legacy format
# remains supported for pre-release backward-compatible snapshots.
RESOURCE_MAGIC = b"IWXA_SETUP_RSRC2"
RESOURCE_ID = 101
RESOURCE_TYPE = 10  # RT_RCDATA


def _pe_resource_api():
    if os.name != "nt":
        raise SetupBundleError("pe_resource_windows_only")
    library = ctypes.WinDLL("kernel32", use_last_error=True)
    ptr = ctypes.c_void_p
    library.BeginUpdateResourceW.argtypes = (ctypes.c_wchar_p, ctypes.c_int)
    library.BeginUpdateResourceW.restype = ptr
    library.UpdateResourceW.argtypes = (
        ptr, ptr, ptr, ctypes.c_ushort, ptr, ctypes.c_uint32
    )
    library.UpdateResourceW.restype = ctypes.c_int
    library.EndUpdateResourceW.argtypes = (ptr, ctypes.c_int)
    library.EndUpdateResourceW.restype = ctypes.c_int
    library.LoadLibraryExW.argtypes = (ctypes.c_wchar_p, ptr, ctypes.c_uint32)
    library.LoadLibraryExW.restype = ptr
    library.FindResourceW.argtypes = (ptr, ptr, ptr)
    library.FindResourceW.restype = ptr
    library.SizeofResource.argtypes = (ptr, ptr)
    library.SizeofResource.restype = ctypes.c_uint32
    library.LoadResource.argtypes = (ptr, ptr)
    library.LoadResource.restype = ptr
    library.LockResource.argtypes = (ptr,)
    library.LockResource.restype = ptr
    library.FreeLibrary.argtypes = (ptr,)
    library.FreeLibrary.restype = ctypes.c_int
    return library


def _inject_pe_resource(path: Path, content: bytes) -> None:
    if len(content) > 0x7FFFFFFF:
        raise SetupBundleError("pe_resource_maximum_payload_exceeded")
    kernel = _pe_resource_api()
    handle = kernel.BeginUpdateResourceW(str(path.resolve()), 0)
    if not handle:
        raise SetupBundleError(f"pe_resource_update_open_failed_{ctypes.get_last_error()}")
    success = False
    try:
        data = ctypes.create_string_buffer(content, len(content))
        if not kernel.UpdateResourceW(handle, RESOURCE_TYPE, RESOURCE_ID,
                                      0, data, len(content)):
            raise SetupBundleError(
                f"pe_resource_write_failed_{ctypes.get_last_error()}"
            )
        success = True
    finally:
        if not kernel.EndUpdateResourceW(handle, not success):
            raise SetupBundleError(
                f"pe_resource_update_commit_failed_{ctypes.get_last_error()}"
            )


def read_pe_resource(path: Path) -> bytes:
    kernel = _pe_resource_api()
    module = kernel.LoadLibraryExW(str(path.resolve()), None, 0x2)
    if not module:
        raise SetupBundleError("pe_resource_module_unavailable")
    try:
        handle = kernel.FindResourceW(module, RESOURCE_ID, RESOURCE_TYPE)
        if not handle:
            raise SetupBundleError("pe_resource_missing")
        size = kernel.SizeofResource(module, handle)
        if size < FOOTER.size or size > 0x7FFFFFFF:
            raise SetupBundleError("pe_resource_invalid_size")
        loaded = kernel.LoadResource(module, handle)
        address = kernel.LockResource(loaded)
        if not address:
            raise SetupBundleError("pe_resource_lock_failed")
        return ctypes.string_at(address, size)
    finally:
        kernel.FreeLibrary(module)


def create_resource_bundle(*, product_json: Path, payload_dir: Path,
                           stub: Path, output: Path, source_commit: str,
                           source_tree: str) -> dict[str, Any]:
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="iwxa-resource-pack-",
                                     dir=output.parent) as tmp:
        tmpdir = Path(tmp)
        unsigned = tmpdir / "validated-overlay.exe"
        inspected = create_bundle(
            product_json=product_json, payload_dir=payload_dir, stub=stub,
            output=unsigned, source_commit=source_commit, source_tree=source_tree,
        )
        with unsigned.open("rb") as stream:
            stream.seek(-FOOTER.size, os.SEEK_END)
            magic, stub_size, zip_size, meta_size, stub_hash, zip_hash, meta_hash = (
                FOOTER.unpack(stream.read(FOOTER.size))
            )
            if magic != MAGIC or stub_size != Path(stub).stat().st_size:
                raise SetupBundleError("pe_resource_original_bundle_invalid")
            stream.seek(stub_size)
            content = stream.read(zip_size + meta_size)
        resource = content + FOOTER.pack(
            RESOURCE_MAGIC, 0, zip_size, meta_size,
            bytes(32), zip_hash, meta_hash,
        )
        staged = tmpdir / "resource-embedded.exe"
        shutil.copyfile(stub, staged)
        _inject_pe_resource(staged, resource)
        if read_pe_resource(staged) != resource:
            raise SetupBundleError("pe_resource_final_readback_mismatch")
        os.replace(staged, output)
    inspected["format"] = "PE_RESOURCE_V2"
    inspected["setup_sha256"] = _digest_file(output)
    inspected["bytes"] = output.stat().st_size
    return inspected


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Build or inspect a product-neutral IWXA Windows Setup bundle")
    sub = p.add_subparsers(dest="action", required=True)
    for command in ("build", "build-resource"):
        build = sub.add_parser(command)
        for field in ("product", "payload", "stub", "output", "source-commit", "source-tree"):
            build.add_argument("--" + field, required=True)
    inspect = sub.add_parser("inspect")
    inspect.add_argument("path")
    args = p.parse_args(argv)
    try:
        if args.action in ("build", "build-resource"):
            method = create_resource_bundle if args.action == "build-resource" else create_bundle
            result = method(product_json=Path(args.product), payload_dir=Path(args.payload),
                stub=Path(args.stub), output=Path(args.output),
                source_commit=args.source_commit, source_tree=args.source_tree)
        else:
            result = inspect_bundle(Path(args.path), verify_files=True)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        print("IWXA_SETUP_CORE_ERROR: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

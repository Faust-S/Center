"""Read exact original Git blobs locally, without copying .git or reading dirty files.

For the existing DB9 qualification. No network fetch, credentials or source upload.
The caller owns a private temporary destination and its cleanup.
"""
import hashlib
import os
import pathlib
import re
import subprocess

PIN = 'ba821f351f95b2c986e9d748a156daf7bddc2acc'
TREE = '52d51591b10cbbc9fd88e4d7ee12a8571dd49dcf'
ROOT = 't2/current/final-successor'
OID = re.compile(r'[0-9a-f]{40}')
MAX_FILES = 4096
MAX_TOTAL = 128 * 1024 * 1024
MAX_BLOB = 32 * 1024 * 1024


class LocalSourceError(Exception):
    pass


def need(value, code):
    if not value:
        raise LocalSourceError('DB9_LOCAL_' + code)


def git(repo, *args, data=None):
    # No caller-supplied Git directory, alternate object directory, config
    # injection, replace refs, credential prompt or lazy remote object fetch.
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               GIT_TERMINAL_PROMPT='0', GIT_NO_REPLACE_OBJECTS='1',
               GIT_OPTIONAL_LOCKS='0', GIT_NO_LAZY_FETCH='1')
    try:
        result = subprocess.run(['git', '--no-replace-objects', '-c',
                                 'protocol.allow=never', '-C', str(repo), *args],
                                input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=env, timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise LocalSourceError('DB9_LOCAL_GIT_UNAVAILABLE') from error
    need(result.returncode == 0, 'GIT_READ_FAILED')
    return result.stdout


def blob_oid(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()


def safe_relative(raw):
    try:
        value = raw.decode('utf-8', errors='strict')
    except UnicodeDecodeError as error:
        raise LocalSourceError('DB9_LOCAL_PATH_INVALID') from error
    parts = value.split('/')
    # The pinned source is ordinary cross-platform text and binary files.
    # Refuse path aliases, reserved names and non-regular Git entries.
    need(all(part and part not in ('.', '..') and part.casefold() != '.git' and
             not part.endswith(('.', ' ')) and not re.search(r'[\x00-\x1f\x7f\\:<>"|?*]', part) and
             not re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part)
             for part in parts), 'PATH_INVALID')
    return value


def materialize_local_source(repo, destination, *, pin=PIN, tree=TREE, prefix=ROOT):
    """Verify the commit/tree and export only exact regular blobs in the named subtree.

    Pin arguments are injectable for local unit tests; the production launcher
    passes no overrides. A dirty or different current checkout is irrelevant.
    No private files are read from the mutable worktree.
    """
    need(OID.fullmatch(pin) and OID.fullmatch(tree), 'PIN_INVALID')
    selectors = (prefix,) if isinstance(prefix, str) else prefix
    need(isinstance(selectors, tuple) and 0 < len(selectors) <= 16 and
         all(isinstance(part, str) and safe_relative(part.encode('utf-8')) == part
             for part in selectors) and len(set(selectors)) == len(selectors), 'PREFIX_INVALID')
    repo = pathlib.Path(repo).resolve(strict=True)
    destination = pathlib.Path(destination)
    need(repo.is_dir() and not destination.exists() and not destination.is_symlink(), 'PATH_INVALID')
    destination = destination.resolve()
    need(not destination.is_relative_to(repo) and not repo.is_relative_to(destination), 'OUTPUT_OVERLAP')
    need(git(repo, 'rev-parse', '--show-object-format').strip() == b'sha1', 'OBJECT_FORMAT_INVALID')
    need(git(repo, 'rev-parse', '--verify', pin + '^{commit}').strip().decode('ascii') == pin, 'COMMIT_MISMATCH')
    need(git(repo, 'rev-parse', '--verify', pin + '^{tree}').strip().decode('ascii') == tree, 'TREE_MISMATCH')
    listing = git(repo, 'ls-tree', '-r', '-l', '-z', pin, '--', *selectors)
    rows = []
    names = set()
    total = 0
    matched = set()
    for entry in listing.split(b'\0'):
        if not entry:
            continue
        try:
            meta, raw_path = entry.split(b'\t', 1)
            mode, kind, oid, size = meta.decode('ascii').split()
            size = int(size)
        except (ValueError, UnicodeDecodeError) as error:
            raise LocalSourceError('DB9_LOCAL_TREE_ENTRY_INVALID') from error
        need(mode in ('100644', '100755') and kind == 'blob' and OID.fullmatch(oid), 'REGULAR_BLOB_REQUIRED')
        name = safe_relative(raw_path)
        folded = name.casefold()
        selected = {part for part in selectors if name == part or name.startswith(part + '/')}
        need(bool(selected) and folded not in names, 'TREE_PATH_CONFLICT')
        matched.update(selected)
        need(0 <= size <= MAX_BLOB, 'BLOB_LIMIT')
        total += size
        need(total <= MAX_TOTAL and len(rows) < MAX_FILES, 'SOURCE_LIMIT')
        rows.append((name, oid, size, mode))
        names.add(folded)
    need(bool(rows), 'SOURCE_EMPTY')
    need(matched == set(selectors), 'SOURCE_SELECTION_INCOMPLETE')
    # One bounded local object read. Check every header AND every blob hash
    # before creating the destination. No git archive attributes or filters.
    response = git(repo, 'cat-file', '--batch', data=b''.join(oid.encode('ascii') + b'\n' for _, oid, _, _ in rows))
    need(len(response) <= total + len(rows) * 100, 'BATCH_LIMIT')
    offset = 0
    verified = []
    for name, oid, size, mode in rows:
        end = response.find(b'\n', offset)
        need(end >= offset and response[offset:end] == f'{oid} blob {size}'.encode('ascii'), 'BATCH_HEADER_INVALID')
        offset = end + 1
        contents = response[offset:offset + size]
        offset += size
        need(len(contents) == size and response[offset:offset + 1] == b'\n' and blob_oid(contents) == oid, 'BLOB_IDENTITY_MISMATCH')
        offset += 1
        verified.append((name, contents, mode))
    need(offset == len(response), 'BATCH_TRAILING_BYTES')
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, contents, mode in verified:
        target = destination.joinpath(*name.split('/'))
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(contents)
        target.chmod(0o700 if mode == '100755' else 0o600)
    return {'commit': pin, 'tree': tree, 'files': len(rows), 'bytes': total,
            'private_source_exported': False, 'working_tree_used': False}

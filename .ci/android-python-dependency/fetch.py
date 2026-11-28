"""Fetch only the public PyPI sdist; no private repository or credentials."""
import hashlib
import json
from pathlib import Path
import tarfile
from urllib.parse import urlsplit
from urllib.request import urlopen

VERSION = "2026.5.1"
NAME = f"rpds_py-{VERSION}"
SHA256 = "07b24fea40541e28570e5b795a4a38fbdcd12550c06bd0748005ecc8116ca256"

def main():
    with urlopen(f"https://pypi.org/pypi/rpds-py/{VERSION}/json", timeout=30) as response:
        release = json.load(response)
    rows = [row for row in release["urls"] if row["filename"] == NAME+".tar.gz" and row["packagetype"] == "sdist"]
    if len(rows) != 1 or rows[0]["digests"]["sha256"] != SHA256:
        raise RuntimeError("UPSTREAM_SOURCE_IDENTITY")
    url = rows[0]["url"]
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "files.pythonhosted.org":
        raise RuntimeError("UPSTREAM_SOURCE_HOST")
    with urlopen(url, timeout=60) as response:
        if urlsplit(response.geturl()).netloc != parsed.netloc:
            raise RuntimeError("UPSTREAM_SOURCE_REDIRECT")
        data = response.read(2_000_001)
    if len(data) > 2_000_000 or hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError("UPSTREAM_SOURCE_DIGEST")
    root = Path("upstream")
    root.mkdir(exist_ok=False)
    archive = root / (NAME+".tar.gz")
    archive.write_bytes(data)
    with tarfile.open(archive, "r:gz") as source:
        source.extractall(root, filter="data")
    project = root / NAME
    for required in ("pyproject.toml", "Cargo.toml", "Cargo.lock"):
        if not (project/required).is_file():
            raise RuntimeError("UPSTREAM_SOURCE_INCOMPLETE")
    print("RPDS_PUBLIC_SOURCE_SHA256="+SHA256)
    print("RPDS_PUBLIC_SOURCE=PASS")

if __name__ == "__main__":
    main()

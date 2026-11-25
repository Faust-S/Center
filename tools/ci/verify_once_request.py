"""Admit one explicit CI request before any expensive/private operation."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def verify(event, event_name, repository, ref, sha, workflow, profile, revisions):
    require(event.get("repository", {}).get("full_name") == repository, "WRONG_REPOSITORY")
    require(event["repository"].get("private") is False, "PRIVATE_ACTIONS_FORBIDDEN")
    require(re.fullmatch(r"[0-9a-f]{40}", sha) is not None, "BAD_HEAD")
    require(git("rev-parse", "HEAD") == sha, "HEAD_MISMATCH")
    require(all(re.fullmatch(r"[0-9a-f]{40}", v) for v in revisions.values()), "BAD_PIN")
    if event_name == "workflow_dispatch":
        return "MANUAL"
    require(event_name == "push", "BAD_EVENT")
    require(all(event.get(k) is False for k in ("created", "deleted", "forced")), "NOT_SINGLE_UPDATE")
    before = event.get("before", "")
    require(re.fullmatch(r"[0-9a-f]{40}", before) is not None, "BAD_PARENT")
    require(before != sha and event.get("after") == sha, "PUSH_HEAD_MISMATCH")
    expected_ref = f"refs/heads/ci/once/{workflow}/{before}"
    require(ref == expected_ref and event.get("ref") == expected_ref, "WRONG_ONCE_BRANCH")
    require(git("rev-list", "--parents", "-n", "1", "HEAD").split() == [sha, before], "NOT_SINGLE_COMMIT")
    path = f".github/ci-requests/{workflow}.json"
    require(git("diff", "--no-renames", "--name-status", before, sha).splitlines() == [f"A\t{path}"], "NOT_REQUEST_ONLY")
    request = json.loads(Path(path).read_text(encoding="utf-8"))
    expected = {"schema": "IWXA_CI_ONCE/1", "workflow": workflow, "prepared_sha": before,
                "profile": profile, "revisions": revisions}
    require(request == expected, "REQUEST_INPUT_MISMATCH")
    return "ONCE"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--repository", required=True)
    p.add_argument("--workflow", required=True)
    p.add_argument("--profile", required=True)
    p.add_argument("--revision", action="append", default=[])
    args = p.parse_args()
    try:
        require(re.fullmatch(r"[a-z0-9][a-z0-9-]*", args.workflow) is not None, "BAD_WORKFLOW_ID")
        revisions = dict(item.split("=", 1) for item in args.revision)
        require(bool(revisions) and len(revisions) == len(args.revision), "BAD_REVISIONS")
        require(os.environ["GITHUB_REPOSITORY"] == args.repository, "WRONG_RUNTIME_REPOSITORY")
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        mode = verify(event, os.environ["GITHUB_EVENT_NAME"], args.repository,
                      os.environ["GITHUB_REF"], os.environ["GITHUB_SHA"],
                      args.workflow, args.profile, revisions)
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError):
        print("IWXA_CI_REQUEST=REJECTED")
        raise SystemExit(1)
    print("IWXA_CI_REQUEST=" + mode)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""test-guard: the check that runs in the TARGET repository's CI.

Layers 1 and 2 live inside agent-forge — a hook in the slot and a diff scan in the loop. Both are
the platform judging itself, which is the wrong place for the last word: if the orchestrator has a
bug, it is also the thing that would have caught it. This runs in the target repository's own CI,
where a pull request cannot merge without it, and it answers one question the other layers cannot be
trusted to answer about themselves.

The question is whether this change made the tests weaker. A change that deletes an assertion, drops
a test file, or adds a dependency has done something a diff review routinely misses, because all
three look like ordinary lines in a large diff. None of them is forbidden — each has an explicit
approval path through the pull request body — but none of them happens silently.

Standard library only, and no agent-forge import: it runs in a repository that has never heard of
this platform.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys

TEST_APPROVAL = "agent-forge: test-edit-approved"
DEPENDENCY_APPROVAL = "agent-forge: dependency-approved"

MANIFESTS = (
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
    "package.json",
    "go.mod",
    "Cargo.toml",
    "Gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
)

ASSERTION = re.compile(
    r"\b(assert|expect|should|assertThat|assertEquals|assertTrue|assertRaises)\b"
)

TEST_PATH = re.compile(
    r"(^|/)tests?/|(^|/)test_[^/]*$|_test\.[a-z]+$|\.(spec|test)\.[jt]sx?$|Test\.java$"
)


def is_test_file(path: str) -> bool:
    return bool(TEST_PATH.search(path))


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise SystemExit(f"test-guard: git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout


def changed_files(base: str, head: str) -> list[tuple[str, str]]:
    """(status, path) pairs. Renames report their destination, which is the file that now exists."""
    raw = git("diff", "--name-status", "-M", f"{base}...{head}")
    changes: list[tuple[str, str]] = []
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        changes.append((parts[0][0], parts[-1]))
    return changes


def assertion_delta(base: str, head: str, path: str) -> tuple[int, int]:
    """Assertions added and removed in one file.

    Counted on assertion-looking lines rather than on total lines because that is the thing worth
    protecting: a refactor that renames a fixture across 200 test lines is fine, and a diff that
    quietly drops three `assert`s is not, and a line count cannot tell them apart.
    """
    diff = git("diff", "-U0", f"{base}...{head}", "--", path)
    added = removed = 0
    for line in diff.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+") and ASSERTION.search(line):
            added += 1
        elif line.startswith("-") and ASSERTION.search(line):
            removed += 1
    return added, removed


def declared_dependencies(body: str) -> set[str]:
    """Packages the pull request body says a human approved."""
    approved: set[str] = set()
    for line in body.splitlines():
        stripped = line.strip().lstrip("-*").strip()
        if stripped.lower().startswith(DEPENDENCY_APPROVAL):
            names = stripped[len(DEPENDENCY_APPROVAL) :].lstrip(":").strip()
            approved |= {name.strip().lower() for name in names.split(",") if name.strip()}
    return approved


def check(base: str, head: str, body: str) -> list[str]:
    failures: list[str] = []
    test_edit_approved = TEST_APPROVAL.lower() in body.lower()

    for status, path in changed_files(base, head):
        if is_test_file(path):
            if status == "D" and not test_edit_approved:
                failures.append(
                    f"{path} was deleted. Removing a test removes the evidence that a behaviour "
                    f"still works. If it is genuinely obsolete, say so in the pull request body "
                    f"with a line beginning `{TEST_APPROVAL}`."
                )
                continue
            if status in ("M", "R"):
                added, removed = assertion_delta(base, head, path)
                if removed > added and not test_edit_approved:
                    failures.append(
                        f"{path} lost {removed - added} assertion(s) net ({removed} removed, "
                        f"{added} added). A change that makes its own test weaker cannot be "
                        f"reviewed as a change. If it is intended, say so in the pull request "
                        f"body with a line beginning `{TEST_APPROVAL}`."
                    )
        elif pathlib.PurePosixPath(path).name in MANIFESTS:
            approved = declared_dependencies(body)
            if not approved:
                failures.append(
                    f"{path} changed but no dependency was approved. A dependency is a licence, a "
                    f"maintainer and a transitive tree, none of which is visible in the diff — so "
                    f"name what was added in the pull request body with a line beginning "
                    f"`{DEPENDENCY_APPROVAL}: <package>`."
                )
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="agent-forge test-guard")
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument(
        "--body-file",
        default="",
        help="File holding the pull request body, where approvals are declared.",
    )
    args = parser.parse_args(argv)

    body = ""
    if args.body_file:
        body_path = pathlib.Path(args.body_file)
        if body_path.is_file():
            body = body_path.read_text(encoding="utf-8", errors="replace")

    failures = check(args.base, args.head, body)
    if not failures:
        print("test-guard: no test weakening and no unapproved dependency.")
        return 0

    print("test-guard FAILED\n", file=sys.stderr)
    for failure in failures:
        print(f"- {failure}\n", file=sys.stderr)
    return 1


if __name__ == "__main__":  # pragma: no cover - entry point
    raise SystemExit(main())

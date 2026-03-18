#!/usr/bin/env python3
# Recomputes sha256 hashes for all http_archive deps in bazel/core_dependencies.bzl.
# Run after any version bump so the sha256 fields stay in sync.
# Usage: python3 scripts/update_bazel_hashes.py [path/to/core_dependencies.bzl]
import hashlib
import os
import re
import sys
import tempfile
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Dep configuration: bazel name -> (version_var, url_template)
# URL templates use {VERSION} as placeholder; GitHub strips leading 'v' from
# the archive directory name, so strip_prefix does not need it.
# ---------------------------------------------------------------------------
DEPS = [
    ("com_google_flatbuffers",  "_FLATBUFFERS_VERSION", "https://github.com/google/flatbuffers/archive/refs/tags/v{VERSION}.zip"),
    ("ankerl_unordered_dense",  "_ANKERL_VERSION",      "https://github.com/martinus/unordered_dense/archive/refs/tags/v{VERSION}.zip"),
    ("rapidjson",               "_RAPIDJSON_VERSION",   "https://github.com/Tencent/rapidjson/archive/refs/tags/v{VERSION}.zip"),
    ("c4core",                  "_C4CORE_VERSION",      "https://github.com/biojppm/c4core/archive/refs/tags/v{VERSION}.zip"),
    ("rapidyaml",               "_RAPIDYAML_VERSION",   "https://github.com/biojppm/rapidyaml/archive/refs/tags/v{VERSION}.zip"),
    ("com_google_benchmark",    "_BENCHMARK_VERSION",   "https://github.com/google/benchmark/archive/refs/tags/v{VERSION}.zip"),
    ("duckdb",                  "_DUCKDB_VERSION",      "https://github.com/duckdb/duckdb/archive/refs/tags/v{VERSION}.zip"),
]


def get_version(content: str, varname: str) -> str:
    m = re.search(rf'^{re.escape(varname)}\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not m:
        raise ValueError(f"Variable {varname} not found")
    return m.group(1)


def compute_sha256(url: str) -> str:
    print(f"  Downloading: {url}", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "update_bazel_hashes/1.0"})
    with urllib.request.urlopen(req) as resp:
        data = resp.read()
    return hashlib.sha256(data).hexdigest()


def update_sha256(content: str, dep_name: str, new_sha: str) -> str:
    pattern = re.compile(
        r'(http_archive\([^)]*?name\s*=\s*"' + re.escape(dep_name) + r'"[^)]*?sha256\s*=\s*")[^"]*(")',
        re.DOTALL,
    )
    new_content, count = pattern.subn(lambda m: m.group(1) + new_sha + m.group(2), content)
    if count == 0:
        raise ValueError(f"Could not find sha256 field for dep '{dep_name}'")
    return new_content


def versions_changed(filepath: Path, workspace: Path) -> bool:
    """Return True if any _*_VERSION variable in filepath differs from the base branch.

    With Renovate executionMode=branch, version bumps are already committed to
    the PR branch before postUpgradeTasks runs, so 'git diff HEAD' is always
    empty. Compare the branch tip against origin/main (the merge base) instead.
    Falls back to 'git diff HEAD' for local invocations where origin/main is
    not available.
    """
    import subprocess
    for base in ("origin/main", "origin/master"):
        probe = subprocess.run(
            ["git", "rev-parse", "--verify", base],
            capture_output=True, cwd=str(workspace),
        )
        if probe.returncode != 0:
            continue
        result = subprocess.run(
            ["git", "diff", f"{base}...HEAD", "--", str(filepath)],
            capture_output=True, text=True, cwd=str(workspace),
        )
        if result.returncode == 0:
            return "_VERSION" in result.stdout
    # Fallback: compare working tree against HEAD (local use, detached HEAD, etc.)
    result = subprocess.run(
        ["git", "diff", "HEAD", "--", str(filepath)],
        capture_output=True, text=True, cwd=str(workspace),
    )
    if result.returncode != 0:
        print(f"git diff failed: {result.stderr.strip()}", file=sys.stderr)
        return True
    return "_VERSION" in result.stdout


def main() -> None:
    workspace = Path(os.environ.get("BUILD_WORKSPACE_DIRECTORY", "."))
    filepath = Path(sys.argv[1]) if len(sys.argv) > 1 else workspace / "bazel/core_dependencies.bzl"

    # When invoked by Renovate postUpgradeTasks, skip the (expensive) archive
    # downloads if no VERSION variable was actually changed in this branch.
    if not versions_changed(filepath, workspace):
        print(f"No _VERSION changes detected in {filepath}, skipping hash update.")
        return

    print(f"Updating sha256 hashes in {filepath} ...")
    content = filepath.read_text()

    for dep_name, version_var, url_template in DEPS:
        try:
            version = get_version(content, version_var)
        except ValueError as e:
            print(f"SKIP {dep_name}: {e}", file=sys.stderr)
            continue

        url = url_template.replace("{VERSION}", version)
        print(f"[{dep_name}] version={version}")
        sha = compute_sha256(url)
        print(f"  sha256={sha}")
        content = update_sha256(content, dep_name, sha)

    filepath.write_text(content)
    print("Done.")


if __name__ == "__main__":
    main()

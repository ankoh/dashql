"""Set the version of DashQL in every package.json that carries it.

Usage: bazel run //scripts:set_version [-- <version>]

Without a version it takes the one of the app: `git describe --tags --long` as in bazel/versioning.bzl, `v0.0.18` and
247 commits give `0.0.19-dev.247`, a commit with a tag gives `0.0.18`. It writes the version of the root, of the desktop
app and of the package on npm. Only those lines change, the formatting of the files stays.
"""

import os
import re
import subprocess
import sys

# The files and the fields that hold the version
FILES = [
    ("package.json", ["version"]),
    ("packages/dashql-native/package.json", ["version"]),
    ("packages/dashql/npm/package.json", ["version"]),
]

SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")


def git_version(root: str) -> str:
    describe = subprocess.run(
        ["git", "describe", "--tags", "--long"], cwd=root, check=True, capture_output=True, text=True
    ).stdout.strip()
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)-(\d+)-g[0-9a-f]+", describe)
    if match is None:
        sys.exit(f"cannot read a version from `git describe`: {describe}")
    major, minor, patch, dev = (int(g) for g in match.groups())
    if dev == 0:
        return f"{major}.{minor}.{patch}"
    return f"{major}.{minor}.{patch + 1}-dev.{dev}"


def set_field(text: str, field: str, version: str, path: str) -> str:
    # The first occurrence only: "version" is the field of the package, not one of a nested object
    pattern = re.compile(r'("' + re.escape(field) + r'"\s*:\s*")[^"]*(")')
    text, count = pattern.subn(lambda m: m.group(1) + version + m.group(2), text, count=1)
    if count != 1:
        sys.exit(f"{path}: no field {field}")
    return text


def main() -> None:
    root = os.environ.get("BUILD_WORKSPACE_DIRECTORY")
    if root is None:
        sys.exit("run with `bazel run //scripts:set_version`")
    if len(sys.argv) > 2:
        sys.exit("usage: bazel run //scripts:set_version [-- <version>]")
    version = sys.argv[1] if len(sys.argv) == 2 else git_version(root)
    if not SEMVER.match(version):
        sys.exit(f"not a version: {version}")

    for path, fields in FILES:
        full = os.path.join(root, path)
        with open(full, encoding="utf-8") as f:
            before = f.read()
        after = before
        for field in fields:
            after = set_field(after, field, version, path)
        if after != before:
            with open(full, "w", encoding="utf-8") as f:
                f.write(after)
        print(f"{path}: {version}")


if __name__ == "__main__":
    main()

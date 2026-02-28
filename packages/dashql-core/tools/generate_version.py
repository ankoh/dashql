#!/usr/bin/env python3
"""Generate version.cc from template using git describe or fallback."""
import os
import re
import subprocess
import sys


def main():
    if len(sys.argv) != 3:
        print("Usage: generate_version.py <template> <output>", file=sys.stderr)
        sys.exit(1)
    template_path = sys.argv[1]
    out_path = sys.argv[2]

    # Defaults (match CMake when git not found)
    major, minor, patch, dev = 0, 0, 1, 0
    version_text = "0.0.1"

    try:
        repo_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        result = subprocess.run(
            ["git", "describe", "--tags", "--long"],
            capture_output=True,
            text=True,
            cwd=repo_dir,
            timeout=5,
        )
        if result.returncode == 0:
            describe = result.stdout.strip()
            # e.g. v1.2.3-4-gabc or v1.2.3
            tag_result = subprocess.run(
                ["git", "describe", "--tags", "--abbrev=0"],
                capture_output=True,
                text=True,
                cwd=repo_dir,
                timeout=5,
            )
            if tag_result.returncode == 0:
                tag = tag_result.stdout.strip()
                m = re.match(r"v?(\d+)\.(\d+)\.(\d+)", tag)
                if m:
                    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
            dev_match = re.search(r"-(\d+)-", describe)
            if dev_match:
                dev = int(dev_match.group(1))
                if dev > 0:
                    patch += 1
                    version_text = f"{major}.{minor}.{patch}-dev.{dev}"
                else:
                    version_text = f"{major}.{minor}.{patch}"
            else:
                version_text = f"{major}.{minor}.{patch}"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    with open(template_path) as f:
        content = f.read()
    content = (
        content.replace("@DASHQL_VERSION@", version_text)
        .replace("@DASHQL_VERSION_MAJOR@", str(major))
        .replace("@DASHQL_VERSION_MINOR@", str(minor))
        .replace("@DASHQL_VERSION_PATCH@", str(patch))
        .replace("@DASHQL_VERSION_DEV@", str(dev))
    )
    with open(out_path, "w") as f:
        f.write(content)


if __name__ == "__main__":
    main()

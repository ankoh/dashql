#!/usr/bin/env python3
# Recomputes sha256 hashes for Bazel external deps after a version bump.
# Run after any version bump so the sha256 fields stay in sync.
#
# Usage, from the root of the repository:
#   python3 scripts/update_bazel_hashes.py bazel/core_dependencies.bzl
#   python3 scripts/update_bazel_hashes.py bazel/external_tableauhyperapi.bzl
#   python3 scripts/update_bazel_hashes.py bazel/external_bison.bzl           # also m4, wabt, binaryen
#   python3 scripts/update_bazel_hashes.py bazel/playwright.bzl               # follows playwright-core
#   python3 scripts/update_bazel_hashes.py tools/datasets/datasets.bzl
import hashlib
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Dep configuration: bazel name -> (version_var, url_template)
# URL templates use {VERSION} as placeholder; GitHub strips leading 'v' from
# the archive directory name, so strip_prefix does not need it.
# ---------------------------------------------------------------------------
DEPS = [
    ("com_google_flatbuffers",      "_FLATBUFFERS_VERSION", "https://github.com/google/flatbuffers/archive/refs/tags/v{VERSION}.zip"),
    ("duckdb_cli_osx",              "_DUCKDB_VERSION",      "https://github.com/duckdb/duckdb/releases/download/v{VERSION}/duckdb-cli-osx-universal.tar.gz"),
    ("duckdb_cli_linux_amd64",      "_DUCKDB_VERSION",      "https://github.com/duckdb/duckdb/releases/download/v{VERSION}/duckdb-cli-linux-amd64.tar.gz"),
]


def get_version(content: str, varname: str) -> str:
    m = re.search(rf'^{re.escape(varname)}\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not m:
        raise ValueError(f"Variable {varname} not found")
    return m.group(1)


def compute_sha256(url: str) -> str:
    print(f"  Downloading: {url}", flush=True)
    if "downloads.tableau.com" in url:
        digest = hashlib.sha256()
        process = subprocess.Popen(["curl", "-fsSL", "--retry", "3", url], stdout=subprocess.PIPE)
        assert process.stdout is not None
        while chunk := process.stdout.read(1024 * 1024):
            digest.update(chunk)
        if process.wait() != 0:
            raise RuntimeError(f"Failed to download {url} with curl")
        return digest.hexdigest()

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


def update_core_dependencies(filepath: Path) -> None:
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


# ---------------------------------------------------------------------------
# Handler: bazel/external_tableauhyperapi.bzl
# ---------------------------------------------------------------------------

_HYPER_CXX_PLATFORMS = {
    "linux_x86_64": "linux-x86_64",
    "macos_x86_64": "macos-x86_64",
    "macos_arm64": "macos-arm64",
}


def update_tableauhyperapi_hashes(filepath: Path) -> None:
    print(f"Updating sha256 hashes in {filepath} ...")
    content = filepath.read_text()
    version = get_version(content, "TABLEAUHYPERAPI_VERSION")

    print(f"[tableauhyperapi] version={version}")
    releases_url = "https://tableau.github.io/hyper-db/docs/releases"
    req = urllib.request.Request(releases_url, headers={"User-Agent": "update_bazel_hashes/1.0"})
    with urllib.request.urlopen(req) as resp:
        releases = resp.read().decode()

    for platform_key, archive_platform in _HYPER_CXX_PLATFORMS.items():
        pattern = rf'https://downloads\.tableau\.com/tssoftware/+tableauhyperapi-cxx-{archive_platform}-release-[^"<]+?\.zip'
        urls = [url for url in re.findall(pattern, releases) if f".{version}." in url]
        if urls:
            url = urls[0].replace("/tssoftware//", "/tssoftware/")
        else:
            existing = re.search(
                rf'"{platform_key}":\s*\{{.*?"url":\s*"([^"]+)"',
                content,
                flags=re.DOTALL,
            )
            if not existing or f".{version}." not in existing.group(1):
                raise ValueError(f"No C++ archive found for {platform_key} and tableauhyperapi {version}")
            url = existing.group(1)
        sha = compute_sha256(url)
        print(f"  [{platform_key}] sha256={sha}")
        block_pattern = rf'("{platform_key}":\s*\{{.*?"url":\s*")[^"]+(".*?"sha256":\s*")[^"]+(".*?"strip_prefix":\s*")[^"]+(".*?\}})'
        strip_prefix = Path(url).stem
        content, count = re.subn(
            block_pattern,
            lambda m: m.group(1) + url + m.group(2) + sha + m.group(3) + strip_prefix + m.group(4),
            content,
            count=1,
            flags=re.DOTALL,
        )
        if count != 1:
            raise ValueError(f"Could not update archive metadata for {platform_key}")

    filepath.write_text(content)
    print("Done.")


# ---------------------------------------------------------------------------
# Handler: bazel/external_{bison,m4,wabt,binaryen}.bzl
# ---------------------------------------------------------------------------
#
# The _SHA256 dict pins one archive per platform, its keys are the platform names in the
# archive names. File name -> (version_var, url_template).

_PREBUILT_ARCHIVES = {
    "external_bison.bzl": (
        "_XPACK_VERSION",
        "https://github.com/xpack-dev-tools/bison-xpack/releases/download/v{VERSION}/xpack-bison-{VERSION}-{PLATFORM}.tar.gz",
    ),
    "external_m4.bzl": (
        "_XPACK_VERSION",
        "https://github.com/xpack-dev-tools/m4-xpack/releases/download/v{VERSION}/xpack-m4-{VERSION}-{PLATFORM}.tar.gz",
    ),
    "external_wabt.bzl": (
        "_WABT_VERSION",
        "https://github.com/WebAssembly/wabt/releases/download/{VERSION}/wabt-{VERSION}-{PLATFORM}.tar.gz",
    ),
    "external_binaryen.bzl": (
        "_BINARYEN_VERSION",
        "https://github.com/WebAssembly/binaryen/releases/download/version_{VERSION}/binaryen-version_{VERSION}-{PLATFORM}.tar.gz",
    ),
}


def update_prebuilt_archives(filepath: Path) -> None:
    print(f"Updating sha256 hashes in {filepath} ...")
    content = filepath.read_text()
    version_var, url_template = _PREBUILT_ARCHIVES[filepath.name]
    version = get_version(content, version_var)
    print(f"[{filepath.stem}] version={version}")

    dict_match = re.search(r"^_SHA256\s*=\s*\{([^}]*)\}", content, re.DOTALL | re.MULTILINE)
    if not dict_match:
        raise ValueError("_SHA256 dict not found")

    for platform in re.findall(r'"([^"]+)":\s*"', dict_match.group(1)):
        sha = compute_sha256(url_template.replace("{VERSION}", version).replace("{PLATFORM}", platform))
        print(f"  [{platform}] sha256={sha}")
        content = re.sub(
            r'("' + re.escape(platform) + r'":\s*")[^"]*(")',
            lambda m, s=sha: m.group(1) + s + m.group(2),
            content,
        )

    filepath.write_text(content)
    print("Done.")


# ---------------------------------------------------------------------------
# Handler: tools/datasets/datasets.bzl (vendored DuckDB tpch extension)
# ---------------------------------------------------------------------------
#
# The TPCH_EXTENSION_SHA256 dict pins one gzipped tpch extension per platform. The
# version MUST track the DuckDB CLI (an extension only loads into the exact build it
# was compiled for), so it is bumped in lockstep with _DUCKDB_VERSION and these four
# hashes recomputed here. Keys match DuckDB's `PRAGMA platform` names.


def update_dashql_datasets(filepath: Path) -> None:
    print(f"Updating sha256 hashes in {filepath} ...")
    content = filepath.read_text()
    version = get_version(content, "TPCH_DUCKDB_VERSION")
    print(f"[tpch_extension] version={version}")

    # The set of platforms is whatever keys the dict currently declares.
    dict_match = re.search(r"TPCH_EXTENSION_SHA256\s*=\s*\{([^}]*)\}", content, re.DOTALL)
    if not dict_match:
        raise ValueError("TPCH_EXTENSION_SHA256 dict not found")
    platforms = re.findall(r'"([^"]+)":\s*"', dict_match.group(1))

    for platform in platforms:
        url = f"https://extensions.duckdb.org/v{version}/{platform}/tpch.duckdb_extension.gz"
        sha = compute_sha256(url)
        print(f"  [{platform}] sha256={sha}")
        content = re.sub(
            r'("' + re.escape(platform) + r'":\s*")[^"]*(")',
            lambda m, s=sha: m.group(1) + s + m.group(2),
            content,
        )

    filepath.write_text(content)
    print("Done.")


# ---------------------------------------------------------------------------
# Handler: bazel/playwright.bzl
# ---------------------------------------------------------------------------
#
# The browsers must be the builds that the playwright-core of package.json expects,
# which it lists in its browsers.json. Pin that version (Chromium) and revisions
# (Firefox, WebKit) and recompute the hash of every platform archive.


def _playwright_browsers() -> dict:
    package = json.loads(Path("package.json").read_text())
    version = package["devDependencies"]["playwright-core"]
    url = f"https://unpkg.com/playwright-core@{version}/browsers.json"
    req = urllib.request.Request(url, headers={"User-Agent": "update_bazel_hashes/1.0"})
    with urllib.request.urlopen(req) as resp:
        browsers = json.load(resp)["browsers"]
    print(f"[playwright-core] version={version}")
    return {b["name"]: b for b in browsers}


def _update_playwright_hashes(content: str, table: str, url_of) -> str:
    def replace(m: re.Match) -> str:
        sha = compute_sha256(url_of(m.group(2)))
        print(f"  [{m.group(2)}] sha256={sha}")
        return m.group(1) + sha + m.group(4)

    # The platform table of a browser, its entries are ("<archive>", "<sha256>", "<executable>") tuples.
    block = re.search(rf"^{table} = \{{.*?^\}}", content, re.DOTALL | re.MULTILINE)
    if not block:
        raise ValueError(f"{table} not found")
    updated = re.sub(r'(\(\s*"([^"]+)",\s*")([0-9a-f]{64})(")', replace, block.group(0))
    return content[:block.start()] + updated + content[block.end():]


def update_playwright(filepath: Path) -> None:
    browsers = _playwright_browsers()
    version = browsers["chromium-headless-shell"]["browserVersion"]
    revision = browsers["firefox"]["revision"]
    webkit_revision = browsers["webkit"]["revision"]
    content = filepath.read_text()
    content = re.sub(r'^_CHROMIUM_VERSION = "[^"]+"', f'_CHROMIUM_VERSION = "{version}"', content, flags=re.MULTILINE)
    content = re.sub(r'^_FIREFOX_REVISION = "[^"]+"', f'_FIREFOX_REVISION = "{revision}"', content, flags=re.MULTILINE)
    content = re.sub(r'^_WEBKIT_REVISION = "[^"]+"', f'_WEBKIT_REVISION = "{webkit_revision}"', content, flags=re.MULTILINE)
    chromium = f"https://cdn.playwright.dev/builds/cft/{version}/"
    content = _update_playwright_hashes(content, "_CHROMIUM_PLATFORMS", lambda archive: chromium + archive)
    firefox = f"https://cdn.playwright.dev/builds/firefox/{revision}/"
    content = _update_playwright_hashes(content, "_FIREFOX_PLATFORMS", lambda archive: firefox + archive)
    webkit = f"https://cdn.playwright.dev/builds/webkit/{webkit_revision}/"
    content = _update_playwright_hashes(content, "_WEBKIT_PLATFORMS", lambda archive: webkit + archive)
    filepath.write_text(content)
    print("Done.")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

_HANDLERS = {
    "core_dependencies.bzl": update_core_dependencies,
    "external_tableauhyperapi.bzl": update_tableauhyperapi_hashes,
    "datasets.bzl": update_dashql_datasets,
    "playwright.bzl": update_playwright,
    **{name: update_prebuilt_archives for name in _PREBUILT_ARCHIVES},
}


def main() -> None:
    if len(sys.argv) != 2 or Path(sys.argv[1]).name not in _HANDLERS:
        print("Usage: update_bazel_hashes.py <path/to/file.bzl>", file=sys.stderr)
        print("Known files:", ", ".join(_HANDLERS), file=sys.stderr)
        sys.exit(1)
    filepath = Path(sys.argv[1])
    _HANDLERS[filepath.name](filepath)


if __name__ == "__main__":
    main()

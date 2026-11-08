"""Repository rule: download prebuilt Binaryen for x86_64-linux and arm64-macos.

Both platform archives are fetched unconditionally.  A sh_binary wrapper selects
the right binary at runtime via RUNFILES_DIR so the same target works on Linux CI
and macOS developer/CI machines without re-fetching.

This is necessary to keep the wasm-opt output cacheable across MacOS and Linux
"""

# Binaryen releases: https://github.com/WebAssembly/binaryen/releases
_BINARYEN_VERSION = "133"
_BASE_URL = "https://github.com/WebAssembly/binaryen/releases/download/version_" + _BINARYEN_VERSION

# Without a hash Bazel can't serve the archive from its repository cache. Recomputed by
# scripts/update_bazel_hashes.py on a version bump.
_SHA256 = {
    "x86_64-linux": "2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489",
    "arm64-macos": "ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8",
}

def _binaryen_prebuilt_repository_impl(repository_ctx):
    strip_prefix = "binaryen-version_{}".format(_BINARYEN_VERSION)

    repository_ctx.download_and_extract(
        url = _BASE_URL + "/binaryen-version_{}-x86_64-linux.tar.gz".format(_BINARYEN_VERSION),
        sha256 = _SHA256["x86_64-linux"],
        output = "linux",
        stripPrefix = strip_prefix,
    )
    repository_ctx.download_and_extract(
        url = _BASE_URL + "/binaryen-version_{}-arm64-macos.tar.gz".format(_BINARYEN_VERSION),
        sha256 = _SHA256["arm64-macos"],
        output = "macos",
        stripPrefix = strip_prefix,
    )

    # Embed the canonical repo name so RUNFILES_DIR/<name>/linux|macos/bin/wasm-opt resolves.
    # repository_ctx.name returns the canonical bzlmod name (e.g. dashql+ext~binaryen).
    canon = repository_ctx.name
    wrapper = """#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${{RUNFILES_DIR:-}}" ]]; then
    _RF="$RUNFILES_DIR"
elif [[ -d "${{BASH_SOURCE[0]}}.runfiles" ]]; then
    _RF="${{BASH_SOURCE[0]}}.runfiles"
else
    echo "wasm-opt wrapper: cannot locate runfiles" >&2
    exit 1
fi
case "$(uname -s)" in
    Darwin) exec "$_RF/{canon}/macos/bin/wasm-opt" "$@" ;;
    Linux)  exec "$_RF/{canon}/linux/bin/wasm-opt" "$@" ;;
    *)      echo "wasm-opt: unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
""".format(canon = canon)

    repository_ctx.file("wasm_opt.sh", content = wrapper, executable = True)

    repository_ctx.file("BUILD.bazel", content = """
load("@rules_shell//shell:sh_binary.bzl", "sh_binary")

package(default_visibility = ["//visibility:public"])

sh_binary(
    name = "wasm_opt",
    srcs = ["wasm_opt.sh"],
    data = [
        "linux/bin/wasm-opt",
        "macos/bin/wasm-opt",
    ],
)
""")

binaryen_prebuilt_repository = repository_rule(
    implementation = _binaryen_prebuilt_repository_impl,
    doc = "Downloads prebuilt Binaryen (wasm-opt) for x86_64-linux and arm64-macos; selects at runtime via wrapper.",
)

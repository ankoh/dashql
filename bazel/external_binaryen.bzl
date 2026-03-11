"""Repository rule: download prebuilt Binaryen for the host (wasm-opt, no build from source)."""

# Binaryen releases: https://github.com/WebAssembly/binaryen/releases
# Match versions used in scripts/install_infra.sh
_BINARYEN_VERSION = "124"
_BASE_URL = "https://github.com/WebAssembly/binaryen/releases/download/version_" + _BINARYEN_VERSION

# (os_key, arch) -> tarball suffix (without .tar.gz)
# Binaryen uses: x86_64-linux, x86_64-macos, arm64-macos, aarch64-linux, etc.
_PLATFORM_SUFFIX = {
    ("darwin", "aarch64"): "arm64-macos",
    ("darwin", "x86_64"): "x86_64-macos",
    ("linux", "aarch64"): "arm64-linux",
    ("linux", "x86_64"): "x86_64-linux",
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _normalize_arch(arch):
    return _ARCH_ALIASES.get(arch, arch)

def _binaryen_prebuilt_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    arch = _normalize_arch(repository_ctx.os.arch)
    if os_name == "mac os x":
        os_key = "darwin"
    elif os_name == "linux":
        os_key = "linux"
    else:
        fail("Prebuilt Binaryen not available for os: " + os_name)
    suffix = _PLATFORM_SUFFIX.get((os_key, arch))
    if not suffix:
        fail("Prebuilt Binaryen not available for {}-{}".format(os_key, arch))
    filename = "binaryen-version_{}-{}.tar.gz".format(_BINARYEN_VERSION, suffix)
    strip_prefix = "binaryen-version_{}".format(_BINARYEN_VERSION)
    url = _BASE_URL + "/" + filename
    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = strip_prefix,
    )
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["bin/wasm-opt"])
alias(name = "wasm_opt", actual = "bin/wasm-opt", visibility = ["//visibility:public"])
""")

binaryen_prebuilt_repository = repository_rule(
    implementation = _binaryen_prebuilt_repository_impl,
    doc = "Downloads prebuilt Binaryen for the host (wasm-opt only; no build from source).",
)

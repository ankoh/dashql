"""Repository rule: download prebuilt GNU M4 (xPack) for the host platform (needed by bison)."""

_XPACK_VERSION = "1.4.20-1"
_BASE_URL = "https://github.com/xpack-dev-tools/m4-xpack/releases/download/v" + _XPACK_VERSION

_PLATFORM_SUFFIX = {
    ("darwin", "aarch64"): "darwin-arm64",
    ("darwin", "x86_64"): "darwin-x64",
    ("linux", "aarch64"): "linux-arm64",
    ("linux", "x86_64"): "linux-x64",
}

# Without a hash Bazel can't serve the archive from its repository cache. Recomputed by
# scripts/update_bazel_hashes.py on a version bump.
_SHA256 = {
    "darwin-arm64": "eec5cca7634e7ea463f044fb3d233a472de62932f1889f12fd8ca06ba5b7609e",
    "darwin-x64": "1329aa4237a933fe7f63e0c5922ea271a79a7d56ab7e1424f77f949f838777b5",
    "linux-arm64": "bc5fa98051abab8a8410499d89065c3554be7c1ca0574e85367a14d0764cfdfb",
    "linux-x64": "f593eeefafc59f33c323ce350b50e91f7c58917abef3320c3b118facbf370725",
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _normalize_arch(arch):
    return _ARCH_ALIASES.get(arch, arch)

def _m4_prebuilt_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    arch = _normalize_arch(repository_ctx.os.arch)
    if os_name == "mac os x":
        os_key = "darwin"
    elif os_name == "linux":
        os_key = "linux"
    else:
        fail("Prebuilt M4 not available for os: " + os_name)
    suffix = _PLATFORM_SUFFIX.get((os_key, arch))
    if not suffix:
        fail("Prebuilt M4 not available for {}-{}".format(os_key, arch))
    filename = "xpack-m4-{}-{}.tar.gz".format(_XPACK_VERSION, suffix)
    strip_prefix = "xpack-m4-{}".format(_XPACK_VERSION)
    url = _BASE_URL + "/" + filename
    repository_ctx.download_and_extract(url = url, sha256 = _SHA256[suffix], stripPrefix = strip_prefix)
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["bin/m4"])
alias(name = "m4", actual = "bin/m4", visibility = ["//visibility:public"])
""")

m4_prebuilt_repository = repository_rule(
    implementation = _m4_prebuilt_repository_impl,
    doc = "Downloads prebuilt GNU M4 (xPack) for the host platform.",
)

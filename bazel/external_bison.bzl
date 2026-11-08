"""Repository rule: download prebuilt Bison (xPack 3.8.2-1) for the host platform."""

# xPack GNU bison prebuilt: https://github.com/xpack-dev-tools/bison-xpack/releases/tag/v3.8.2-1
_XPACK_VERSION = "3.8.2-1"
_BASE_URL = "https://github.com/xpack-dev-tools/bison-xpack/releases/download/v" + _XPACK_VERSION

_PLATFORM_SUFFIX = {
    ("darwin", "aarch64"): "darwin-arm64",
    ("darwin", "x86_64"): "darwin-x64",
    ("linux", "aarch64"): "linux-arm64",
    ("linux", "arm"): "linux-arm",
    ("linux", "x86_64"): "linux-x64",
}

# Without a hash Bazel can't serve the archive from its repository cache. Recomputed by
# scripts/update_bazel_hashes.py on a version bump.
_SHA256 = {
    "darwin-arm64": "e46dd1b8ae40125c7180470fccddde121ebf219e7cd27a3b7c118d2815247a3c",
    "darwin-x64": "d45064315fa2612817979399ac11532ffe68c4786fa664ed6655b233e8bc818b",
    "linux-arm64": "907ff696b73a01d1224ac193c9e1a966bf53336eb3e7bc7dee459ea9e086284f",
    "linux-arm": "b094cf6591d137ba5de81305f4e841c894ad5a2e2aa01447491e3bc82e1624c6",
    "linux-x64": "543bc8f31c05713c5506c1a7dfa4fe81e57dec3cc41c243a47a08e4defd6100d",
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _normalize_arch(arch):
    return _ARCH_ALIASES.get(arch, arch)

def _bison_prebuilt_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    arch = _normalize_arch(repository_ctx.os.arch)
    if os_name == "mac os x":
        os_key = "darwin"
    elif os_name == "linux":
        os_key = "linux"
    else:
        fail("Prebuilt Bison not available for os: " + os_name)
    suffix = _PLATFORM_SUFFIX.get((os_key, arch))
    if not suffix:
        fail("Prebuilt Bison not available for {}-{}".format(os_key, arch))
    filename = "xpack-bison-{}-{}.tar.gz".format(_XPACK_VERSION, suffix)
    strip_prefix = "xpack-bison-{}".format(_XPACK_VERSION)
    url = _BASE_URL + "/" + filename
    repository_ctx.download_and_extract(
        url = url,
        sha256 = _SHA256[suffix],
        stripPrefix = strip_prefix,
    )
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["bin/bison"])
alias(name = "bison", actual = "bin/bison", visibility = ["//visibility:public"])
""")

bison_prebuilt_repository = repository_rule(
    implementation = _bison_prebuilt_repository_impl,
    doc = "Downloads prebuilt Bison (xPack) for the host platform.",
)

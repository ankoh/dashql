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

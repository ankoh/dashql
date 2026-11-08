"""Repository rule for Playwright's pinned Chromium headless shell."""

_VERSION = "158.0.8127.18"
_BASE_URL = "https://cdn.playwright.dev/builds/cft/{}/".format(_VERSION)

_PLATFORMS = {
    ("darwin", "aarch64"): (
        "mac-arm64/chrome-headless-shell-mac-arm64.zip",
        "f34261d2aad94fb71b336597acabf20166ee5a2f14926c731f33d04c5da6cd3f",
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    ),
    ("darwin", "x86_64"): (
        "mac-x64/chrome-headless-shell-mac-x64.zip",
        "81d6496c4e9b7c6a9f8d9cb18beef47d7da8eb235d1d5089f7385d19c1e378be",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
    ),
    ("linux", "aarch64"): (
        "linux-arm64/chrome-headless-shell-linux-arm64.zip",
        "b136462898353d94c7fab50f9cdaa6d8f0d4c190153916936aa0a03353a26bf2",
        "chrome-headless-shell-linux-arm64/chrome-headless-shell",
    ),
    ("linux", "x86_64"): (
        "linux64/chrome-headless-shell-linux64.zip",
        "18352d22cb0cdf520cbff2ad8c41391f0e02a72886cb53b0fde4bdfc4bd075d6",
        "chrome-headless-shell-linux64/chrome-headless-shell",
    ),
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _playwright_chromium_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    os_key = "darwin" if os_name == "mac os x" else os_name
    arch = _ARCH_ALIASES.get(repository_ctx.os.arch, repository_ctx.os.arch)
    platform = _PLATFORMS.get((os_key, arch))
    if not platform:
        fail("Playwright Chromium is not available for {}-{}".format(os_key, arch))
    path, sha256, executable = platform
    repository_ctx.download_and_extract(
        url = _BASE_URL + path,
        sha256 = sha256,
    )
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["{executable}"])
alias(name = "chromium", actual = "{executable}")
filegroup(name = "runtime", srcs = glob(["chrome-headless-shell-*/**"]))
""".format(executable = executable))

playwright_chromium_repository = repository_rule(
    implementation = _playwright_chromium_repository_impl,
    doc = "Downloads the Playwright-compatible Chromium headless shell for the host platform.",
)

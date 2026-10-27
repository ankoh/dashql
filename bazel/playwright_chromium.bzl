"""Repository rule for Playwright's pinned Chromium headless shell."""

_VERSION = "156.0.8078.4"
_BASE_URL = "https://cdn.playwright.dev/builds/cft/{}/".format(_VERSION)

_PLATFORMS = {
    ("darwin", "aarch64"): (
        "mac-arm64/chrome-headless-shell-mac-arm64.zip",
        "94e4337b70cbc5638f0935fbc46b9f242bc7416f657e3fbe924baf348404b53d",
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    ),
    ("darwin", "x86_64"): (
        "mac-x64/chrome-headless-shell-mac-x64.zip",
        "8a9e4a32ba5b1a796f8b16d01896e355cf6662544d9743296394fd999d782331",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
    ),
    ("linux", "aarch64"): (
        "linux-arm64/chrome-headless-shell-linux-arm64.zip",
        "81ab9d4d3c301dc5fdfb6c541b9e6632b16fc819a6a854460f40a76fe2b2c476",
        "chrome-headless-shell-linux-arm64/chrome-headless-shell",
    ),
    ("linux", "x86_64"): (
        "linux64/chrome-headless-shell-linux64.zip",
        "c3e50596aef52c58f8fda3c6b3411c33d34c88b177b3ed1c2243359fd3b8ba20",
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

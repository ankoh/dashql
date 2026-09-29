"""Repository rule for Playwright's pinned Chromium headless shell."""

_VERSION = "153.0.8010.12"
_BASE_URL = "https://cdn.playwright.dev/builds/cft/{}/".format(_VERSION)

_PLATFORMS = {
    ("darwin", "aarch64"): (
        "mac-arm64/chrome-headless-shell-mac-arm64.zip",
        "89d80a6d26ccd0ccfd51e22d9e1297283862af2b0cd91dce07459b35ca0059f2",
        "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    ),
    ("darwin", "x86_64"): (
        "mac-x64/chrome-headless-shell-mac-x64.zip",
        "5c2eaa1aad62111bb5a70dd0889dd3093f3142277b8f78957a238257ee85f009",
        "chrome-headless-shell-mac-x64/chrome-headless-shell",
    ),
    ("linux", "aarch64"): (
        "linux-arm64/chrome-headless-shell-linux-arm64.zip",
        "d433c45172c7836e38124fe545f767b02210bfb43a6262f08a297473a8e91c99",
        "chrome-headless-shell-linux-arm64/chrome-headless-shell",
    ),
    ("linux", "x86_64"): (
        "linux64/chrome-headless-shell-linux64.zip",
        "a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d",
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

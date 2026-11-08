"""Repository rule for Playwright's pinned Firefox build."""

_REVISION = "1572"

# Mirrors in the order Playwright's own installer tries them. The first one
# redirects to playwright.download.prss.microsoft.com, which does not always
# resolve, so fall back to the storage bucket behind cdn.playwright.dev.
_MIRRORS = [
    "https://cdn.playwright.dev/dbazure/download/playwright",
    "https://playwright.download.prss.microsoft.com/dbazure/download/playwright",
    "https://cdn.playwright.dev",
]

_PLATFORMS = {
    ("darwin", "aarch64"): (
        "firefox-mac-arm64.zip",
        "9691b4a07405d8faf8a44f6378d66db480d36159d9e9c4ed1d6066687697e1f2",
        "firefox/Nightly.app/Contents/MacOS/firefox",
    ),
    ("darwin", "x86_64"): (
        "firefox-mac.zip",
        "f31ac41e6450c5c9040fc7290f3da8a6a5f5672b0075f18b37cbd28fbf95ad36",
        "firefox/Nightly.app/Contents/MacOS/firefox",
    ),
    ("linux", "aarch64"): (
        "firefox-ubuntu-24.04-arm64.zip",
        "0c60e94f3095eb5503dda490ab0ae5d338783a94511ed6fb410c2d7fdcbe29f9",
        "firefox/firefox",
    ),
    ("linux", "x86_64"): (
        "firefox-ubuntu-24.04.zip",
        "189ce3e09c61776010ab8a7cbffaa016b8b1914d3c9b50cb5ab6d0c5db4c368f",
        "firefox/firefox",
    ),
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _playwright_firefox_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    os_key = "darwin" if os_name == "mac os x" else os_name
    arch = _ARCH_ALIASES.get(repository_ctx.os.arch, repository_ctx.os.arch)
    platform = _PLATFORMS.get((os_key, arch))
    if not platform:
        fail("Playwright Firefox is not available for {}-{}".format(os_key, arch))
    archive, sha256, executable = platform
    repository_ctx.download_and_extract(
        url = ["{}/builds/firefox/{}/{}".format(mirror, _REVISION, archive) for mirror in _MIRRORS],
        sha256 = sha256,
    )
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["{executable}"])
alias(name = "firefox", actual = "{executable}")
filegroup(name = "firefox_files", srcs = glob(["firefox/**"]))
alias(name = "runtime", actual = ":firefox_files")
""".format(executable = executable))

playwright_firefox_repository = repository_rule(
    implementation = _playwright_firefox_repository_impl,
    doc = "Downloads the Playwright-compatible Firefox build for the host platform.",
)

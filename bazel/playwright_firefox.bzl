"""Repository rule for Playwright's pinned Firefox build."""

_REVISION = "1555"

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
        "72eb32289f368789786d16d252e8e4fef7b62ae721d57f82d3d6d9221d3fd2af",
        "firefox/Nightly.app/Contents/MacOS/firefox",
    ),
    ("darwin", "x86_64"): (
        "firefox-mac.zip",
        "ae2c6e477d4c5f59e76be39ca0db6c003e9bcf9bb9b3c4e13cf545275d6be388",
        "firefox/Nightly.app/Contents/MacOS/firefox",
    ),
    ("linux", "aarch64"): (
        "firefox-ubuntu-24.04-arm64.zip",
        "fe2e1fd49048866e9b9249d1b9394b4989f58f589a35b19edcbce8aab1501f8c",
        "firefox/firefox",
    ),
    ("linux", "x86_64"): (
        "firefox-ubuntu-24.04.zip",
        "564f74fa3c46cb83c6252145cf1569c95236c8c404d6a5a80cc736cf32265f0c",
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

"""Repository rule for the browsers of Playwright that the browser tests run: Chromium headless shell and Firefox."""

_CHROMIUM_VERSION = "158.0.8127.18"
_FIREFOX_REVISION = "1572"

# Mirrors of Firefox in the order Playwright's own installer tries them. The first one
# redirects to playwright.download.prss.microsoft.com, which does not always
# resolve, so fall back to the storage bucket behind cdn.playwright.dev.
_FIREFOX_MIRRORS = [
    "https://cdn.playwright.dev/dbazure/download/playwright",
    "https://playwright.download.prss.microsoft.com/dbazure/download/playwright",
    "https://cdn.playwright.dev",
]

# The executable of Firefox in its archive per OS, the browser tests find it in //bazel:playwright_firefox
FIREFOX_EXECUTABLES = {
    "darwin": "firefox/Nightly.app/Contents/MacOS/firefox",
    "linux": "firefox/firefox",
}

# (archive, sha256, executable) per platform, the first folder of the executable holds the browser
_CHROMIUM_PLATFORMS = {
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

_FIREFOX_PLATFORMS = {
    ("darwin", "aarch64"): (
        "firefox-mac-arm64.zip",
        "9691b4a07405d8faf8a44f6378d66db480d36159d9e9c4ed1d6066687697e1f2",
        FIREFOX_EXECUTABLES["darwin"],
    ),
    ("darwin", "x86_64"): (
        "firefox-mac.zip",
        "f31ac41e6450c5c9040fc7290f3da8a6a5f5672b0075f18b37cbd28fbf95ad36",
        FIREFOX_EXECUTABLES["darwin"],
    ),
    ("linux", "aarch64"): (
        "firefox-ubuntu-24.04-arm64.zip",
        "0c60e94f3095eb5503dda490ab0ae5d338783a94511ed6fb410c2d7fdcbe29f9",
        FIREFOX_EXECUTABLES["linux"],
    ),
    ("linux", "x86_64"): (
        "firefox-ubuntu-24.04.zip",
        "189ce3e09c61776010ab8a7cbffaa016b8b1914d3c9b50cb5ab6d0c5db4c368f",
        FIREFOX_EXECUTABLES["linux"],
    ),
}

# The URLs of the archives of a browser, `{}` is the archive, and its platforms
_BROWSERS = {
    "chromium": (
        ["https://cdn.playwright.dev/builds/cft/" + _CHROMIUM_VERSION + "/{}"],
        _CHROMIUM_PLATFORMS,
    ),
    "firefox": (
        [mirror + "/builds/firefox/" + _FIREFOX_REVISION + "/{}" for mirror in _FIREFOX_MIRRORS],
        _FIREFOX_PLATFORMS,
    ),
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _playwright_repository_impl(repository_ctx):
    browser = repository_ctx.attr.browser
    urls, platforms = _BROWSERS[browser]
    os_name = repository_ctx.os.name
    os_key = "darwin" if os_name == "mac os x" else os_name
    arch = _ARCH_ALIASES.get(repository_ctx.os.arch, repository_ctx.os.arch)
    platform = platforms.get((os_key, arch))
    if not platform:
        fail("Playwright {} is not available for {}-{}".format(browser, os_key, arch))
    archive, sha256, executable = platform
    repository_ctx.download_and_extract(url = [url.format(archive) for url in urls], sha256 = sha256)
    # The browser tests run Chromium from here and Firefox from one folder of its runtime (//bazel:playwright_firefox)
    alias = 'alias(name = "chromium", actual = "{}")'.format(executable) if browser == "chromium" else ""
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["{executable}"])
{alias}
filegroup(name = "runtime", srcs = glob(["{folder}/**"]))
""".format(alias = alias, executable = executable, folder = executable.split("/")[0]))

playwright_repository = repository_rule(
    implementation = _playwright_repository_impl,
    attrs = {"browser": attr.string(mandatory = True, values = _BROWSERS.keys())},
    doc = "Downloads the Playwright-compatible build of a browser for the host platform: chromium or firefox.",
)

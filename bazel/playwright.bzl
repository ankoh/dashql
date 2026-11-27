"""Repository rule for the browsers of Playwright that the browser tests run: Chromium headless shell, Firefox and WebKit."""

_CHROMIUM_VERSION = "158.0.8127.18"
_FIREFOX_REVISION = "1572"
_WEBKIT_REVISION = "2388"

# Mirrors of Firefox and WebKit in the order Playwright's own installer tries them. The first one
# redirects to playwright.download.prss.microsoft.com, which does not always
# resolve, so fall back to the storage bucket behind cdn.playwright.dev.
_MIRRORS = [
    "https://cdn.playwright.dev/dbazure/download/playwright",
    "https://playwright.download.prss.microsoft.com/dbazure/download/playwright",
    "https://cdn.playwright.dev",
]

# The executable of Firefox in its archive per OS, the browser tests find it in //bazel:playwright_firefox
FIREFOX_EXECUTABLES = {
    "darwin": "firefox/Nightly.app/Contents/MacOS/firefox",
    "linux": "firefox/firefox",
}

# The launcher of WebKit, the same on every OS: it finds the MiniBrowser of Linux or the Playwright.app of macOS next to
# it. The archives have no folder of their own, the repository extracts them into webkit/.
WEBKIT_EXECUTABLE = "webkit/pw_run.sh"

# (archive, sha256, executable) per platform
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

# (archive, sha256) per platform
_FIREFOX_PLATFORMS = {
    ("darwin", "aarch64"): (
        "firefox-mac-arm64.zip",
        "9691b4a07405d8faf8a44f6378d66db480d36159d9e9c4ed1d6066687697e1f2",
    ),
    ("darwin", "x86_64"): (
        "firefox-mac.zip",
        "f31ac41e6450c5c9040fc7290f3da8a6a5f5672b0075f18b37cbd28fbf95ad36",
    ),
    ("linux", "aarch64"): (
        "firefox-ubuntu-24.04-arm64.zip",
        "0c60e94f3095eb5503dda490ab0ae5d338783a94511ed6fb410c2d7fdcbe29f9",
    ),
    ("linux", "x86_64"): (
        "firefox-ubuntu-24.04.zip",
        "189ce3e09c61776010ab8a7cbffaa016b8b1914d3c9b50cb5ab6d0c5db4c368f",
    ),
}

# WebKit is built per OS release and links the libraries of the system: the platforms of macOS carry its major version,
# darwin15 and darwin26, the builds of Linux are those of Ubuntu 26.04, the runners of CI
_WEBKIT_PLATFORMS = {
    ("darwin15", "aarch64"): (
        "webkit-mac-15-arm64.zip",
        "50b4238e145b8018e48aacefc15e9b3a43fafd18eee42ed4cb29a2e5c5a2e385",
    ),
    ("darwin15", "x86_64"): (
        "webkit-mac-15.zip",
        "c1220c739a2dbb6450059bfd678d5f5057e807d1d004464ef890ee1e6a9db727",
    ),
    ("darwin26", "aarch64"): (
        "webkit-mac-26-arm64.zip",
        "d3cc730027105a014d0cbf53925bd7eababbdf8dbccbb4a3a1713c5f631dbcaf",
    ),
    ("darwin26", "x86_64"): (
        "webkit-mac-26.zip",
        "43603b6130fc1341e02b87dde0d635f02b6d2defb90bc4f4e4b4a2d101900872",
    ),
    ("linux", "aarch64"): (
        "webkit-ubuntu-26.04-arm64.zip",
        "bbc73143b364fd40773c633cab3a233afe694f88b377ff2d925c6ae6abcedac8",
    ),
    ("linux", "x86_64"): (
        "webkit-ubuntu-26.04.zip",
        "cb319df755931b7206411206e297105bf234939c3d7b9772c1156d993b8d0b1f",
    ),
}

# The URLs of the archives of a browser (`{}` is the archive), its platforms, and the folder of the repository that its
# archive is extracted into: the archives of Chromium and Firefox hold a folder of their own, those of WebKit don't
_BROWSERS = {
    "chromium": struct(
        urls = ["https://cdn.playwright.dev/builds/cft/" + _CHROMIUM_VERSION + "/{}"],
        platforms = _CHROMIUM_PLATFORMS,
        output = "",
    ),
    "firefox": struct(
        urls = [mirror + "/builds/firefox/" + _FIREFOX_REVISION + "/{}" for mirror in _MIRRORS],
        platforms = _FIREFOX_PLATFORMS,
        output = "",
    ),
    "webkit": struct(
        urls = [mirror + "/builds/webkit/" + _WEBKIT_REVISION + "/{}" for mirror in _MIRRORS],
        platforms = _WEBKIT_PLATFORMS,
        output = "webkit",
    ),
}

_ARCH_ALIASES = {
    "amd64": "x86_64",
    "arm64": "aarch64",
}

def _playwright_repository_impl(repository_ctx):
    browser = repository_ctx.attr.browser
    spec = _BROWSERS[browser]
    os_name = repository_ctx.os.name
    os_key = "darwin" if os_name == "mac os x" else os_name
    arch = _ARCH_ALIASES.get(repository_ctx.os.arch, repository_ctx.os.arch)
    if os_key == "darwin" and browser == "webkit":
        # The build of WebKit follows the major version of macOS, an update of macOS fetches it again
        repository_ctx.watch("/System/Library/CoreServices/SystemVersion.plist")
        version = repository_ctx.execute(["sw_vers", "-productVersion"]).stdout.strip()
        os_key += version.split(".")[0]
    platform = spec.platforms.get((os_key, arch))
    if not platform:
        fail("Playwright {} is not available for {}-{}".format(browser, os_key, arch))
    repository_ctx.download_and_extract(
        url = [url.format(platform[0]) for url in spec.urls],
        sha256 = platform[1],
        output = spec.output,
    )
    # The browser tests run Chromium from here, Firefox and WebKit from one folder of their runtime
    # (//bazel:playwright_firefox, //bazel:playwright_webkit). The runtime is the folder of the browser, the files of the
    # repository itself are at its top.
    alias = 'alias(name = "chromium", actual = "{}")'.format(platform[2]) if browser == "chromium" else ""
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
{alias}
filegroup(name = "runtime", srcs = glob(["*/**"]))
""".format(alias = alias))

playwright_repository = repository_rule(
    implementation = _playwright_repository_impl,
    attrs = {"browser": attr.string(mandatory = True, values = _BROWSERS.keys())},
    doc = "Downloads the Playwright-compatible build of a browser for the host platform: chromium, firefox or webkit.",
)

"""The browser tests: a driver of Playwright that runs a bundle in Chromium, Firefox or WebKit."""

load("@aspect_rules_js//js:defs.bzl", "js_test")
load(":playwright.bzl", "FIREFOX_EXECUTABLES", "WEBKIT_EXECUTABLE")

_FIREFOX = "//bazel:playwright_firefox"
_WEBKIT = "//bazel:playwright_webkit"

# The files of a browser, the path of its executable per OS and the variables that it needs
_BROWSERS = {
    "chromium": struct(
        files = ["@playwright_chromium//:chromium", "@playwright_chromium//:runtime"],
        executable = {"//conditions:default": "$(rootpath @playwright_chromium//:chromium)"},
        env = {},
    ),
    "firefox": struct(
        files = [_FIREFOX],
        executable = {
            "@platforms//os:macos": "$(rootpath {})/{}".format(_FIREFOX, FIREFOX_EXECUTABLES["darwin"]),
            "//conditions:default": "$(rootpath {})/{}".format(_FIREFOX, FIREFOX_EXECUTABLES["linux"]),
        },
        env = {"MOZ_DISABLE_CONTENT_SANDBOX": "1"},
    ),
    "webkit": struct(
        files = [_WEBKIT],
        executable = {"//conditions:default": "$(rootpath {})/{}".format(_WEBKIT, WEBKIT_EXECUTABLE)},
        env = {},
    ),
}

def browser_test(name, browser, bundle, entry_point, env = {}, data = [], tags = []):
    """A test that runs the driver entry_point on the bundle in a browser.

    The driver reads the browser from DASHQL_BROWSER and its executable from DASHQL_BROWSER_EXECUTABLE.

    Args:
        name: The name of the test
        browser: chromium, firefox or webkit
        bundle: The bundle that the driver serves, its first argument
        entry_point: The driver
        env: More variables of the test
        data: More files of the driver
        tags: The tags of the test, the browser is one too (`--test_tag_filters=-webkit`)
    """
    spec = _BROWSERS[browser]
    test_env = {"DASHQL_BROWSER": browser}
    test_env.update(spec.env)
    test_env.update(env)
    js_test(
        name = name,
        size = "large",
        args = ["$(rootpath {})".format(bundle)],
        data = [bundle, "//:node_modules/playwright-core"] + data + spec.files,
        entry_point = entry_point,
        env = select({
            condition: dict(test_env, DASHQL_BROWSER_EXECUTABLE = executable)
            for condition, executable in spec.executable.items()
        }),
        no_copy_to_bin = spec.files,
        tags = tags + [browser],
        visibility = ["//visibility:public"],
    )

"""The browser tests: a driver of Playwright that runs a bundle in Chromium or Firefox."""

load("@aspect_rules_js//js:defs.bzl", "js_test")

def browser_test(name, browser, executable, bundle, entry_point, runtime = None, executable_root = False, env = {}, data = [], tags = []):
    """A test that runs the driver entry_point on the bundle in a browser.

    Args:
        name: The name of the test
        browser: chromium or firefox, the driver reads it from DASHQL_BROWSER
        executable: The executable of the browser, or the folder that holds it with executable_root
        bundle: The bundle that the driver serves, its first argument
        entry_point: The driver
        runtime: The files that the executable needs
        executable_root: Is executable a folder that holds the browser?
        env: More variables of the test
        data: More files of the driver
        tags: The tags of the test
    """
    browser_data = [executable]
    if runtime and runtime != executable:
        browser_data.append(runtime)
    test_env = {"DASHQL_BROWSER": browser}
    test_env.update(env)
    test_env["DASHQL_BROWSER_EXECUTABLE_ROOT" if executable_root else "DASHQL_BROWSER_EXECUTABLE"] = "$(rootpath {})".format(executable)
    js_test(
        name = name,
        size = "large",
        args = ["$(rootpath {})".format(bundle)],
        data = [bundle, "//:node_modules/playwright-core"] + data + browser_data,
        entry_point = entry_point,
        env = test_env,
        no_copy_to_bin = browser_data,
        tags = tags,
        visibility = ["//visibility:public"],
    )

"""ESLint of the TypeScript and JavaScript sources of a package, see docs/agents/build_bazel_targets.md.

The rules are in the root `eslint.config.mjs`. Every package with TypeScript or JavaScript has an `eslint_test`, a
finding of any rule fails it, warnings included.
"""

load("@npm//:eslint/package_json.bzl", eslint_bin = "bin")

ESLINT_SOURCES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts", "**/*.js", "**/*.mjs", "**/*.cjs"]

def eslint_test(name = "eslint_test", srcs = None, **kwargs):
    """A test that passes when ESLint finds nothing in the sources of the package

    Args:
        name: The name of the test
        srcs: The files to lint, by default every TypeScript and JavaScript file of the package
        **kwargs: Passed to the test
    """
    if srcs == None:
        srcs = native.glob(
            ESLINT_SOURCES,
            exclude = ["node_modules/**", "dist/**", ".astro/**"],
            allow_empty = True,
        )
        if not srcs:
            fail("eslint_test found no sources in " + native.package_name())
    eslint_bin.eslint_test(
        name = name,
        size = kwargs.pop("size", "small"),
        args = ["--max-warnings=0", native.package_name()],
        data = srcs + ["//:eslint_config"],
        # The sources stay sources in the runfiles, a copy into the output tree would conflict with the copies that
        # other rules of the package make of them
        copy_data_to_bin = False,
        **kwargs
    )

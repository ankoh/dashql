"""The manifest of a package on npm, see npm_manifest.mjs."""

def npm_manifest(name, **kwargs):
    """Writes npm_files/package.json: npm/package.json with the version of the build and the exports of package.json

    Args:
        name: The name of the target
        **kwargs: Passed to the genrule
    """
    native.genrule(
        name = name,
        srcs = [
            "npm/package.json",
            "package.json",
            "@dashql_app_version//:version.env",
        ],
        outs = ["npm_files/package.json"],
        # The paths are those of the execution root, the writer stays there
        cmd = """
            BAZEL_BINDIR=$(BINDIR) JS_BINARY__NO_CD_BINDIR=1 $(execpath //bazel:npm_manifest) \\
                $(execpath npm/package.json) $(execpath package.json) $(execpath @dashql_app_version//:version.env) $@
        """,
        tools = ["//bazel:npm_manifest"],
        **kwargs
    )

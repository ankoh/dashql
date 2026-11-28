"""The manifest of a package on npm, see npm_manifest.mjs."""

def npm_manifest(name, modules, **kwargs):
    """Writes npm_files/package.json: npm/package.json with the version of the build and the modules that package.json exports

    Args:
        name: The name of the target
        modules: The modules of src/ that the package on npm compiles
        **kwargs: Passed to the genrule
    """
    native.genrule(
        name = name,
        srcs = [
            "npm/package.json",
            "package.json",
            "@dashql_app_version//:version.env",
        ] + modules,
        outs = ["npm_files/package.json"],
        # The paths are those of the execution root, the writer stays there
        cmd = """
            BAZEL_BINDIR=$(BINDIR) JS_BINARY__NO_CD_BINDIR=1 $(execpath //bazel:npm_manifest) \\
                $(execpath npm/package.json) $(execpath package.json) $(execpath @dashql_app_version//:version.env) $@ \\
                {modules}
        """.format(modules = " ".join(["$(execpath {})".format(m) for m in modules])),
        tools = ["//bazel:npm_manifest"],
        **kwargs
    )

"""JSON Schema to TypeScript codegen using json-schema-to-typescript."""

def jsonschema_typescript(name, srcs, **kwargs):
    """
    Compiles JSON Schema files to TypeScript type definitions.

    Args:
        name: Target name
        srcs: JSON Schema source files
        **kwargs: Additional arguments passed to genrule
    """

    # Create a separate target for each schema file
    all_targets = []
    for src in srcs:
        # Get basename without extension
        basename = src.split("/")[-1].replace(".json", "")
        target_name = "%s_%s" % (name, basename)
        out_file = basename + ".ts"

        # Use genrule with BAZEL_BINDIR set for js_binary
        # Pass all source files so $refs can be resolved
        native.genrule(
            name = target_name,
            srcs = srcs,
            outs = [out_file],
            cmd = "BAZEL_BINDIR=. $(location //bazel/jsonschema:compile_schema) $(location %s) > $@" % src,
            tools = ["//bazel/jsonschema:compile_schema"],
            **kwargs
        )
        all_targets.append(":" + target_name)

    # Create a filegroup that includes all generated TypeScript files
    native.filegroup(
        name = name,
        srcs = all_targets,
    )

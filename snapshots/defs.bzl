"""Macros for snapshot subfolder BUILD files."""

def snapshot_library(filter, glob_pattern = "*.yaml"):
    """Defines :files (filegroup) and :update (run snapshotter for this category).

    Args:
        filter: Snapshot category passed to snapshotter --filter (e.g. "parser").
        glob_pattern: Glob for the generated YAML files (default "*.yaml").
    """
    native.filegroup(
        name = "files",
        srcs = native.glob([glob_pattern]),
        visibility = ["//visibility:public"],
    )
    native.sh_binary(
        name = "update",
        srcs = ["//snapshots:run_snapshotter.sh"],
        args = [
            "$(rootpath //packages/dashql-core:snapshotter)",
            filter,
        ],
        data = ["//packages/dashql-core:snapshotter"],
    )

"""Macros for snapshot subfolder BUILD files."""

load("@rules_shell//shell:sh_binary.bzl", "sh_binary")

def snapshot_library(filter):
    """Defines :files (the snapshot files of the category) and :update.

    Args:
        filter: Snapshot category passed to snapshotter --filter (e.g. "parser").
    """
    native.filegroup(
        name = "files",
        srcs = native.glob(["*.yaml"]),
        visibility = ["//visibility:public"],
    )
    snapshot_update(filter)

def snapshot_update(filter):
    """Defines :update, which runs the snapshotter for a category, or for all with an empty filter.

    Args:
        filter: Snapshot category passed to snapshotter --filter (e.g. "parser"), empty for all.
    """

    # The snapshotter uses the snapshot encoders of the (testonly) test library
    sh_binary(
        name = "update",
        testonly = True,
        srcs = ["//tests/snapshots:run_snapshotter.sh"],
        args = [
            "$(rootpath //tests/snapshots:snapshotter)",
            filter,
        ],
        data = ["//tests/snapshots:snapshotter"],
    )

"""rustfmt for the Rust code of the repo, see docs/agents/build_bazel_targets.md.

`rustfmt_test` checks the Rust files of a package, `bazel run //bazel:rustfmt` formats the Rust files of the repo. Both
run the rustfmt of the Rust toolchain of rules_rust with the `rustfmt.toml` of the repo. The test and the rules_rust
`rustfmt_test` differ: that one runs a runner of rules_rust whose transition registers the host platform a second time,
which crashes Bazel 9 next to the `register_execution_platforms` of MODULE.bazel.
"""

load("@rules_shell//shell:sh_test.bzl", "sh_test")

def rustfmt_test(name, srcs, **kwargs):
    """A test that passes when rustfmt leaves the Rust files unchanged

    Args:
        name: The name of the test
        srcs: The Rust files to check, the checked-in ones only: a generated file is not formatted
        **kwargs: Passed to the test
    """
    sh_test(
        name = name,
        size = "small",
        srcs = ["//bazel:rustfmt_test.sh"],
        args = [
            "$(rootpath @rules_rust//rust/toolchain:current_rustfmt_toolchain)",
            "$(rootpath //:rustfmt.toml)",
        ] + ["$(rootpath %s)" % src for src in srcs],
        data = [
            "//:rustfmt.toml",
            "@rules_rust//rust/toolchain:current_rustfmt_toolchain",
        ] + srcs,
        **kwargs
    )

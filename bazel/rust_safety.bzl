"""Clippy with the safety rules of the Rust crates of the core module, see docs/agents/build_bazel_targets.md.

The crates set `lint_config = "//bazel:rust_safety_lints"`: no unwrap, expect, panic, unreachable, todo or
unimplemented, no index or slice that can fail and no `RefCell` borrow held across an await, outside of tests. A panic
traps the whole module of the core. Clippy reports the other lints as warnings, only these fail, unless a crate denies
its warnings itself.
"""

load("@rules_rust//rust:defs.bzl", "rust_clippy")
load("@rules_shell//shell:sh_test.bzl", "sh_test")

def rust_safety_test(name, deps, **kwargs):
    """A test that passes when clippy finds no breach of the safety lints in the crates

    Args:
        name: The name of the test, the clippy target is `<name>_clippy`
        deps: The Rust targets that clippy checks, with the `lint_config` of the safety lints
        **kwargs: Passed to the test
    """
    rust_clippy(
        name = name + "_clippy",
        testonly = True,
        deps = deps,
    )
    sh_test(
        name = name,
        size = "small",
        srcs = ["//bazel:clippy_test.sh"],
        # Out of `bazel coverage`, see the `coverage --test_tag_filters` of .bazelrc
        tags = kwargs.pop("tags", []) + ["lint"],
        args = ["$(rootpaths :" + name + "_clippy)"],
        data = [":" + name + "_clippy"],
        **kwargs
    )

"""The core module of DashQL assembled from features, see docs/design/dashql_core.md.

The language, the workbooks and their execution are always in a module. The services that share the state of the scripts
are features of the bindings crate (`#[cfg(feature = "...")]`), a module that leaves one out leaves its classes, views,
actions and commands out too. A product builds the module it needs:

    load("//packages/dashql-core-wasm:module.bzl", "dashql_core_module")

    dashql_core_module(
        name = "studio_core",
        features = ["storage"],
    )

`<name>_bindgen` is the wasm-bindgen output (the glue and its declarations), `<name>` the Wasm, optimized in a release
build. The TypeScript bindings (`@akohn/dashql`) take the glue of any module: the classes of a feature are optional
there (`DashQL.bindings`).
"""

load("@rules_rust//rust:defs.bzl", "rust_library", "rust_shared_library")
load("@rules_rust_wasm_bindgen//:defs.bzl", "rust_wasm_bindgen")
load("//bazel:rust_safety.bzl", "rust_safety_test")
load("//bazel:wasm_tools.bzl", "optimize_wasm", "wasm_bindgen_module")

# What every module has: the language, the scripts, the profile and the runtime
DASHQL_CORE_BASE_DEPS = [
    "//packages/dashql-core:dashql_core",
    "//packages/dashql-core-script:dashql_core_script",
    "//packages/dashql-core-profile:dashql_core_profile",
    "//packages/dashql-core-runtime:dashql_core_runtime",
    "//packages/dashql-core-storage:dashql_core_storage",
    "//packages/dashql-parser:dashql_parser",
    "//proto/fb:dashql_buffers_rs",
    "@core_crates//:flatbuffers",
    "@core_crates//:js-sys",
    "@core_crates//:serde",
    "@core_crates//:serde-wasm-bindgen",
    "@core_crates//:serde_bytes",
    "@core_crates//:serde_json",
    "@core_crates//:tsify",
    "@core_crates//:wasm-bindgen",
    "@core_crates//:wasm-bindgen-futures",
]

# The features of a module and the crates that each adds
DASHQL_CORE_FEATURES = {
    # The shell of Hyper: prompt, VT100 renderer and the effects of its queries on a catalog of the module
    "shell": ["//packages/dashql-core-shell:dashql_core_shell"],
}

# The module of the DashQL app, the command line tool and @akohn/dashql on npm
DASHQL_FULL_FEATURES = ["shell"]

# The module with no feature, built and linted so that every feature can be left out
DASHQL_MINIMAL_FEATURES = []

DASHQL_CORE_PROC_MACRO_DEPS = ["@core_crates//:serde_repr"]

_SRCS = "//packages/dashql-core-wasm:srcs"
_CRATE_ROOT = "//packages/dashql-core-wasm:src/lib.rs"

def dashql_core_deps(features):
    """The crates of a module with features"""
    deps = list(DASHQL_CORE_BASE_DEPS)
    for feature in features:
        if feature not in DASHQL_CORE_FEATURES:
            fail("unknown feature of the core module: %s, known: %s" % (feature, ", ".join(DASHQL_CORE_FEATURES.keys())))
        deps += DASHQL_CORE_FEATURES[feature]
    return deps

def dashql_core_module(name, features, visibility = None):
    """The core module with features: `<name>_wasm` (the crate), `<name>_bindgen` (the glue), `<name>` (the Wasm)"""
    rust_shared_library(
        name = name + "_wasm",
        srcs = [_SRCS],
        # The crate names the file of the Wasm, so modules side by side in a package don't collide
        crate_name = name.replace("-", "_") + "_wasm",
        crate_root = _CRATE_ROOT,
        crate_features = features,
        edition = "2021",
        lint_config = "//bazel:rust_safety_lints",
        target_compatible_with = ["@platforms//cpu:wasm32"],
        deps = dashql_core_deps(features),
        proc_macro_deps = DASHQL_CORE_PROC_MACRO_DEPS,
    )
    rust_wasm_bindgen(
        name = name + "_bindgen",
        out_name = "dashql_core",
        target = "web",
        visibility = visibility,
        wasm_file = ":" + name + "_wasm",
    )
    wasm_bindgen_module(
        name = name + "_bindgen_wasm",
        bindgen = ":" + name + "_bindgen",
    )
    optimize_wasm(
        name = name,
        src = ":" + name + "_bindgen_wasm",
        out = name + "/dashql_core_bg.wasm",
        visibility = visibility,
    )

def dashql_core_lint(name, features):
    """Clippy with the safety lints on the bindings with features, on the host"""
    rust_library(
        name = name + "_lib",
        srcs = [_SRCS],
        crate_name = "dashql_core_wasm",
        crate_root = _CRATE_ROOT,
        crate_features = features,
        edition = "2021",
        lint_config = "//bazel:rust_safety_lints",
        tags = ["manual"],
        deps = dashql_core_deps(features),
        proc_macro_deps = DASHQL_CORE_PROC_MACRO_DEPS,
    )
    rust_safety_test(
        name = name,
        deps = [":" + name + "_lib"],
    )

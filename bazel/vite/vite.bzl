"""Vite build and Vitest test macro, aligned with bazel/vite pattern from bazel-monorepo.

Loads vite and vitest from the root npm repo (both in root package.json devDependencies).
"""
load("@npm//:vite/package_json.bzl", vite_bin = "bin")
load("@npm//:vitest/package_json.bzl", vitest_bin = "bin")

# Use the full node_modules tree so all packages (including scoped ones like @primer/react) are in runfiles.
# Listing individual packages (e.g. npm_label + "/" + pkg) fails when npm_link_all_packages does not
# declare a target for that path (e.g. //:node_modules/@primer/react).

def vite(tests = [], assets = [], deps = [], overlay = None, build_modes = None, protobuf_module = None, npm = None, **kwargs):
    """Macro that creates Vite build target(s) and a Vitest test target.

    When overlay is None, a single "vite" build target is created.
    When overlay is set and build_modes is set (e.g. ["reloc", "pages"]), creates one
    build target per mode (vite_reloc, vite_pages) using vite_bin.vite() so node_modules
    is in the action runfiles and "react/jsx-runtime" resolves. Env DASHQL_NODE_PATH_OVERLAY
    is set so vite.config.ts can alias @ankoh/* from the overlay.
    When overlay is set and build_modes is None, no build targets are created (caller uses
    js_run_binary + launcher for build).

    Args:
        tests: Test file labels (e.g. glob of *.spec.tsx).
        assets: Source/assets (e.g. copy_to_bin of src, vite.config.ts).
        deps: Extra deps (package.json, tsconfig, overlay, etc.).
        overlay: Optional overlay label (e.g. ":ankoh_overlay"); required for build_modes.
        build_modes: Optional list of modes (e.g. ["reloc", "pages"]); when set with overlay, creates vite_<mode> targets.
        protobuf_module: Optional label to the protobuf entry file (e.g. //packages/dashql-protobuf:dist/dashql-proto.module.js); sets DASHQL_PROTOBUF_MODULE.
        npm: Optional node_modules label (e.g. "//:node_modules") when the package has no local node_modules; BUILD_DEPS and NODE_PATH use this.
        **kwargs: Unused.
    """
    npm_label = npm or ":node_modules"
    BUILD_DEPS = [npm_label]

    # Fix for jsdom: required as dynamic import from sub-deps; root node_modules in data when using package-local node_modules.
    ROOT_NPM_FIX = [] if npm else ["//:node_modules"]

    all_deps = BUILD_DEPS + assets + deps

    if overlay == None:
        vite_bin.vite(
            name = "vite",
            srcs = all_deps,
            args = ["build", "--config", "vite.config.ts"],
            chdir = native.package_name(),
            out_dirs = ["dist"],
            visibility = ["//visibility:public"],
        )
    elif build_modes:
        # Create one build target per mode so resolution uses rule runfiles (like bazel-monorepo).
        build_deps = all_deps + ROOT_NPM_FIX
        overlay_env = {
            "DASHQL_NODE_PATH_OVERLAY": "$(rootpath " + overlay + ")",
            "NODE_PATH": "$(rootpath " + overlay + ")/node_modules",
            "RUNFILES_MAIN_REPO": "_main",
        }
        if protobuf_module:
            overlay_env["DASHQL_PROTOBUF_MODULE"] = "$(execpath " + protobuf_module + ")"
        for mode in build_modes:
            vite_bin.vite(
                name = "vite_" + mode,
                srcs = build_deps,
                args = ["build", "--config", "vite.config.ts", "--mode", mode],
                chdir = native.package_name(),
                out_dirs = ["dist"],
                env = overlay_env,
                tags = ["no-sandbox"],
                visibility = ["//visibility:public"],
            )

    vitest_bin.vitest_test(
        name = "vitest",
        args = [
            "run",
            "--config=vite.config.ts",
        ],
        tags = ["manual"],
        chdir = native.package_name(),
        data = all_deps + tests + ROOT_NPM_FIX,
    )

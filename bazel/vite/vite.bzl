"""Vite build and Vitest test macro, aligned with bazel/vite pattern from bazel-monorepo.

Loads vite and vitest from the root npm repo (both in root package.json devDependencies).
"""
load("@npm//:vite/package_json.bzl", vite_bin = "bin")
load("@npm//:vitest/package_json.bzl", vitest_bin = "bin")

# Use the full node_modules tree so all packages (including scoped ones like @primer/react) are in runfiles.
# Listing individual packages (e.g. npm_label + "/" + pkg) fails when npm_link_all_packages does not
# declare a target for that path (e.g. //:node_modules/@primer/react).

def _vite_build_impl(ctx):
    """Runs Vite build with VITE_OUT_DIR set to the declared output path so the action writes to an allowed directory (fixes EACCES without experimental_writable_outputs)."""
    dist_dir = ctx.actions.declare_directory("dist")
    ctx.actions.run_shell(
        outputs = [dist_dir],
        inputs = ctx.files.srcs + [ctx.file.launcher],
        command = (
            "export VITE_OUT_DIR=$PWD/" + dist_dir.path + " && " +
            "export DASHQL_VITE_PACKAGE_DIR=" + ctx.label.package + " && " +
            "export RUNFILES_MAIN_REPO=_main && " +
            "node " + ctx.file.launcher.path + " build --config vite.config.ts --mode " + ctx.attr.mode
        ),
        use_default_shell_env = True,
        mnemonic = "ViteBuild",
        progress_message = "Building Vite (%s)..." % ctx.attr.mode,
    )
    return [DefaultInfo(files = depset([dist_dir]))]

_vite_build = rule(
    implementation = _vite_build_impl,
    attrs = {
        "mode": attr.string(mandatory = True),
        "srcs": attr.label_list(allow_files = True, mandatory = True),
        "launcher": attr.label(allow_single_file = [".cjs"], default = "//packages/dashql-app:run_vite_build.cjs"),
    },
)

def vite(tests = [], assets = [], deps = [], overlay = None, build_modes = None, npm = None, build_launcher = None, **kwargs):
    """Macro that creates Vite build target(s) and a Vitest test target.

    When overlay is None, a single "vite" build target is created.
    When overlay and build_modes are set (e.g. ["reloc", "pages"]), creates one build
    target per mode (vite_reloc, vite_pages). Env DASHQL_NODE_PATH_OVERLAY is set so
    vite.config.ts can alias @ankoh/* from the overlay.

    Args:
        tests: Test file labels (e.g. glob of *.spec.tsx).
        assets: Source/assets (e.g. index.html, vite.config.ts, src, static).
        deps: Extra deps (e.g. overlay).
        overlay: Optional overlay label (e.g. ":ankoh_overlay"); required for build_modes.
        build_modes: Optional list of modes (e.g. ["reloc", "pages"]); creates vite_<mode> targets.
        npm: Optional node_modules label (e.g. "//:node_modules"); BUILD_DEPS and NODE_PATH use this.
        build_launcher: Optional launcher script for custom _vite_build rule (default: //packages/dashql-app:run_vite_build.cjs).
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
        # Custom rule with VITE_OUT_DIR so Vite writes to the declared output path (fixes EACCES without experimental_writable_outputs).
        build_deps = all_deps + ROOT_NPM_FIX
        launcher = build_launcher or "//packages/dashql-app:run_vite_build.cjs"
        for mode in build_modes:
            _vite_build(
                name = "vite_" + mode,
                mode = mode,
                srcs = build_deps,
                launcher = launcher,
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

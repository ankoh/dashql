"""Vite build and Vitest test macro (used by dashql-app).

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
    env = dict(ctx.attr.env)
    if ctx.attr.proto_gen:
        # Path to proto directory (tree artifact from copy_to_directory); @ankoh/dashql-protobuf aliases here.
        lbl = ctx.attr.proto_gen.label
        env["DASHQL_PROTOBUF_DIST"] = ctx.expand_location("$(location //" + lbl.package + ":" + lbl.name + ")")
    env_exports = " ".join(["export %s='%s'" % (k, v.replace("'", "'\"'\"'")) for k, v in env.items()])
    inputs = ctx.files.srcs + [ctx.file.launcher]
    if ctx.attr.proto_gen:
        inputs = inputs + ctx.files.proto_gen
    ctx.actions.run_shell(
        outputs = [dist_dir],
        inputs = inputs,
        command = (
            "export VITE_OUT_DIR=$PWD/" + dist_dir.path + " && " +
            "export DASHQL_VITE_PACKAGE_DIR=" + ctx.label.package + " && " +
            "export RUNFILES_MAIN_REPO=_main && " +
            (env_exports + " && " if env_exports else "") +
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
        "launcher": attr.label(allow_single_file = [".cjs"], default = "//bazel/vite:vite_sandboxed.cjs"),
        "env": attr.string_dict(default = {}, doc = "Extra env vars (e.g. DASHQL_CORE_DIST runfiles-relative paths)."),
        "proto_gen": attr.label(allow_files = True, default = None, doc = "Proto TS gen tree (e.g. //packages/dashql-app:gen); sets DASHQL_PROTO_GEN to its path."),
    },
)

# Runfiles-relative paths for direct @ankoh deps (no overlay). Must match output layout of each target.
_DASHQL_CORE_DIST_PATH = "packages/dashql-core-api/dist_opt"
_DASHQL_COMPUTE_DIST_PATH = "packages/dashql-compute/dist_opt_gen_opt"

def vite(tests = [], assets = [], deps = [], build_modes = None, npm = None, build_launcher = None, core_dist = None, compute_dist = None, proto_gen = None, **kwargs):
    """Macro that creates Vite build target(s) and a Vitest test target.

    When build_modes is None, a single "vite" build target is created.
    When build_modes is set, creates one build target per entry. Each entry is (mode, name): mode is
    passed to Vite as --mode; name is the Bazel target name (e.g. build_modes = [("reloc", "reloc"), ("pages", "pages")] gives //package:reloc and //package:pages).
    @ankoh/* are resolved via direct paths (core_dist, compute_dist); no overlay. Protobuf is in-app (//proto/pb:ts_gen).

    Args:
        tests: Test file labels (e.g. glob of *.spec.tsx).
        assets: Source/assets (e.g. index.html, vite.config.ts, src, static).
        deps: Extra deps.
        build_modes: Optional list of (mode, name) tuples; mode = Vite --mode, name = Bazel target (e.g. [("reloc", "reloc"), ("pages", "pages")]).
        npm: Optional node_modules label (e.g. "//:node_modules"); BUILD_DEPS and NODE_PATH use this.
        build_launcher: Optional launcher script for custom _vite_build rule (default: //bazel/vite:vite_sandboxed.cjs).
        core_dist: Optional label for @ankoh/dashql-core dist (e.g. //packages/dashql-core-api:dist_wasm_opt).
        compute_dist: Optional label for @ankoh/dashql-compute dist (e.g. //packages/dashql-compute:dist_opt).
    """
    npm_label = npm or ":node_modules"
    BUILD_DEPS = [npm_label]

    # Fix for jsdom: required as dynamic import from sub-deps; root node_modules in data when using package-local node_modules.
    ROOT_NPM_FIX = [] if npm else ["//:node_modules"]

    all_deps = BUILD_DEPS + assets + deps

    if build_modes == None:
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
        if core_dist:
            build_deps = build_deps + [core_dist]
        if compute_dist:
            build_deps = build_deps + [compute_dist]
        if proto_gen:
            build_deps = build_deps + [proto_gen]
        launcher = build_launcher or "//bazel/vite:vite_sandboxed.cjs"
        dashql_env = {}
        if core_dist:
            dashql_env["DASHQL_CORE_DIST"] = _DASHQL_CORE_DIST_PATH
        if compute_dist:
            dashql_env["DASHQL_COMPUTE_DIST"] = _DASHQL_COMPUTE_DIST_PATH
        for mode, name in build_modes:
            _vite_build(
                name = name,
                mode = mode,
                srcs = build_deps,
                launcher = launcher,
                env = dashql_env,
                proto_gen = proto_gen,
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

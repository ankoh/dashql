"""Vite build and Vitest test macro (used by dashql-app).

Loads vite and vitest from the root npm repo (both in root package.json devDependencies).
"""
load("@npm//:vite/package_json.bzl", vite_bin = "bin")
load("@npm//:vitest/package_json.bzl", vitest_bin = "bin")

# All npm deps live in root package.json; we use the root node_modules link tree so resolution is
# from a single place. Use the full tree (not individual packages) so scoped packages resolve.

def _vite_build_impl(ctx):
    """Runs Vite build with VITE_OUT_DIR set to the declared output path so the action writes to an allowed directory (fixes EACCES without experimental_writable_outputs)."""
    dist_dir = ctx.actions.declare_directory("dist")
    env = dict(ctx.attr.env)
    if ctx.attr.core_dist:
        env["DASHQL_CORE_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.core_dist.label) + ")", [ctx.attr.core_dist])
    if ctx.attr.core_wasm:
        env["DASHQL_CORE_WASM_PATH"] = ctx.expand_location("$(location " + str(ctx.attr.core_wasm.label) + ")", [ctx.attr.core_wasm])
    if ctx.attr.compute_dist:
        env["DASHQL_COMPUTE_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.compute_dist.label) + ")", [ctx.attr.compute_dist])
    if ctx.attr.proto_gen:
        env["DASHQL_PROTOBUF_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.proto_gen.label) + ")", [ctx.attr.proto_gen])
    if ctx.attr.zstd_wasm:
        env["DASHQL_ZSTD_WASM_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.zstd_wasm.label) + ")", [ctx.attr.zstd_wasm])
    env_exports = " ".join(["export %s='%s'" % (k, v.replace("'", "'\"'\"'")) for k, v in env.items()])
    inputs = ctx.files.srcs + [ctx.file.launcher]
    if ctx.attr.core_dist:
        inputs = inputs + ctx.files.core_dist
    if ctx.attr.core_wasm:
        inputs = inputs + ctx.files.core_wasm
    if ctx.attr.proto_gen:
        inputs = inputs + ctx.files.proto_gen
    if ctx.attr.zstd_wasm:
        inputs = inputs + ctx.files.zstd_wasm
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
        "env": attr.string_dict(default = {}, doc = "Extra env vars."),
        "core_dist": attr.label(allow_files = True, default = None, doc = "@ankoh/dashql-core JS bundle (e.g. //packages/dashql-core/api:bundle); sets DASHQL_CORE_DIST."),
        "core_wasm": attr.label(allow_single_file = [".wasm"], default = None, doc = "Core WASM file (e.g. //packages/dashql-core/api:core_wasm_opt); sets DASHQL_CORE_WASM_PATH."),
        "compute_dist": attr.label(allow_files = True, default = None, doc = "@ankoh/dashql-compute dist; sets DASHQL_COMPUTE_DIST to its path."),
        "proto_gen": attr.label(allow_files = True, default = None, doc = "Proto TS gen tree (e.g. //packages/dashql-app:proto); sets DASHQL_PROTO_GEN to its path."),
        "zstd_wasm": attr.label(allow_files = True, default = None, doc = "@bokuweb/zstd-wasm package dir (e.g. //:node_modules/@bokuweb/zstd-wasm); sets DASHQL_ZSTD_WASM_DIST."),
    },
)

def vite(tests = [], assets = [], deps = [], build_modes = None, npm = None, build_launcher = None, core_dist = None, core_wasm = None, compute_dist = None, proto_gen = None, zstd_wasm = None, **kwargs):
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
        npm: Node_modules label; default "//:node_modules" (root). All deps are in root, so resolution uses this tree.
        build_launcher: Optional launcher script for custom _vite_build rule (default: //bazel/vite:vite_sandboxed.cjs).
        core_dist: Optional label for @ankoh/dashql-core JS bundle (e.g. //packages/dashql-core/api:bundle).
        core_wasm: Optional label for core WASM file (e.g. //packages/dashql-core/api:core_wasm_opt).
        compute_dist: Optional label for @ankoh/dashql-compute dist (e.g. //packages/dashql-compute:dist_opt).
    """
    npm_label = npm or "//:node_modules"
    BUILD_DEPS = [npm_label]
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
        build_deps = list(all_deps)
        if core_dist:
            build_deps = build_deps + [core_dist]
        if core_wasm:
            build_deps = build_deps + [core_wasm]
        if compute_dist:
            build_deps = build_deps + [compute_dist]
        if proto_gen:
            build_deps = build_deps + [proto_gen]
        if zstd_wasm:
            build_deps = build_deps + [zstd_wasm]
        launcher = build_launcher or "//bazel/vite:vite_sandboxed.cjs"
        for mode, name in build_modes:
            _vite_build(
                name = name,
                mode = mode,
                srcs = build_deps,
                launcher = launcher,
                env = {},
                core_dist = core_dist,
                core_wasm = core_wasm,
                compute_dist = compute_dist,
                proto_gen = proto_gen,
                zstd_wasm = zstd_wasm,
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
        data = all_deps + tests,
    )

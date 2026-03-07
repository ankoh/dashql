"""Vite build and Vitest test macro (used by dashql-app)."""
load("@npm//:vite/package_json.bzl", vite_bin = "bin")
load("@npm//:vitest/package_json.bzl", vitest_bin = "bin")

def _vite_build_impl(ctx):
    """Run Vite build; env and inputs come from rule attrs (npm_root, vite_pkg, rollup_pkg, rollup_native_pkg, etc.)."""
    dist_dir = ctx.actions.declare_directory("dist")
    env = dict(ctx.attr.env)
    if ctx.attr.core_api_dist:
        env["DASHQL_CORE_API_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.core_api_dist.label) + ")", [ctx.attr.core_api_dist])
    if ctx.attr.core_wasm:
        env["DASHQL_CORE_WASM_PATH"] = ctx.expand_location("$(location " + str(ctx.attr.core_wasm.label) + ")", [ctx.attr.core_wasm])
    if ctx.attr.compute_dist:
        env["DASHQL_COMPUTE_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.compute_dist.label) + ")", [ctx.attr.compute_dist])
    if ctx.attr.proto_gen:
        env["DASHQL_PROTOBUF_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.proto_gen.label) + ")", [ctx.attr.proto_gen])
    if ctx.attr.zstd_wasm:
        env["DASHQL_ZSTD_WASM_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.zstd_wasm.label) + ")", [ctx.attr.zstd_wasm])
    if ctx.attr.npm_root:
        env["DASHQL_NPM_ROOT"] = ctx.attr.npm_root
    if ctx.attr.vite_pkg:
        env["DASHQL_VITE_PKG"] = ctx.expand_location("$(location " + str(ctx.attr.vite_pkg.label) + ")", [ctx.attr.vite_pkg])
    if ctx.attr.rollup_pkg:
        env["DASHQL_ROLLUP_PKG"] = ctx.expand_location("$(location " + str(ctx.attr.rollup_pkg.label) + ")", [ctx.attr.rollup_pkg])
    if ctx.attr.rollup_native_pkg and ctx.files.rollup_native_pkg:
        env["DASHQL_ROLLUP_NATIVE_DIST"] = ctx.expand_location("$(location " + str(ctx.attr.rollup_native_pkg.label) + ")", [ctx.attr.rollup_native_pkg])
    env_exports = " ".join(["export %s='%s'" % (k, v.replace("'", "'\"'\"'")) for k, v in env.items()])

    inputs = ctx.files.srcs + [ctx.file.launcher]
    if ctx.attr.core_api_dist:
        inputs = inputs + ctx.files.core_api_dist
    if ctx.attr.core_wasm:
        inputs = inputs + ctx.files.core_wasm
    if ctx.attr.proto_gen:
        inputs = inputs + ctx.files.proto_gen
    if ctx.attr.zstd_wasm:
        inputs = inputs + ctx.files.zstd_wasm
    if ctx.attr.vite_pkg:
        inputs = inputs + ctx.files.vite_pkg
    if ctx.attr.rollup_pkg:
        inputs = inputs + ctx.files.rollup_pkg
    if ctx.attr.rollup_native_pkg and ctx.files.rollup_native_pkg:
        inputs = inputs + ctx.files.rollup_native_pkg

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
        "core_api_dist": attr.label(allow_files = True, default = None, doc = "@ankoh/dashql-core JS bundle (e.g. //packages/dashql-core/api:bundle); sets DASHQL_CORE_API_DIST."),
        "core_wasm": attr.label(allow_single_file = [".wasm"], default = None, doc = "Core WASM file (e.g. //packages/dashql-core/api:core_wasm_opt); sets DASHQL_CORE_WASM_PATH."),
        "compute_dist": attr.label(allow_files = True, default = None, doc = "@ankoh/dashql-compute dist; sets DASHQL_COMPUTE_DIST to its path."),
        "proto_gen": attr.label(allow_files = True, default = None, doc = "Proto TS gen tree (e.g. //packages/dashql-app:proto); sets DASHQL_PROTO_GEN to its path."),
        "zstd_wasm": attr.label(allow_files = True, default = None, doc = "@bokuweb/zstd-wasm package dir (e.g. //:node_modules/@bokuweb/zstd-wasm/dir); sets DASHQL_ZSTD_WASM_DIST."),
        "npm_root": attr.string(default = "", doc = "Runfiles-relative path to node_modules (e.g. node_modules); sets DASHQL_NPM_ROOT for NODE_PATH resolution."),
        "vite_pkg": attr.label(allow_files = True, default = None, doc = "Vite package dir (e.g. //:node_modules/vite/dir); sets DASHQL_VITE_PKG for vite binary."),
        "rollup_pkg": attr.label(allow_files = True, default = None, doc = "Rollup package dir (e.g. //:node_modules/rollup/dir); sets DASHQL_ROLLUP_PKG."),
        "rollup_native_pkg": attr.label(allow_files = True, default = None, doc = "Rollup native package dir (e.g. //:node_modules/@rollup/rollup-darwin-arm64/dir); sets DASHQL_ROLLUP_NATIVE_DIST for NODE_PATH symlink."),
    },
)

def vite(tests = [], assets = [], deps = [], build_modes = None, npm = None, build_launcher = None, core_api_dist = None, core_wasm = None, compute_dist = None, proto_gen = None, zstd_wasm = None, npm_root = None, vite_pkg = None, rollup_pkg = None, rollup_native_pkg = None, **kwargs):
    """Create Vite build target(s) and Vitest test. When build_modes is set, uses _vite_build with npm_root, vite_pkg, rollup_pkg, rollup_native_pkg (and DASHQL_* paths) from BUILD."""
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
        if core_api_dist:
            build_deps = build_deps + [core_api_dist]
        if core_wasm:
            build_deps = build_deps + [core_wasm]
        if compute_dist:
            build_deps = build_deps + [compute_dist]
        if proto_gen:
            build_deps = build_deps + [proto_gen]
        if zstd_wasm:
            build_deps = build_deps + [zstd_wasm]
        if vite_pkg:
            build_deps = build_deps + [vite_pkg]
        if rollup_pkg:
            build_deps = build_deps + [rollup_pkg]
        # rollup_native_pkg is not added to build_deps so it can be a select(); the rule resolves it per configuration.
        launcher = build_launcher or "//bazel/vite:vite_sandboxed.cjs"
        for mode, name in build_modes:
            _vite_build(
                name = name,
                mode = mode,
                srcs = build_deps,
                launcher = launcher,
                env = {},
                core_api_dist = core_api_dist,
                core_wasm = core_wasm,
                compute_dist = compute_dist,
                proto_gen = proto_gen,
                zstd_wasm = zstd_wasm,
                npm_root = npm_root or "node_modules",
                vite_pkg = vite_pkg,
                rollup_pkg = rollup_pkg,
                rollup_native_pkg = rollup_native_pkg,
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

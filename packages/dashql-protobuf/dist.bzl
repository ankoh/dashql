"""dashql-protobuf dist rule: tsc + esbuild from protoc-generated TypeScript."""

def _dashql_protobuf_dist_impl(ctx):
    dist_dir = ctx.actions.declare_directory("dist")
    script = ctx.file.build_script
    gen_dir = ctx.attr.gen[DefaultInfo].files.to_list()[0]
    gen_path = gen_dir.path
    script_path = script.path
    pkg_dir = ctx.file.index_ts.dirname
    nm_files = ctx.attr.node_modules[DefaultInfo].files.to_list()
    first_path = nm_files[0].path if nm_files else ""
    node_modules_path = first_path[:first_path.index("node_modules") + len("node_modules")] if nm_files and "node_modules" in first_path else "node_modules"
    ctx.actions.run_shell(
        outputs = [dist_dir],
        inputs = [gen_dir, ctx.file.index_ts, ctx.file.bundle_ts, ctx.file.tsconfig, script] +
                 nm_files +
                 ctx.files.tsnode_esm +
                 [ctx.file.root_tsconfig],
        command = (
            "set -e\n" +
            "export BUF_GEN_PATH=\"$PWD/" + gen_path + "\"\n" +
            "export DASHQL_PROTOBUF_DIST=\"$PWD/" + dist_dir.path + "\"\n" +
            "export DASHQL_PROTOBUF_PKG_DIR=\"$PWD/" + pkg_dir + "\"\n" +
            "export NODE_MODULES=\"$PWD/" + node_modules_path + "\"\n" +
            "export RUNFILES_MAIN_REPO=_main\n" +
            "node \"" + script_path + "\""
        ),
        mnemonic = "DashqlProtobufDist",
        progress_message = "Building dashql-protobuf dist (tsc + esbuild)",
        use_default_shell_env = True,
    )
    return [DefaultInfo(files = depset([dist_dir]))]

_dashql_protobuf_dist = rule(
    implementation = _dashql_protobuf_dist_impl,
    attrs = {
        "gen": attr.label(mandatory = True),
        "build_script": attr.label(default = "//packages/dashql-protobuf:scripts/build_bazel.cjs", allow_single_file = [".cjs"]),
        "index_ts": attr.label(default = "//packages/dashql-protobuf:index.ts", allow_single_file = [".ts"]),
        "bundle_ts": attr.label(default = "//packages/dashql-protobuf:bundle.ts", allow_single_file = [".ts"]),
        "tsconfig": attr.label(default = "//packages/dashql-protobuf:tsconfig.json", allow_single_file = [".json"]),
        "node_modules": attr.label(default = "//:node_modules"),
        "tsnode_esm": attr.label(default = "//scripts:tsnode-esm.js", allow_single_file = True),
        "root_tsconfig": attr.label(default = "//:tsconfig.json", allow_single_file = True),
    },
)

def dashql_protobuf_dist(name, gen, **kwargs):
    _dashql_protobuf_dist(name = name, gen = gen, **kwargs)

"""Hermetic FlatBuffer TypeScript codegen rule."""

def _dashql_buffers_ts_gen_impl(ctx):
    out = ctx.actions.declare_directory("dashql_buffers_ts")
    flath = ctx.executable.flatc.path
    idx = ctx.file.index_fbs.path
    out_path = out.path
    script = ctx.file.gen_script.path
    ctx.actions.run_shell(
        outputs = [out],
        inputs = ctx.files.srcs + [ctx.file.gen_script],
        tools = [ctx.executable.flatc],
        command = (
            "export FLATC={} SPEC_INDEX={} OUT_DIR={} && exec bash {}"
        ).format(repr(flath), repr(idx), repr(out_path), repr(script)),
        mnemonic = "FlatBufTSGen",
    )
    return [DefaultInfo(files = depset([out]))]

dashql_buffers_ts_gen = rule(
    implementation = _dashql_buffers_ts_gen_impl,
    attrs = {
        "srcs": attr.label_list(allow_files = [".fbs"]),
        "index_fbs": attr.label(allow_single_file = [".fbs"]),
        "flatc": attr.label(
            default = "@com_google_flatbuffers//:flatc",
            executable = True,
            cfg = "exec",
        ),
        "gen_script": attr.label(
            default = "//proto/fb/bazel:gen_flatbuf_ts.sh",
            allow_single_file = True,
        ),
    },
)

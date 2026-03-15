"""Neutral exec-platform helpers for wasm-opt / wasm-strip actions.

The wasm_tool_exec platform (//bazel/platforms:wasm_tool_exec) carries no OS or
CPU constraints and has no exec_properties.  Forcing wasm-opt and wasm-strip
actions into the "wasm_tool" exec group therefore produces an identical REAPI
Command.platform on macOS and Linux.  Combined with the sh_binary wrappers in
@binaryen and @wabt that bundle both platform binaries and select at runtime,
the action cache key is the same on every host, enabling remote cache sharing.
"""

# Exec group shared by rules that run wasm-opt / wasm-strip.
# Import as: load("//bazel:wasm_tools.bzl", "WASM_TOOL_EXEC_GROUP", "optimize_wasm")

WASM_TOOL_EXEC_GROUP = exec_group(
    exec_compatible_with = ["//bazel/platforms:is_wasm_tool_exec"],
)

def _optimize_wasm_impl(ctx):
    wasm_in = ctx.file.src
    wasm_out = ctx.actions.declare_file(ctx.attr.out)

    if ctx.attr.optimize:
        wasm_opt = ctx.executable._wasm_opt
        wasm_strip = ctx.executable._wasm_strip
        ctx.actions.run_shell(
            exec_group = "wasm_tool",
            outputs = [wasm_out],
            inputs = [wasm_in],
            tools = [wasm_opt, wasm_strip],
            command = (
                '"{wasm_opt}" -O3 -o "{out}" "{inp}" && "{wasm_strip}" "{out}"'
            ).format(
                wasm_opt = wasm_opt.path,
                wasm_strip = wasm_strip.path,
                inp = wasm_in.path,
                out = wasm_out.path,
            ),
            mnemonic = "WasmOptStrip",
            progress_message = "wasm-opt + wasm-strip %s" % ctx.label,
        )
    else:
        ctx.actions.run_shell(
            outputs = [wasm_out],
            inputs = [wasm_in],
            command = 'cp "{inp}" "{out}"'.format(
                inp = wasm_in.path,
                out = wasm_out.path,
            ),
            mnemonic = "WasmCopy",
            progress_message = "copy wasm %s" % ctx.label,
        )

    return [DefaultInfo(files = depset([wasm_out]))]

def optimize_wasm(name, src, out, **kwargs):
    """Runs wasm-opt -O3 + wasm-strip on a .wasm file in release builds; copies unchanged in dev builds."""
    optimize_wasm_impl(
        name = name,
        src = src,
        out = out,
        optimize = select({
            "//bazel/config:release": True,
            "//conditions:default": False,
        }),
        **kwargs
    )

optimize_wasm_impl = rule(
    implementation = _optimize_wasm_impl,
    doc = "Runs wasm-opt -O3 + wasm-strip on a .wasm file (release) or copies it unchanged (dev). Uses the neutral wasm_tool exec platform for cross-platform remote cache sharing.",
    exec_groups = {"wasm_tool": WASM_TOOL_EXEC_GROUP},
    attrs = {
        "src": attr.label(
            mandatory = True,
            allow_single_file = True,
            doc = "Input .wasm file.",
        ),
        "out": attr.string(
            mandatory = True,
            doc = "Output file name (e.g. dashql_core.wasm).",
        ),
        "optimize": attr.bool(
            default = True,
            doc = "If True, run wasm-opt -O3 + wasm-strip; otherwise copy unchanged.",
        ),
        "_wasm_opt": attr.label(
            default = "@binaryen//:wasm_opt",
            executable = True,
            cfg = "exec",
        ),
        "_wasm_strip": attr.label(
            default = "@wabt//:wasm_strip",
            executable = True,
            cfg = "exec",
        ),
    },
)

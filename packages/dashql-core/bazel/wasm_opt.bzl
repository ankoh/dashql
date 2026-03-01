"""Builds dashql_core_wasm with -c opt, then runs wasm-opt -O3 and wasm_strip.

Splits into a transition passthrough (so host tools are not in the transitioned config)
and a genrule that runs Binaryen/WABT on the opt-built wasm.
"""

def _opt_transition_impl(settings, _attr):
    return {"//command_line_option:compilation_mode": "opt"}

_opt_transition = transition(
    implementation = _opt_transition_impl,
    inputs = ["//command_line_option:compilation_mode"],
    outputs = ["//command_line_option:compilation_mode"],
)

def _dashql_core_wasm_opt_raw_impl(ctx):
    """Exposes the -c opt built wasm (no host tools in this rule)."""
    return [DefaultInfo(
        files = depset(ctx.files.wasm),
        runfiles = ctx.runfiles(files = ctx.files.wasm),
    )]

dashql_core_wasm_opt_raw = rule(
    implementation = _dashql_core_wasm_opt_raw_impl,
    attrs = {
        "wasm": attr.label(
            mandatory = True,
            cfg = _opt_transition,
        ),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
    doc = "Passthrough: dashql_core_wasm built with -c opt (for use by genrule that runs wasm-opt + wasm_strip).",
)

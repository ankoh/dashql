"""Wraps :dist so that depending on it builds dist for wasm32; everything else uses the default (host) platform."""

def _wasm_platform_transition_impl(_settings, _attr):
    return {"//command_line_option:platforms": ["//bazel/platforms:wasm32"]}

_wasm_platform_transition = transition(
    implementation = _wasm_platform_transition_impl,
    inputs = [],
    outputs = ["//command_line_option:platforms"],
)

def _dist_wasm_impl(ctx):
    return [DefaultInfo(
        files = depset(ctx.files.dist),
        runfiles = ctx.runfiles(files = ctx.files.dist),
    )]

use_wasm32_platform = rule(
    implementation = _dist_wasm_impl,
    attrs = {
        "dist": attr.label(
            mandatory = True,
            cfg = _wasm_platform_transition,
        ),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)

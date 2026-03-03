"""Wraps :dist so that depending on it builds dist for wasm32; everything else uses the default (host) platform.

When the transition runs, we also apply the same execution modifier as --config=wasm
(no-sandbox for wasm actions) so the wasm32 build succeeds without the user passing --config=wasm.
"""

def _wasm_platform_transition_impl(settings, _attr):
    result = {"//command_line_option:platforms": ["//bazel/platforms:wasm32"]}
    # Apply wasm config's no-sandbox so C++ compile/link for wasm32 succeed (see docs/bug_bazel_wasm_sandbox.md).
    current = settings.get("//command_line_option:modify_execution_info") or []
    result["//command_line_option:modify_execution_info"] = (
        current if ".*=+no-sandbox" in current else current + [".*=+no-sandbox"]
    )
    return result

_wasm_platform_transition = transition(
    implementation = _wasm_platform_transition_impl,
    inputs = ["//command_line_option:modify_execution_info"],
    outputs = [
        "//command_line_option:platforms",
        "//command_line_option:modify_execution_info",
    ],
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

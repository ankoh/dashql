"""platform_binary: builds a target for a specific --platforms value via a transition."""

def _platform_transition_impl(settings, attr):
    return {
        "//command_line_option:platforms": [attr.platform],
        "//command_line_option:compilation_mode": settings["//command_line_option:compilation_mode"],
    }

_platform_transition = transition(
    implementation = _platform_transition_impl,
    inputs = ["//command_line_option:compilation_mode"],
    outputs = [
        "//command_line_option:platforms",
        "//command_line_option:compilation_mode",
    ],
)

def _platform_binary_impl(ctx):
    files = ctx.files.binary
    if not files:
        fail("binary produced no files")
    return [DefaultInfo(files = depset(files))]

platform_binary = rule(
    implementation = _platform_binary_impl,
    doc = "Builds a binary target for a specific platform via transition.",
    attrs = {
        "binary": attr.label(
            mandatory = True,
            cfg = _platform_transition,
            doc = "Target to build.",
        ),
        "platform": attr.string(
            mandatory = True,
            doc = "Platform label (e.g. //bazel/platforms:aarch64_macos).",
        ),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)

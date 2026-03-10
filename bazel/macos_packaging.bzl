"""macOS packaging rules: platform_binary, lipo, hdiutil, and iconutil."""

# ---------------------------------------------------------------------------
# platform_binary: builds a target for a specific --platforms value via
# transition.  Compose with lipo to create universal binaries.
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# lipo: thin wrapper around the macOS lipo tool.
# ---------------------------------------------------------------------------

def _lipo_impl(ctx):
    inputs = ctx.files.inputs
    if len(inputs) < 2:
        fail("lipo requires at least two input binaries")

    output = ctx.actions.declare_file(ctx.attr.out)

    ctx.actions.run_shell(
        outputs = [output],
        inputs = inputs,
        command = "lipo -create {srcs} -output {out}".format(
            srcs = " ".join(['"{}"'.format(f.path) for f in inputs]),
            out = output.path,
        ),
        mnemonic = "Lipo",
        progress_message = "lipo %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([output]))]

lipo = rule(
    implementation = _lipo_impl,
    doc = "Merges multiple single-architecture Mach-O binaries into one universal binary via lipo.",
    attrs = {
        "inputs": attr.label_list(mandatory = True, allow_files = True, doc = "Single-architecture binaries to merge."),
        "out": attr.string(mandatory = True, doc = "Output filename."),
    },
)

# ---------------------------------------------------------------------------
# hdiutil: thin wrapper around macOS hdiutil create.
# ---------------------------------------------------------------------------

def _hdiutil_impl(ctx):
    srcfolder = ctx.files.srcfolder
    if not srcfolder:
        fail("srcfolder produced no files")
    srcdir = srcfolder[0]

    output = ctx.actions.declare_file(ctx.attr.out)

    ctx.actions.run_shell(
        outputs = [output],
        inputs = [srcdir],
        command = 'hdiutil create -volname "{volname}" -srcfolder "{srcdir}" -ov -format "{format}" "{out}"'.format(
            volname = ctx.attr.volname,
            srcdir = srcdir.path,
            format = ctx.attr.format,
            out = output.path,
        ),
        execution_requirements = {"no-sandbox": "1"},
        mnemonic = "HdiUtil",
        progress_message = "hdiutil %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([output]))]

hdiutil = rule(
    implementation = _hdiutil_impl,
    doc = "Creates a macOS disk image via hdiutil create -srcfolder.",
    attrs = {
        "srcfolder": attr.label(mandatory = True, doc = "Directory whose contents become the volume."),
        "volname": attr.string(mandatory = True, doc = "Volume name."),
        "format": attr.string(default = "UDZO", doc = "Disk image format (default UDZO = zlib-compressed)."),
        "out": attr.string(mandatory = True, doc = "Output filename (e.g. DashQL.dmg)."),
    },
)

# ---------------------------------------------------------------------------
# iconutil: converts a .iconset directory of PNGs to a .icns file.
# ---------------------------------------------------------------------------

def _iconutil_impl(ctx):
    inputs = ctx.files.iconset
    if not inputs:
        fail("iconset produced no files")

    output = ctx.actions.declare_file(ctx.attr.out)

    ctx.actions.run_shell(
        outputs = [output],
        inputs = inputs,
        command = """
            ICONSET=$(mktemp -d)/icons.iconset
            mkdir -p "$ICONSET"
            {copies}
            iconutil -c icns "$ICONSET" -o "{out}"
        """.format(
            copies = "\n            ".join(
                ['cp "{src}" "$ICONSET/"'.format(src = f.path) for f in inputs],
            ),
            out = output.path,
        ),
        mnemonic = "IconUtil",
        progress_message = "iconutil %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([output]))]

iconutil = rule(
    implementation = _iconutil_impl,
    doc = "Converts a macOS .iconset directory of PNGs to a .icns file via iconutil.",
    attrs = {
        "iconset": attr.label(mandatory = True, allow_files = [".png"], doc = "Filegroup of .iconset PNG files."),
        "out": attr.string(mandatory = True, doc = "Output .icns filename."),
    },
)

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
# codesign: deep-signs a .app bundle using the host keychain.
#
# The signing identity is read from --define=APPLE_SIGNING_IDENTITY=<identity>
# (ctx.var) and injected directly into the action environment.  Only the
# codesign action sees the value; all other action hashes are unaffected.
#
# The action runs with no-sandbox + no-remote so it can access the macOS
# keychain prepared by the CI import-certificate step, and is never cached
# remotely (signature depends on the in-keychain cert, not just file contents).
# ---------------------------------------------------------------------------

def _codesign_impl(ctx):
    app_dir = ctx.files.app[0]
    entitlements = ctx.file.entitlements
    out = ctx.actions.declare_directory(ctx.attr.out)
    signing_identity = ctx.var.get("APPLE_SIGNING_IDENTITY", "")

    ctx.actions.run_shell(
        outputs = [out],
        inputs = [app_dir, entitlements],
        env = {"APPLE_SIGNING_IDENTITY": signing_identity},
        command = """set -euo pipefail
if [ -z "${{APPLE_SIGNING_IDENTITY:-}}" ]; then
  echo "error: APPLE_SIGNING_IDENTITY is not set. Pass it via --define=APPLE_SIGNING_IDENTITY=<identity>." >&2
  exit 1
fi
cp -R "{src}/." "{out}"
chmod -R u+w "{out}"
codesign \\
    --deep --force --verify --verbose \\
    --sign "$APPLE_SIGNING_IDENTITY" \\
    --entitlements "{ent}" \\
    --options runtime \\
    "{out}"
codesign --verify --deep --strict "{out}"
""".format(src = app_dir.path, out = out.path, ent = entitlements.path),
        execution_requirements = {
            "no-sandbox": "1",
            "no-remote": "1",
            "no-cache": "1",
            "local": "1",
        },
        mnemonic = "Codesign",
        progress_message = "codesign %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([out]))]

codesign = rule(
    implementation = _codesign_impl,
    doc = "Deep-signs a macOS .app bundle directory with codesign.",
    attrs = {
        "app": attr.label(
            mandatory = True,
            doc = "App bundle directory to sign.",
        ),
        "entitlements": attr.label(
            mandatory = True,
            allow_single_file = True,
            doc = "Entitlements plist file.",
        ),
        "out": attr.string(
            mandatory = True,
            doc = "Output directory name (e.g. DashQL.app).",
        ),
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
        command = """set -euo pipefail
HDIUTIL_TMP=$(mktemp -d)
trap 'chmod -R u+w "$HDIUTIL_TMP" 2>/dev/null || true; rm -rf "$HDIUTIL_TMP"' EXIT
cp -RL "{srcdir}/." "$HDIUTIL_TMP/"
hdiutil create -volname "{volname}" -srcfolder "$HDIUTIL_TMP" -ov -format "{format}" "{out}"
""".format(
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

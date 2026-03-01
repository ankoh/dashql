"""package_core: swc output + WASM + d.ts. core_src_tree is built via @aspect_bazel_lib copy_to_directory in BUILD."""

def _package_core_impl(ctx):
    """Copies swc compile output directory + WASM into out_dir and writes d.ts."""
    out = ctx.actions.declare_directory(ctx.attr.name)
    bundle_dir = ctx.files.bundle[0]
    wasm_file = ctx.file.wasm
    ctx.actions.run_shell(
        outputs = [out],
        inputs = ctx.files.bundle + [wasm_file],
        command = """
            cp -r "{bundle_dir}/"* "{out}/"
            cp "{wasm}" "{out}/dashql.wasm"
            echo "export * from './src/index.js';" > "{out}/dashql.module.d.ts"
        """.format(
            bundle_dir = bundle_dir.path,
            out = out.path,
            wasm = wasm_file.path,
        ),
        mnemonic = "PackageCore",
    )
    return [DefaultInfo(files = depset([out]))]

_package_core = rule(
    implementation = _package_core_impl,
    attrs = {
        "bundle": attr.label(mandatory = True, allow_files = True),
        "wasm": attr.label(mandatory = True, allow_single_file = True),
    },
)

def package_core(name, wasm_label, out_dir = "dist", bundle_label = ":bundle"):
    """Rule: copy aspect_rules_swc compile output dir + WASM into a directory and write d.ts."""
    _package_core(
        name = name,
        bundle = bundle_label,
        wasm = wasm_label,
    )

"""Macro to generate the dist genrule (shared by dist and dist_opt)."""

def package_core(name, wasm_label, core_api_srcs, out_dir = "dist"):
    """Generates a genrule that bundles core-api with the given WASM.
    out_dir must differ between dist and dist_opt so generated files do not conflict."""
    native.genrule(
        name = name,
        srcs = [
            "//proto/fb:dashql_buffers_ts_gen",
            wasm_label,
            "bazel/bundle_bazel.js",
        ] + core_api_srcs,
        outs = [
            out_dir + "/dashql.module.js",
            out_dir + "/dashql.module.js.map",
            out_dir + "/dashql.wasm",
            out_dir + "/dashql.module.d.ts",
        ],
        cmd = """
            OUTPUT_ABS="$$(pwd)/$(@D)/{out_dir}" && \\
            mkdir -p "$$OUTPUT_ABS" && \\
            REPO_ROOT=$$(cd "$$(dirname $(location src/index.ts))/../../.." && pwd) && \\
            cd "$$REPO_ROOT" && \\
            export DASHQL_GEN_DIR="$(location //proto/fb:dashql_buffers_ts_gen)" && \\
            export DASHQL_WASM_PATH="$(location {wasm_label})" && \\
            export DASHQL_OUT_DIR="$$OUTPUT_ABS" && \\
            node packages/dashql-core-api/bazel/bundle_bazel.js
        """.format(wasm_label = wasm_label, out_dir = out_dir),
        output_to_bindir = False,
        tags = ["local"],
    )

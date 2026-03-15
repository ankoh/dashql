"""Generic WASM build: platform transition + wasm-bindgen-cli + optional wasm-opt.

Build a Rust cdylib for wasm32 via transition, then run wasm-bindgen to produce
JS + WASM + package.json (same layout as wasm-pack output).
"""

load("//bazel:wasm_tools.bzl", "WASM_TOOL_EXEC_GROUP")

def _rust_wasm_platform_transition_impl(settings, attr):
    return {
        "//command_line_option:platforms": ["@rules_rust//rust/platform:wasm"],
        "//command_line_option:compilation_mode": settings["//command_line_option:compilation_mode"],
    }

_rust_wasm_platform_transition = transition(
    implementation = _rust_wasm_platform_transition_impl,
    inputs = ["//command_line_option:compilation_mode"],
    outputs = [
        "//command_line_option:platforms",
        "//command_line_option:compilation_mode",
    ],
)

def _rust_wasm_dist_impl(ctx):
    # Library (built for wasm via transition) has one main output: .wasm or .so
    lib_files = ctx.files.library_target
    if len(lib_files) == 0:
        fail("library_target produced no files")
    wasm_in = lib_files[0]
    for f in lib_files:
        if f.extension == "wasm":
            wasm_in = f
            break
        if f.extension == "so":
            wasm_in = f
            break

    out_dir = ctx.actions.declare_directory(ctx.attr.name + "_gen")
    out_name = ctx.attr.out_name
    bindgen = ctx.file.wasm_bindgen_cli

    # wasm-bindgen --out-dir <dir> --out-name <name> --target web <input>
    ctx.actions.run_shell(
        outputs = [out_dir],
        inputs = [wasm_in, bindgen],
        tools = [bindgen],
        command = '"{}" --out-dir "{}" --out-name "{}" --target web "{}"'.format(
            bindgen.path,
            out_dir.path,
            out_name,
            wasm_in.path,
        ),
        mnemonic = "WasmBindgen",
        progress_message = "wasm-bindgen %s" % ctx.label,
    )

    # Minimal package.json for npm link (same as wasm-pack output).
    # "type": "module" ensures .js is treated as ESM (wasm-bindgen --target web emits ESM).
    pkg_name = ctx.attr.package_name or out_name
    pkg_json = '{{"name":"{pkg_name}","version":"0.0.0","type":"module","module":"{out_name}.js","main":"index.js","types":"{out_name}.d.ts","sideEffects":false}}\n'.format(
        pkg_name = pkg_name,
        out_name = out_name,
    )
    index_js = 'export * from "./{out_name}.js";\nexport {{ default }} from "./{out_name}.js";\n'.format(out_name = out_name)

    # Optional wasm-opt on the generated _bg.wasm (second action)
    if ctx.attr.wasm_opt:
        wasm_opt = ctx.executable.wasm_opt
        opt_out_dir = ctx.actions.declare_directory(ctx.attr.name + "_pkg")
        bg_wasm = out_name + "_bg.wasm"
        # wasm-opt cannot overwrite input in place (sandbox/permissions). Write to .tmp then mv.
        script = """
set -e
mkdir -p "{opt_out_dir}"
cp -a "{out_dir}"/* "{opt_out_dir}"/
"{wasm_opt}" -O3 "{opt_out_dir}/{bg_wasm}" -o "{opt_out_dir}/{bg_wasm}.tmp"
mv "{opt_out_dir}/{bg_wasm}.tmp" "{opt_out_dir}/{bg_wasm}"
printf '%s' '{pkg_json_escaped}' > "{opt_out_dir}/package.json"
printf '%s' '{index_js_escaped}' > "{opt_out_dir}/index.js"
""".format(
            wasm_opt = wasm_opt.path,
            out_dir = out_dir.path,
            opt_out_dir = opt_out_dir.path,
            bg_wasm = bg_wasm,
            pkg_json_escaped = pkg_json.replace("'", "'\"'\"'"),
            index_js_escaped = index_js.replace("'", "'\"'\"'"),
        ).strip()
        ctx.actions.run_shell(
            exec_group = "wasm_tool",
            outputs = [opt_out_dir],
            inputs = [out_dir],
            tools = [wasm_opt],
            command = script,
            mnemonic = "WasmOpt",
            progress_message = "wasm-opt %s" % ctx.label,
        )
        return [DefaultInfo(files = depset([opt_out_dir]))]

    # No wasm_opt: copy wasm-bindgen output and add package.json
    pkg_dir = ctx.actions.declare_directory(ctx.attr.name + "_pkg")
    script = """
set -e
mkdir -p "{pkg_dir}"
cp -a "{out_dir}"/* "{pkg_dir}"/
printf '%s' '{pkg_json_escaped}' > "{pkg_dir}/package.json"
printf '%s' '{index_js_escaped}' > "{pkg_dir}/index.js"
""".format(
        out_dir = out_dir.path,
        pkg_dir = pkg_dir.path,
        pkg_json_escaped = pkg_json.replace("'", "'\"'\"'"),
        index_js_escaped = index_js.replace("'", "'\"'\"'"),
    ).strip()
    ctx.actions.run_shell(
        outputs = [pkg_dir],
        inputs = [out_dir],
        command = script,
        mnemonic = "WasmDist",
        progress_message = "dist %s" % ctx.label,
    )
    return [DefaultInfo(files = depset([pkg_dir]))]

rust_wasm_dist = rule(
    implementation = _rust_wasm_dist_impl,
    doc = "Builds a Rust cdylib for wasm (via transition), runs wasm-bindgen, optionally wasm-opt; produces dist dir with JS, WASM, package.json.",
    exec_groups = {"wasm_tool": WASM_TOOL_EXEC_GROUP},
    attrs = {
        "library_target": attr.label(
            mandatory = True,
            cfg = _rust_wasm_platform_transition,
            doc = "rust_shared_library target (built for wasm32 via transition).",
        ),
        "wasm_bindgen_cli": attr.label(
            mandatory = True,
            allow_single_file = True,
            cfg = "exec",
            doc = "wasm-bindgen CLI binary (source file or executable).",
        ),
        "wasm_opt": attr.label(
            default = None,
            executable = True,
            cfg = "exec",
            doc = "Optional wasm-opt binary for release build.",
        ),
        "out_name": attr.string(
            mandatory = True,
            doc = "Output name for JS/WASM (e.g. dashql_compute → dashql_compute.js, dashql_compute_bg.wasm).",
        ),
        "package_name": attr.string(
            default = "",
            doc = "npm package name for package.json (e.g. @ankoh/dashql-compute). If empty, uses out_name.",
        ),
        "_allowlist_function_transition": attr.label(
            default = "@bazel_tools//tools/allowlists/function_transition_allowlist",
        ),
    },
)

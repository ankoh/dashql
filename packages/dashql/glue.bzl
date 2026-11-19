"""@akohn/dashql-wasm of a core module: the wasm-bindgen glue of the core and of the dataflow layout, with their Wasm.

The glue loads `<name>_bg.wasm` by default, the package ships the modules as `dashql_core.wasm` and `dashql_dataflow.wasm`,
and every glue exports the URL of its module next to it (`wasmUrl`), which bundlers turn into an asset. A product that
builds a core module of its own (`dashql_core_module` of //packages/dashql-core-bindings:module.bzl) passes its targets.
"""

_DATAFLOW_BINDGEN = "//packages/dashql-dataflow-bindings:dashql_dataflow_bindgen"
_DATAFLOW_WASM = "//packages/dashql-dataflow-bindings:dataflow_wasm"

# The shell command, `{out_dir}`, `{core_bindgen}` and `{core_wasm}` are filled in. Symbol.dispose needs lib
# esnext.disposable, which ES2022 consumers lack, the declarations drop it.
_CMD = """
OUT="$(RULEDIR)/{out_dir}"
for src in $(locations {core_bindgen}) $(locations {dataflow_bindgen}); do
    case "$$src" in
        */dashql_core.js|*/dashql_dataflow.js)
            name=$$(basename "$$src" .js)
            sed "s/$${{name}}_bg[.]wasm/$${{name}}.wasm/g" "$$src" > "$$OUT/$$name.js"
            printf '\\n/** The URL of the module next to this glue */\\nexport const wasmUrl = new URL(%s, import.meta.url);\\n' "'./$$name.wasm'" >> "$$OUT/$$name.js"
            ;;
        */dashql_core.d.ts|*/dashql_dataflow.d.ts)
            name=$$(basename "$$src" .d.ts)
            sed '/[[]Symbol[.]dispose[]]/d' "$$src" > "$$OUT/$$name.d.ts"
            printf '\\n/** The URL of the module next to this glue */\\nexport declare const wasmUrl: URL;\\n' >> "$$OUT/$$name.d.ts"
            ;;
    esac
done
cp "$(location {core_wasm})" "$$OUT/dashql_core.wasm"
cp "$(location {dataflow_wasm})" "$$OUT/dashql_dataflow.wasm"
"""

def dashql_wasm_glue(name, out_dir, core_bindgen, core_wasm, visibility = None):
    """The glue and the Wasm of a core module and of the dataflow layout in `out_dir`"""
    native.genrule(
        name = name,
        srcs = [core_bindgen, core_wasm, _DATAFLOW_BINDGEN, _DATAFLOW_WASM],
        outs = [
            out_dir + "/dashql_core.js",
            out_dir + "/dashql_core.d.ts",
            out_dir + "/dashql_core.wasm",
            out_dir + "/dashql_dataflow.js",
            out_dir + "/dashql_dataflow.d.ts",
            out_dir + "/dashql_dataflow.wasm",
        ],
        cmd = _CMD.format(
            out_dir = out_dir,
            core_bindgen = core_bindgen,
            core_wasm = core_wasm,
            dataflow_bindgen = _DATAFLOW_BINDGEN,
            dataflow_wasm = _DATAFLOW_WASM,
        ),
        visibility = visibility,
    )

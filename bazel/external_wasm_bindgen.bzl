"""Repository rule: download prebuilt wasm-bindgen-cli for the host (used by rust_wasm_dist)."""

# wasm-bindgen releases: https://github.com/rustwasm/wasm-bindgen/releases
_WASM_BINDGEN_VERSION = "0.2.108"
_BASE_URL = "https://github.com/rustwasm/wasm-bindgen/releases/download/" + _WASM_BINDGEN_VERSION

# (os_key, arch) -> (tarball suffix, strip_prefix)
# Asset: wasm-bindgen-0.2.108-<suffix>.tar.gz; extract has root "wasm-bindgen-0.2.108-<suffix>/" with wasm-bindgen binary inside
_PLATFORMS = {
    ("darwin", "aarch64"): ("aarch64-apple-darwin", "wasm-bindgen-" + _WASM_BINDGEN_VERSION + "-aarch64-apple-darwin"),
    ("darwin", "x86_64"): ("x86_64-apple-darwin", "wasm-bindgen-" + _WASM_BINDGEN_VERSION + "-x86_64-apple-darwin"),
    ("linux", "aarch64"): ("aarch64-unknown-linux-gnu", "wasm-bindgen-" + _WASM_BINDGEN_VERSION + "-aarch64-unknown-linux-gnu"),
    ("linux", "x86_64"): ("x86_64-unknown-linux-gnu", "wasm-bindgen-" + _WASM_BINDGEN_VERSION + "-x86_64-unknown-linux-gnu"),
}

def _wasm_bindgen_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    arch = repository_ctx.os.arch
    if os_name == "mac os x":
        os_key = "darwin"
    elif os_name == "linux":
        os_key = "linux"
    else:
        fail("Prebuilt wasm-bindgen not available for os: " + os_name)
    platform = _PLATFORMS.get((os_key, arch))
    if not platform:
        fail("Prebuilt wasm-bindgen not available for {}-{}".format(os_key, arch))
    suffix, strip_prefix = platform
    filename = "wasm-bindgen-{}-{}.tar.gz".format(_WASM_BINDGEN_VERSION, suffix)
    url = _BASE_URL + "/" + filename
    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = strip_prefix,
    )
    # Tarball layout: strip_prefix dir contains "wasm-bindgen" (or wasm-bindgen.exe on Windows)
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["wasm-bindgen"])
alias(
    name = "wasm_bindgen_cli",
    actual = "wasm-bindgen",
    visibility = ["//visibility:public"],
)
""")

wasm_bindgen_repository = repository_rule(
    implementation = _wasm_bindgen_repository_impl,
    doc = "Downloads prebuilt wasm-bindgen CLI for the host from GitHub releases.",
)

def _wasm_bindgen_ext_impl(mctx):
    wasm_bindgen_repository(name = "wasm_bindgen_cli")

wasm_bindgen_ext = module_extension(
    implementation = _wasm_bindgen_ext_impl,
)

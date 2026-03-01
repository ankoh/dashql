"""Repository rule: download prebuilt WABT for the host (wasm-strip)."""

# WABT releases: https://github.com/WebAssembly/wabt/releases
# Match scripts/install_infra.sh
_WABT_VERSION = "1.0.33"
_BASE_URL = "https://github.com/WebAssembly/wabt/releases/download/" + _WABT_VERSION

def _wabt_prebuilt_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    if os_name == "mac os x":
        filename = "wabt-{}-macos-12.tar.gz".format(_WABT_VERSION)
    elif os_name == "linux":
        filename = "wabt-{}-ubuntu.tar.gz".format(_WABT_VERSION)
    else:
        fail("Prebuilt WABT not available for os: " + os_name)
    strip_prefix = "wabt-{}".format(_WABT_VERSION)
    url = _BASE_URL + "/" + filename
    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = strip_prefix,
    )
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["bin/wasm-strip"])
alias(name = "wasm_strip", actual = "bin/wasm-strip", visibility = ["//visibility:public"])
""")

wabt_prebuilt_repository = repository_rule(
    implementation = _wabt_prebuilt_repository_impl,
    doc = "Downloads prebuilt WABT for the host (wasm-strip).",
)

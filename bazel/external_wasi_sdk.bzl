"""Repository rule: download prebuilt WASI SDK for the host (clang, wasm-ld, wasi-sysroot)."""

# WASI SDK releases: https://github.com/WebAssembly/wasi-sdk/releases
# Match scripts/install_infra.sh (WASI_VERSION=22)
_WASI_VERSION = "32"
_WASI_VERSION_FULL = _WASI_VERSION + ".0"
_BASE_URL = "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-" + _WASI_VERSION

def _wasi_sdk_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    if os_name == "mac os x":
        filename = "wasi-sdk-{}-macos.tar.gz".format(_WASI_VERSION_FULL)
    elif os_name == "linux":
        filename = "wasi-sdk-{}-linux.tar.gz".format(_WASI_VERSION_FULL)
    else:
        fail("Prebuilt WASI SDK not available for os: " + os_name)
    strip_prefix = "wasi-sdk-{}".format(_WASI_VERSION_FULL)
    url = _BASE_URL + "/" + filename
    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = strip_prefix,
    )
    # Wrapper: keep sysroot binary-relative so clang can emit exec-root-relative depfiles
    # under sandboxed execution. Extra include/resource paths are injected by the toolchain.
    repository_ctx.file(
        "bin/clang++.wrapper",
        content = """#!/bin/sh
set -e
SCRIPT_DIR="$(dirname "$0")"
exec "$SCRIPT_DIR/clang++" --target=wasm32-wasi --sysroot=../share/wasi-sysroot -no-canonical-prefixes "$@"
""",
        executable = True,
    )
    # Wrapper for ar so the real llvm-ar is resolved relative to this script (sandbox-safe).
    repository_ctx.file(
        "bin/llvm-ar.wrapper",
        content = """#!/bin/sh
set -e
exec "$(cd "$(dirname "$0")" && pwd)/llvm-ar" "$@"
""",
        executable = True,
    )
    if os_name == "mac os x":
        exec_constraints = '"@platforms//os:macos"'
    else:
        exec_constraints = '"@platforms//os:linux"'
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])

load("@rules_cc//cc:defs.bzl", "cc_toolchain")
load("@dashql//bazel:wasi_toolchain_config.bzl", "wasi_cc_toolchain_config")

filegroup(
    name = "empty",
    srcs = [],
)

filegroup(
    name = "wasi_sysroot",
    srcs = glob(["share/wasi-sysroot/**"]),
)

filegroup(
    name = "clang_resource_dir",
    srcs = glob(["lib/clang/*/include/**"]),
)

filegroup(
    name = "clang_runtime_libs",
    srcs = glob(["lib/clang/*/lib/**"]),
)

filegroup(
    name = "all_compile",
    srcs = [
        "bin/clang",
        "bin/clang++",
        "bin/clang++.wrapper",
        "bin/llvm-ar",
        "bin/llvm-ar.wrapper",
        "bin/llvm-nm",
        "bin/llvm-objdump",
        "bin/llvm-strip",
        "bin/wasm-ld",
        ":wasi_sysroot",
        ":clang_resource_dir",
        ":clang_runtime_libs",
    ],
)

filegroup(
    name = "all_link",
    srcs = [
        "bin/clang",
        "bin/clang++",
        "bin/clang++.wrapper",
        "bin/llvm-ar",
        "bin/llvm-ar.wrapper",
        "bin/wasm-ld",
        ":wasi_sysroot",
        ":clang_resource_dir",
        ":clang_runtime_libs",
    ],
)

wasi_cc_toolchain_config(
    name = "wasi_config",
    clang_resource_dir = ":clang_resource_dir",
    compiler_binary = "bin/clang++.wrapper",
)

cc_toolchain(
    name = "cc_toolchain",
    all_files = ":all_compile",
    ar_files = ":all_link",
    compiler_files = ":all_compile",
    dwp_files = ":empty",
    linker_files = ":all_link",
    objcopy_files = ":empty",
    strip_files = ":empty",
    toolchain_config = ":wasi_config",
)

# Register so we can select with: bazel build --platforms=//bazel/platforms:wasm32 ...
toolchain(
    name = "wasi_cc_toolchain",
    exec_compatible_with = [{exec_constraints}],
    target_compatible_with = ["@platforms//cpu:wasm32"],
    toolchain = ":cc_toolchain",
    toolchain_type = "@rules_cc//cc:toolchain_type",
)
""".format(exec_constraints = exec_constraints))

wasi_sdk_repository = repository_rule(
    implementation = _wasi_sdk_repository_impl,
    doc = "Downloads prebuilt WASI SDK for the host; provides a cc toolchain for wasm32-wasi.",
)

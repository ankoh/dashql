"""Repository rule: download prebuilt wasm-pack for the host (used by wasm_pack_dist rule)."""

# wasm-pack releases: https://github.com/drager/wasm-pack/releases (maintained fork of rustwasm/wasm-pack)
_WASM_PACK_VERSION = "0.14.0"
_BASE_URL = "https://github.com/drager/wasm-pack/releases/download/v" + _WASM_PACK_VERSION

# (os_key, arch) -> (tarball suffix, strip_prefix, sha256)
# Asset names: wasm-pack-v0.14.0-<suffix>.tar.gz
_PLATFORMS = {
    ("darwin", "aarch64"): (
        "aarch64-apple-darwin",
        "wasm-pack-v" + _WASM_PACK_VERSION + "-aarch64-apple-darwin",
        "9d0e70c6b229de18f0abfe910f2963e8f09ebae218250e9b09a1c3fdd955bef9",
    ),
    ("darwin", "x86_64"): (
        "x86_64-apple-darwin",
        "wasm-pack-v" + _WASM_PACK_VERSION + "-x86_64-apple-darwin",
        "46b66072ee9912b53f83841aecb04479a60e0705f7bb8b6681b377a07a512a23",
    ),
    ("linux", "aarch64"): (
        "aarch64-unknown-linux-musl",
        "wasm-pack-v" + _WASM_PACK_VERSION + "-aarch64-unknown-linux-musl",
        "5941c7b05060440ff37ee50fe9009a408e63fa5ba607a3b0736f5a887ec5f2ca",
    ),
    ("linux", "x86_64"): (
        "x86_64-unknown-linux-musl",
        "wasm-pack-v" + _WASM_PACK_VERSION + "-x86_64-unknown-linux-musl",
        "278a8d668085821f4d1a637bd864f1713f872b0ae3a118c77562a308c0abfe8d",
    ),
}

def _wasm_pack_repository_impl(repository_ctx):
    os_name = repository_ctx.os.name
    arch = repository_ctx.os.arch
    if os_name == "mac os x":
        os_key = "darwin"
    elif os_name == "linux":
        os_key = "linux"
    else:
        fail("Prebuilt wasm-pack not available for os: " + os_name)

    platform = _PLATFORMS.get((os_key, arch))
    if not platform:
        fail("Prebuilt wasm-pack not available for {}-{}".format(os_key, arch))

    suffix, strip_prefix, sha256 = platform
    filename = "wasm-pack-v{}-{}.tar.gz".format(_WASM_PACK_VERSION, suffix)
    url = _BASE_URL + "/" + filename

    repository_ctx.download_and_extract(
        url = url,
        stripPrefix = strip_prefix,
        sha256 = sha256,
    )

    # Tarball layout after strip_prefix: root contains "wasm-pack" (Linux/macOS).
    repository_ctx.file("BUILD.bazel", content = """
package(default_visibility = ["//visibility:public"])
exports_files(["wasm-pack"])
alias(
    name = "wasm_pack_bin",
    actual = "wasm-pack",
    visibility = ["//visibility:public"],
)
""")

wasm_pack_repository = repository_rule(
    implementation = _wasm_pack_repository_impl,
    doc = "Downloads prebuilt wasm-pack for the host from GitHub releases.",
)

def _wasm_pack_ext_impl(mctx):
    wasm_pack_repository(name = "wasm_pack")

wasm_pack_ext = module_extension(
    implementation = _wasm_pack_ext_impl,
)

# ---------------------------------------------------------------------------
# wasm_pack_dist rule: run wasm-pack to build a crate for web (WASM + JS bindings).
# Best practice: pass wasm_pack = @wasm_pack//:wasm_pack_bin; Cargo/rustc must be on PATH.
# ---------------------------------------------------------------------------

def _wasm_pack_dist_impl(ctx):
    out = ctx.actions.declare_directory(ctx.attr.name + "_dist")
    mode = "--release" if ctx.attr.release else "--dev"
    # Only getrandom_backend here; -zstack-size is in .cargo/config.toml for wasm32 so host builds (e.g. wasm-bindgen-cli) don't get it.
    rustflags = '--cfg getrandom_backend="wasm_js"'

    if ctx.attr.wasm_pack:
        # Use run_shell so we can set use_default_shell_env and inherit PATH (wasm-pack calls cargo).
        wasm_pack_path = ctx.executable.wasm_pack.path
        inputs = ctx.files.srcs + [ctx.executable.wasm_pack]
        script_parts = ["export RUSTFLAGS='{rustflags}'".format(rustflags = rustflags)]
        if ctx.attr.version_env_file:
            version_env = ctx.files.version_env_file[0]
            inputs.append(version_env)
            script_parts.append('export DASHQL_VERSION_ENV_FILE="$PWD/{}"'.format(version_env.path))
        script_parts.append(
            '"{wasm_pack_path}" build --target web {mode} --out-name {out_name} --out-dir "{out}" {package_path}'.format(
                wasm_pack_path = wasm_pack_path,
                mode = mode,
                out_name = ctx.attr.out_name,
                out = out.path,
                package_path = ctx.attr.package_path,
            ),
        )
        script = "\n".join(script_parts)
        ctx.actions.run_shell(
            outputs = [out],
            inputs = inputs,
            command = script,
            progress_message = "wasm-pack build %s" % ctx.label,
            mnemonic = "WasmPack",
            use_default_shell_env = True,
            execution_requirements = {"no-sandbox": "1"},
        )
    else:
        script = """
            export RUSTFLAGS='{rustflags}'
            wasm-pack build --target web {mode} --out-name {out_name} --out-dir "{out}" {package_path}
        """.format(
            rustflags = rustflags,
            mode = mode,
            out_name = ctx.attr.out_name,
            out = out.path,
            package_path = ctx.attr.package_path,
        )
        ctx.actions.run_shell(
            outputs = [out],
            inputs = ctx.files.srcs,
            command = script,
            progress_message = "wasm-pack build %s" % ctx.label,
            mnemonic = "WasmPack",
            use_default_shell_env = True,
            execution_requirements = {"no-sandbox": "1"},
        )

    return [DefaultInfo(files = depset([out]))]

wasm_pack_dist = rule(
    implementation = _wasm_pack_dist_impl,
    doc = "Runs wasm-pack build and captures the output directory (JS, WASM, package.json).",
    attrs = {
        "srcs": attr.label_list(
            allow_files = True,
            doc = "Package sources and deps (Cargo.toml, srcs, proto, Cargo.lock).",
        ),
        "package_path": attr.string(
            default = "packages/dashql-compute",
            doc = "Path to the crate from repo root (used as last arg to wasm-pack).",
        ),
        "out_name": attr.string(
            default = "dashql_compute",
            doc = "Output name for the wasm and js artifacts.",
        ),
        "release": attr.bool(
            default = True,
            doc = "Build in release mode (optimized).",
        ),
        "wasm_pack": attr.label(
            default = None,
            allow_single_file = True,
            executable = True,
            cfg = "exec",
            doc = "Optional wasm-pack binary for hermetic builds. If unset, uses wasm-pack from PATH.",
        ),
        "version_env_file": attr.label(
            default = None,
            allow_single_file = True,
            doc = "Optional version.env file for build.rs (avoids git in sandbox). E.g. @dashql_compute_version//:version.env",
        ),
    },
)

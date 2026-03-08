"""Minimal Vite build + Vitest macro using js_binary (runs in sandbox).

Use in a package that has npm_link_all_packages(name = "node_modules") and pass
npm = ":node_modules" so runfiles contain node_modules under chdir. No wrapper
script, no no-sandbox. Pattern matches bazel-monorepo tools/vite.
"""
load("@npm//:vite/package_json.bzl", vite_bin = "bin")
load("@npm//:vitest/package_json.bzl", vitest_bin = "bin")

def vite(tests = [], assets = [], deps = [], npm = None, **kwargs):
    """Create a Vite build (js_binary) and optional Vitest test.

    Args:
        tests: Test file labels for vitest.
        assets: Source/config assets (e.g. copy_to_bin of index.html, src, vite.config.ts).
        deps: Extra deps (e.g. package.json, tsconfig.json). Include ":node_modules" if
             you use npm_link_all_packages in this package so runfiles have node_modules under chdir.
        npm: Label for node_modules (default "//:node_modules"). Use ":node_modules" when
             the calling package has npm_link_all_packages so the build runs in sandbox.
    """
    npm_label = npm or "//:node_modules"
    all_deps = [npm_label] + assets + deps

    vite_bin.vite(
        name = "vite",
        srcs = all_deps,
        args = ["build", "--config", "vite.config.ts"],
        chdir = native.package_name(),
        out_dirs = ["dist"],
        visibility = ["//visibility:public"],
    )

    vitest_bin.vitest_test(
        name = "vitest",
        args = [
            "run",
            "--config=vite.config.ts",
        ],
        tags = ["manual"],
        chdir = native.package_name(),
        data = all_deps + tests,
    )

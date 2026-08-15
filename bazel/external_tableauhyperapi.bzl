"""Repository rules for the native Tableau Hyper API C++ distribution."""

# renovate: datasource=pypi depName=tableauhyperapi
TABLEAUHYPERAPI_VERSION = "0.0.26225"

_CXX_ARCHIVES = {
    "linux_x86_64": {
        "url": "https://downloads.tableau.com/tssoftware/tableauhyperapi-cxx-linux-x86_64-release-main.0.0.26225.rbf04a855.zip",
        "sha256": "2c211c09ccfdc6f0574fcb45261439569b081ac1bac88002bb5b5ee80d37b8e8",
        "strip_prefix": "tableauhyperapi-cxx-linux-x86_64-release-main.0.0.26225.rbf04a855",
        "shared_library": "lib/libtableauhyperapi.so",
    },
    "macos_x86_64": {
        "url": "https://downloads.tableau.com/tssoftware/tableauhyperapi-cxx-macos-x86_64-release-main.0.0.26225.rbf04a855.zip",
        "sha256": "58d9096d7e69aa90d784a998cd960b33db4eb114edb9e0fece4c868531aecb57",
        "strip_prefix": "tableauhyperapi-cxx-macos-x86_64-release-main.0.0.26225.rbf04a855",
        "shared_library": "lib/libtableauhyperapi.dylib",
    },
    "macos_arm64": {
        "url": "https://downloads.tableau.com/tssoftware/tableauhyperapi-cxx-macos-arm64-release-main.0.0.26225.rbf04a855.zip",
        "sha256": "77d118eb35930de56cc891cf63127638782cd2ccfd283bcb06615ae074ab9b22",
        "strip_prefix": "tableauhyperapi-cxx-macos-arm64-release-main.0.0.26225.rbf04a855",
        "shared_library": "lib/libtableauhyperapi.dylib",
    },
}

def _tableauhyperapi_cxx_repository_impl(repository_ctx):
    # Tableau's CDN rejects Bazel's downloader user agent. Fetch with curl,
    # verify the pinned digest, then hand the archive back to Bazel to extract.
    archive = repository_ctx.path("tableauhyperapi-cxx.zip")
    download = repository_ctx.execute([
        "curl",
        "-fsSL",
        "--retry",
        "3",
        "-o",
        str(archive),
        repository_ctx.attr.url,
    ], timeout = 600)
    if download.return_code != 0:
        fail("Failed to download Tableau Hyper API: {}".format(download.stderr))

    verify = repository_ctx.execute([
        "sh",
        "-c",
        "actual=$(if command -v sha256sum >/dev/null; then sha256sum \"$1\" | cut -d' ' -f1; else shasum -a 256 \"$1\" | cut -d' ' -f1; fi); " +
        "test \"$actual\" = \"$2\" || { echo \"sha256 mismatch: expected $2, got $actual\" >&2; exit 1; }",
        "verify-tableauhyperapi",
        str(archive),
        repository_ctx.attr.sha256,
    ])
    if verify.return_code != 0:
        fail("Failed to verify Tableau Hyper API: {}".format(verify.stderr))

    repository_ctx.extract(
        archive = archive,
        stripPrefix = repository_ctx.attr.strip_prefix,
    )
    repository_ctx.delete(archive)

    # Debug symbols and examples make the extracted repository several times
    # larger but are not inputs to the native library.
    repository_ctx.delete("examples")
    repository_ctx.delete("lib/libtableauhyperapi.so.debug")
    repository_ctx.delete("lib/libtableauhyperapi.so.dwp")
    repository_ctx.delete("lib/libtableauhyperapi.dylib.dSYM")

    repository_ctx.file("BUILD.bazel", content = """\
load("@rules_cc//cc:defs.bzl", "cc_import", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_import(
    name = "hyperapi_c",
    shared_library = "{shared_library}",
)

cc_library(
    name = "hyperapi",
    hdrs = glob(["include/hyperapi/**/*.h", "include/hyperapi/**/*.hpp"]),
    includes = ["include"],
    deps = [":hyperapi_c"],
)

filegroup(
    name = "hyperd",
    srcs = ["lib/hyper/hyperd"],
)

filegroup(
    name = "runtime_files",
    srcs = [
        "lib/hyper/hyperd",
        "{shared_library}",
    ],
)

filegroup(
    name = "licenses",
    srcs = [
        "HYPER_API_OSS_disclosure.txt",
        "LICENSE",
        "NOTICES.txt",
    ],
)
""".format(shared_library = repository_ctx.attr.shared_library))

tableauhyperapi_cxx_repository = repository_rule(
    implementation = _tableauhyperapi_cxx_repository_impl,
    doc = "Downloads one platform's Tableau Hyper API C++ archive.",
    attrs = {
        "url": attr.string(mandatory = True),
        "sha256": attr.string(mandatory = True),
        "strip_prefix": attr.string(mandatory = True),
        "shared_library": attr.string(mandatory = True),
    },
)

def _declare_repository(name, platform):
    archive = _CXX_ARCHIVES[platform]
    tableauhyperapi_cxx_repository(
        name = name,
        url = archive["url"],
        sha256 = archive["sha256"],
        strip_prefix = archive["strip_prefix"],
        shared_library = archive["shared_library"],
    )

def _tableauhyperapi_ext_impl(_mctx):
    _declare_repository("tableauhyperapi_cxx_linux_x86_64", "linux_x86_64")
    _declare_repository("tableauhyperapi_cxx_macos_arm64", "macos_arm64")
    _declare_repository("tableauhyperapi_cxx_macos_x86_64", "macos_x86_64")

tableauhyperapi_ext = module_extension(
    implementation = _tableauhyperapi_ext_impl,
)

"""Repository rules for the Trino server and the Java runtime of the Trino integration tests.

The minimal `trino-server-core` tarball carries no connectors. The tpch plugin is unpacked into its
`plugin/` directory, the tpch catalog generates its data on the fly. Trino 484 needs Java 25.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

# renovate: datasource=github-releases depName=trinodb/trino
TRINO_VERSION = "484"

_TRINO_SERVER = {
    "url": "https://github.com/trinodb/trino/releases/download/{v}/trino-server-core-{v}.tar.gz".format(v = TRINO_VERSION),
    "sha256": "fa6773d94c3943eebf3c07859d544b3420d32ea0a01991b803addd0244aff2c8",
    "strip_prefix": "trino-server-core-{v}".format(v = TRINO_VERSION),
}

_TRINO_TPCH = {
    "url": "https://github.com/trinodb/trino/releases/download/{v}/trino-tpch-{v}.zip".format(v = TRINO_VERSION),
    "sha256": "c21c0cc1781da630343efe27088e83a09550695c2cb6ecd0250e6534209cd538",
    "strip_prefix": "trino-tpch-{v}".format(v = TRINO_VERSION),
}

_JRE_RELEASE = "https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8"

_JRE_ARCHIVES = {
    "linux_x86_64": {
        "url": _JRE_RELEASE + "/OpenJDK25U-jre_x64_linux_hotspot_25.0.5_8.tar.gz",
        "sha256": "6fac98f0c8202efc3135a9e9e42aa61963ec42d1c5cbb40caf231e7b14a24ef6",
        "strip_prefix": "jdk-25.0.5+8-jre",
    },
    "macos_arm64": {
        "url": _JRE_RELEASE + "/OpenJDK25U-jre_aarch64_mac_hotspot_25.0.5_8.tar.gz",
        "sha256": "72ebd76b502c849e88dea39afae51baf5f82f2b5b1b6389c28ea707b20451bce",
        "strip_prefix": "jdk-25.0.5+8-jre/Contents/Home",
    },
    "macos_x86_64": {
        "url": _JRE_RELEASE + "/OpenJDK25U-jre_x64_mac_hotspot_25.0.5_8.tar.gz",
        "sha256": "806902c796c670969b7b27df73b8f0fe0924a61bd65083aa53064115e49cab2d",
        "strip_prefix": "jdk-25.0.5+8-jre/Contents/Home",
    },
}

def _trino_server_repository_impl(repository_ctx):
    repository_ctx.download_and_extract(
        url = _TRINO_SERVER["url"],
        sha256 = _TRINO_SERVER["sha256"],
        stripPrefix = _TRINO_SERVER["strip_prefix"],
    )
    repository_ctx.download_and_extract(
        url = _TRINO_TPCH["url"],
        sha256 = _TRINO_TPCH["sha256"],
        stripPrefix = _TRINO_TPCH["strip_prefix"],
        output = "plugin/tpch",
    )
    repository_ctx.file("BUILD.bazel", content = """\
package(default_visibility = ["//visibility:public"])

exports_files(["bin/launcher"])

filegroup(
    name = "server",
    srcs = glob(["**"], exclude = ["BUILD.bazel", "WORKSPACE", "REPO.bazel"]),
)

filegroup(
    name = "licenses",
    srcs = ["NOTICE"],
)
""")

trino_server_repository = repository_rule(
    implementation = _trino_server_repository_impl,
    doc = "Downloads the minimal Trino server and adds the tpch plugin.",
)

_JRE_BUILD = """\
package(default_visibility = ["//visibility:public"])

exports_files(["bin/java"])

filegroup(
    name = "runtime",
    srcs = glob(["**"], exclude = ["BUILD.bazel", "WORKSPACE", "REPO.bazel"]),
)
"""

def _trino_ext_impl(_mctx):
    trino_server_repository(name = "trino_server")
    for platform, archive in _JRE_ARCHIVES.items():
        http_archive(
            name = "temurin_jre_25_" + platform,
            url = archive["url"],
            sha256 = archive["sha256"],
            strip_prefix = archive["strip_prefix"],
            build_file_content = _JRE_BUILD,
        )

trino_ext = module_extension(
    implementation = _trino_ext_impl,
)

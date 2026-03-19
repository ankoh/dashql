"""Repository rule: download tableauhyperapi wheel (Linux x86_64) from PyPI.

The wheel is a zip containing:
  tableauhyperapi/bin/hyper/hyperd          -- hyperd binary
  tableauhyperapi/bin/libtableauhyperapi.so -- shared library

After extraction the rule copies both files to a flat bin/ directory at the
repository root so downstream BUILD rules can reference them at stable paths
regardless of wheel-internal layout.

To update: bump TABLEAUHYPERAPI_VERSION and _WHEEL_SHA256 below.  The wheel
URL is resolved automatically from the PyPI JSON API at fetch time.
Get the new sha256 with:
  curl -s https://pypi.org/pypi/tableauhyperapi/<version>/json | \
    jq -r '.urls[] | select(.filename | contains("manylinux2014_x86_64")) | .digests.sha256'
"""

# renovate: datasource=pypi depName=tableauhyperapi
TABLEAUHYPERAPI_VERSION = "0.0.24457"

_WHEEL_SHA256 = "3f4b4a2004b09c90e5a74a5731afed705c6a6120211a66920fa46416a1cd898a"

_PYPI_META_URL = "https://pypi.org/pypi/tableauhyperapi/{version}/json"
_WHEEL_SUFFIX = "manylinux2014_x86_64.whl"

def _tableauhyperapi_wheel_repository_impl(repository_ctx):
    version = repository_ctx.attr.version
    sha256 = repository_ctx.attr.sha256

    # Resolve the wheel URL from the PyPI JSON API so we only need to
    # hardcode the version and the wheel sha256 (not the opaque hash prefix
    # in the PyPI storage path).
    repository_ctx.download(
        url = _PYPI_META_URL.format(version = version),
        output = "pypi_meta.json",
    )
    meta = json.decode(repository_ctx.read("pypi_meta.json"))

    wheel_url = None
    for entry in meta["urls"]:
        if entry["filename"].endswith(_WHEEL_SUFFIX):
            wheel_url = entry["url"]
            break

    if wheel_url == None:
        fail("No {} wheel found for tableauhyperapi {}".format(_WHEEL_SUFFIX, version))

    repository_ctx.download_and_extract(
        url = wheel_url,
        sha256 = sha256,
        type = "zip",
    )

    # Copy binaries to a flat bin/ directory so downstream rules can reference
    # them at stable, version-independent paths.
    repository_ctx.execute([
        "sh",
        "-c",
        "mkdir -p bin && " +
        "cp tableauhyperapi/bin/hyper/hyperd bin/hyperd && " +
        "chmod 755 bin/hyperd && " +
        "cp tableauhyperapi/bin/libtableauhyperapi.so bin/libtableauhyperapi.so && " +
        "chmod 755 bin/libtableauhyperapi.so",
    ])

    repository_ctx.file("BUILD.bazel", content = """\
load("@rules_pkg//pkg:mappings.bzl", "pkg_attributes", "pkg_files", "strip_prefix")

package(default_visibility = ["//visibility:public"])

filegroup(
    name = "hyperd",
    srcs = ["bin/hyperd"],
)

filegroup(
    name = "libtableauhyperapi_so",
    srcs = ["bin/libtableauhyperapi.so"],
)

# Pre-mapped pkg_files: places both binaries under /opt/hyper/bin with mode 0755.
# Intended for use as a direct src in pkg_tar without any strip_prefix gymnastics
# on the consumer side.
pkg_files(
    name = "hyper_bin_files",
    srcs = [
        "bin/hyperd",
        "bin/libtableauhyperapi.so",
    ],
    prefix = "/opt/hyper/bin",
    strip_prefix = strip_prefix.from_root("bin"),
    attributes = pkg_attributes(mode = "0755"),
)
""")

tableauhyperapi_wheel_repository = repository_rule(
    implementation = _tableauhyperapi_wheel_repository_impl,
    doc = "Downloads the tableauhyperapi Linux x86_64 wheel and exposes hyperd and its shared library.",
    attrs = {
        "version": attr.string(mandatory = True, doc = "tableauhyperapi version, e.g. '0.0.24457'"),
        "sha256": attr.string(mandatory = True, doc = "sha256 of the manylinux2014_x86_64 wheel"),
    },
)

def _tableauhyperapi_ext_impl(mctx):
    tableauhyperapi_wheel_repository(
        name = "tableauhyperapi_wheel",
        version = TABLEAUHYPERAPI_VERSION,
        sha256 = _WHEEL_SHA256,
    )

tableauhyperapi_ext = module_extension(
    implementation = _tableauhyperapi_ext_impl,
)

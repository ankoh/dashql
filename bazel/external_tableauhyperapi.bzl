"""Repository rules: download tableauhyperapi wheels from PyPI.

Each wheel is a zip containing:
  tableauhyperapi/bin/hyper/hyperd                -- hyperd binary
  tableauhyperapi/bin/libtableauhyperapi.{so|dylib} -- shared library

The wheel is fetched per target platform; consumers select() on
@platforms//os and @platforms//cpu to pick the right repo.

To update: bump TABLEAUHYPERAPI_VERSION and the _WHEEL_SHA256_* map below.
Get the new sha256 with:
  curl -s https://pypi.org/pypi/tableauhyperapi/<version>/json | \
    jq -r '.urls[] | .filename + " " + .digests.sha256'
"""

# renovate: datasource=pypi depName=tableauhyperapi
TABLEAUHYPERAPI_VERSION = "0.0.25080"

# Per-platform wheel sha256 digests.
_WHEEL_SHA256 = {
    "linux_x86_64": "38184aa8e723e264f864a0f7e2658ef3c1375c981e01c19a670cb4ab07ad4e3b",
    "macos_x86_64": "eb9ee455cf99662fe49199ffdcfa5126ad1394e418a65fb145d4b801cc07e409",
    "macos_arm64": "ab16896373ad14b79e4ec992ae7e8746cc1af804fd0e36215cd6fd3dbdc19917",
}

# Suffix on the wheel filename that identifies each platform.
_WHEEL_SUFFIX = {
    "linux_x86_64": "manylinux2014_x86_64.whl",
    "macos_x86_64": "macosx_10_11_x86_64.whl",
    "macos_arm64": "macosx_13_0_arm64.whl",
}

# Shared-library filename inside the wheel, per platform.
_SHARED_LIB = {
    "linux_x86_64": "libtableauhyperapi.so",
    "macos_x86_64": "libtableauhyperapi.dylib",
    "macos_arm64": "libtableauhyperapi.dylib",
}

_PYPI_META_URL = "https://pypi.org/pypi/tableauhyperapi/{version}/json"

def _tableauhyperapi_wheel_repository_impl(repository_ctx):
    version = repository_ctx.attr.version
    sha256 = repository_ctx.attr.sha256
    suffix = repository_ctx.attr.wheel_suffix
    shared_lib = repository_ctx.attr.shared_lib

    # Resolve the wheel URL from the PyPI JSON API.
    repository_ctx.download(
        url = _PYPI_META_URL.format(version = version),
        output = "pypi_meta.json",
    )
    meta = json.decode(repository_ctx.read("pypi_meta.json"))

    wheel_url = None
    for entry in meta["urls"]:
        if entry["filename"].endswith(suffix):
            wheel_url = entry["url"]
            break

    if wheel_url == None:
        fail("No {} wheel found for tableauhyperapi {}".format(suffix, version))

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
        "cp tableauhyperapi/bin/" + shared_lib + " bin/" + shared_lib + " && " +
        "chmod 755 bin/" + shared_lib,
    ])

    repository_ctx.file("BUILD.bazel", content = """\
package(default_visibility = ["//visibility:public"])

filegroup(
    name = "hyperd",
    srcs = ["bin/hyperd"],
)

filegroup(
    name = "shared_lib",
    srcs = ["bin/{shared_lib}"],
)

# All runtime files a hyperapi *client* needs: binary + its shared library.
# The hyperd server image (//packages/hyper-docker) uses only :hyperd -- hyperd
# is self-contained and does not link libtableauhyperapi.so.
filegroup(
    name = "hyperd_runfiles",
    srcs = [
        "bin/hyperd",
        "bin/{shared_lib}",
    ],
)
""".format(shared_lib = shared_lib))

tableauhyperapi_wheel_repository = repository_rule(
    implementation = _tableauhyperapi_wheel_repository_impl,
    doc = "Downloads a single tableauhyperapi wheel and exposes hyperd and its shared library.",
    attrs = {
        "version": attr.string(mandatory = True, doc = "tableauhyperapi version, e.g. '0.0.24457'"),
        "sha256": attr.string(mandatory = True, doc = "sha256 of the wheel"),
        "wheel_suffix": attr.string(mandatory = True, doc = "wheel filename suffix, e.g. 'manylinux2014_x86_64.whl'"),
        "shared_lib": attr.string(mandatory = True, doc = "shared library filename inside the wheel"),
    },
)

def _tableauhyperapi_ext_impl(_mctx):
    # Linux x86_64: used by //packages/hyper-docker and by integration tests on
    # Linux CI runners.
    tableauhyperapi_wheel_repository(
        name = "tableauhyperapi_linux_x86_64",
        version = TABLEAUHYPERAPI_VERSION,
        sha256 = _WHEEL_SHA256["linux_x86_64"],
        wheel_suffix = _WHEEL_SUFFIX["linux_x86_64"],
        shared_lib = _SHARED_LIB["linux_x86_64"],
    )

    # macOS arm64: for Apple Silicon dev machines.
    tableauhyperapi_wheel_repository(
        name = "tableauhyperapi_macos_arm64",
        version = TABLEAUHYPERAPI_VERSION,
        sha256 = _WHEEL_SHA256["macos_arm64"],
        wheel_suffix = _WHEEL_SUFFIX["macos_arm64"],
        shared_lib = _SHARED_LIB["macos_arm64"],
    )

    # macOS x86_64: for Intel dev machines.
    tableauhyperapi_wheel_repository(
        name = "tableauhyperapi_macos_x86_64",
        version = TABLEAUHYPERAPI_VERSION,
        sha256 = _WHEEL_SHA256["macos_x86_64"],
        wheel_suffix = _WHEEL_SUFFIX["macos_x86_64"],
        shared_lib = _SHARED_LIB["macos_x86_64"],
    )

tableauhyperapi_ext = module_extension(
    implementation = _tableauhyperapi_ext_impl,
)

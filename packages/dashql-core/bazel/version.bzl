"""Repository rule and module extension: generate version.cc from git describe (no Python, no genrule)."""

def _parse_version(repository_ctx, repo_root):
    """Run git describe and parse into major, minor, patch, dev and version_text."""
    major, minor, patch, dev = 0, 0, 1, 0
    version_text = "0.0.1"

    result = repository_ctx.execute(
        ["git", "describe", "--tags", "--long"],
        working_directory = repo_root,
        timeout = 5,
    )
    if result.return_code != 0:
        return major, minor, patch, dev, version_text

    describe = result.stdout.strip()

    # Get tag for major.minor.patch (e.g. v1.2.3)
    tag_result = repository_ctx.execute(
        ["git", "describe", "--tags", "--abbrev=0"],
        working_directory = repo_root,
        timeout = 5,
    )
    if tag_result.return_code == 0:
        tag = tag_result.stdout.strip()
        # Strip leading 'v' and split "1.2.3"
        digits = tag.lstrip("v").split(".")
        if len(digits) >= 3:
            major = int(digits[0])
            minor = int(digits[1])
            patch = int(digits[2])

    # Parse dev from describe (e.g. v1.2.3-4-gabc -> dev=4)
    parts = describe.split("-")
    if len(parts) >= 2:
        dev = int(parts[1])
        if dev > 0:
            patch += 1
            version_text = "{}.{}.{}-dev.{}".format(major, minor, patch, dev)
        else:
            version_text = "{}.{}.{}".format(major, minor, patch)
    else:
        version_text = "{}.{}.{}".format(major, minor, patch)

    return major, minor, patch, dev, version_text

def _dashql_version_repository_impl(repository_ctx):
    # Resolve main repo root from a label we know is in the main repo (template is at packages/dashql-core/cmake/version.cc.tpl)
    template_path = repository_ctx.path(Label("//packages/dashql-core:bazel/version.cc.tpl"))
    repo_root = str(template_path.dirname.dirname.dirname.dirname)

    major, minor, patch, dev, version_text = _parse_version(repository_ctx, repo_root)

    content = repository_ctx.read(template_path)
    content = (
        content.replace("@DASHQL_VERSION@", version_text)
        .replace("@DASHQL_VERSION_MAJOR@", str(major))
        .replace("@DASHQL_VERSION_MINOR@", str(minor))
        .replace("@DASHQL_VERSION_PATCH@", str(patch))
        .replace("@DASHQL_VERSION_DEV@", str(dev))
    )
    repository_ctx.file("version.cc", content)
    repository_ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["version.cc"])
""")

dashql_core_version_repository = repository_rule(
    implementation = _dashql_version_repository_impl,
    doc = "Generates version.cc from git describe; no Python or genrule.",
)

def _dashql_core_version_ext_impl(mctx):
    dashql_core_version_repository(name = "dashql_core_version")

dashql_core_version_ext = module_extension(
    implementation = _dashql_core_version_ext_impl,
)

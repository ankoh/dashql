"""Repository rule and module extension: generate version.env from git describe for dashql-compute Rust build."""

def _parse_version(repository_ctx, repo_root):
    """Run git describe and parse into major, minor, patch, dev and version_text."""
    major, minor, patch, dev = 0, 0, 1, 0
    version_text = "0.0.1"
    commit = "unknown"

    result = repository_ctx.execute(
        ["git", "describe", "--tags", "--long"],
        working_directory = repo_root,
        timeout = 5,
    )
    if result.return_code != 0:
        return major, minor, patch, dev, version_text, commit

    describe = result.stdout.strip()

    # Get tag for major.minor.patch (e.g. v1.2.3)
    tag_result = repository_ctx.execute(
        ["git", "describe", "--tags", "--abbrev=0"],
        working_directory = repo_root,
        timeout = 5,
    )
    if tag_result.return_code == 0:
        tag = tag_result.stdout.strip()
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

    if len(parts) >= 3:
        commit = parts[2].lstrip("g")

    return major, minor, patch, dev, version_text, commit

def _dashql_compute_version_repository_impl(repository_ctx):
    # Resolve repo root from this file's label (packages/dashql-compute/bazel/version.bzl -> 4 levels up)
    template_path = repository_ctx.path(Label("//packages/dashql-compute:bazel/version.bzl"))
    repo_root = str(template_path.dirname.dirname.dirname.dirname)

    major, minor, patch, dev, version_text, commit = _parse_version(repository_ctx, repo_root)

    env_content = """DASHQL_VERSION_MAJOR={major}
DASHQL_VERSION_MINOR={minor}
DASHQL_VERSION_PATCH={patch}
DASHQL_VERSION_DEV={dev}
DASHQL_VERSION_COMMIT={commit}
DASHQL_VERSION_TEXT={version_text}
""".format(
        major = major,
        minor = minor,
        patch = patch,
        dev = dev,
        commit = commit,
        version_text = version_text,
    )

    repository_ctx.file("version.env", env_content)
    repository_ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["version.env"])
""")

dashql_compute_version_repository = repository_rule(
    implementation = _dashql_compute_version_repository_impl,
    doc = "Generates version.env from git describe for Rust compile-time env.",
)

def _dashql_compute_version_ext_impl(mctx):
    dashql_compute_version_repository(name = "dashql_compute_version")

dashql_compute_version_ext = module_extension(
    implementation = _dashql_compute_version_ext_impl,
)

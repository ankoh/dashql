"""Repository rule and module extension: generate version.env from canonical git->semver parser."""

load("//bazel:versioning.bzl", "parse_dashql_git_version")

def _dashql_compute_version_repository_impl(repository_ctx):
    # Resolve repo root from this file's label (packages/dashql-compute/bazel/version.bzl -> 4 levels up)
    template_path = repository_ctx.path(Label("//packages/dashql-compute:bazel/version.bzl"))
    repo_root = str(template_path.dirname.dirname.dirname.dirname)

    version = parse_dashql_git_version(repository_ctx, repo_root)

    env_content = """DASHQL_VERSION_MAJOR={major}
DASHQL_VERSION_MINOR={minor}
DASHQL_VERSION_PATCH={patch}
DASHQL_VERSION_DEV={dev}
DASHQL_VERSION_COMMIT={commit}
DASHQL_VERSION_TEXT={version_text}
""".format(
        major = version.major,
        minor = version.minor,
        patch = version.patch,
        dev = version.dev,
        commit = version.commit,
        version_text = version.version_text,
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

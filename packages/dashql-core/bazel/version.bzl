"""Repository rule and module extension: generate version.cc from canonical git->semver parser."""

load("//bazel:versioning.bzl", "parse_dashql_git_version")

def _dashql_version_repository_impl(repository_ctx):
    # Resolve main repo root from a label we know is in the main repo (template is at packages/dashql-core/cmake/version.cc.tpl)
    template_path = repository_ctx.path(Label("//packages/dashql-core:bazel/version.cc.tpl"))
    repo_root = str(template_path.dirname.dirname.dirname.dirname)

    version = parse_dashql_git_version(repository_ctx, repo_root)

    content = repository_ctx.read(template_path)
    content = (
        content.replace("@DASHQL_VERSION@", version.version_text)
        .replace("@DASHQL_VERSION_MAJOR@", str(version.major))
        .replace("@DASHQL_VERSION_MINOR@", str(version.minor))
        .replace("@DASHQL_VERSION_PATCH@", str(version.patch))
        .replace("@DASHQL_VERSION_DEV@", str(version.dev))
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

"""Repository rule and module extension: generate version.env for Vite/shell consumers."""

load("//bazel:versioning.bzl", "parse_dashql_git_version")

def _dashql_app_version_repository_impl(repository_ctx):
    # Resolve repo root from this file's label (packages/dashql-app/bazel/version.bzl -> 4 levels up)
    template_path = repository_ctx.path(Label("//packages/dashql-app:bazel/version.bzl"))
    repo_root = str(template_path.dirname.dirname.dirname.dirname)

    # Watch git state so Bazel re-evaluates this rule when HEAD or tags change.
    git_dir = repository_ctx.path(repo_root + "/.git")
    repository_ctx.watch(git_dir.get_child("HEAD"))
    packed_refs = git_dir.get_child("packed-refs")
    if packed_refs.exists:
        repository_ctx.watch(packed_refs)

    version = parse_dashql_git_version(repository_ctx, repo_root)

    # KEY=VALUE pairs consumed by dashql-app genrules via awk substitution.
    repository_ctx.file("version.env", """DASHQL_VERSION_MAJOR={major}
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
    ))

    repository_ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["version.env"])
""")

dashql_app_version_repository = repository_rule(
    implementation = _dashql_app_version_repository_impl,
    doc = "Generates version.env (KEY=VALUE) from git describe for dashql-app Vite genrules.",
    local = True,
)

def _dashql_app_version_ext_impl(mctx):
    dashql_app_version_repository(name = "dashql_app_version")

dashql_app_version_ext = module_extension(
    implementation = _dashql_app_version_ext_impl,
)

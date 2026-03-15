"""Repository rule and module extension: generate version.rs from canonical git->semver parser.

Outputs:
  version.rs  – Rust source (pub static constants); included by src/version.rs via include!().
"""

load("//bazel:versioning.bzl", "parse_dashql_git_version")

def _dashql_compute_version_repository_impl(repository_ctx):
    # Resolve repo root from this file's label (packages/dashql-compute/bazel/version.bzl -> 4 levels up)
    template_path = repository_ctx.path(Label("//packages/dashql-compute:bazel/version.bzl"))
    repo_root = str(template_path.dirname.dirname.dirname.dirname)

    # Watch git state so Bazel re-evaluates this rule when HEAD or tags change,
    # instead of relying on local=True (which re-runs on every invocation).
    git_dir = repository_ctx.path(repo_root + "/.git")
    repository_ctx.watch(git_dir.get_child("HEAD"))
    packed_refs = git_dir.get_child("packed-refs")
    if packed_refs.exists:
        repository_ctx.watch(packed_refs)

    version = parse_dashql_git_version(repository_ctx, repo_root)

    # Rust source: included by src/version.rs via include!(concat!(env!("OUT_DIR"), "/version.rs")).
    repository_ctx.file("version.rs", """// @generated — do not edit. Produced by packages/dashql-compute/bazel/version.bzl.
pub static DASHQL_VERSION_MAJOR: u32 = {major};
pub static DASHQL_VERSION_MINOR: u32 = {minor};
pub static DASHQL_VERSION_PATCH: u32 = {patch};
pub static DASHQL_VERSION_DEV: u32 = {dev};
pub static DASHQL_VERSION_COMMIT: &str = "{commit}";
pub static DASHQL_VERSION_TEXT: &str = "{version_text}";
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
exports_files(["version.rs"])
""")

dashql_compute_version_repository = repository_rule(
    implementation = _dashql_compute_version_repository_impl,
    doc = "Generates version.rs (pub static Rust constants) from git describe.",
    local = True,
)

def _dashql_compute_version_ext_impl(mctx):
    dashql_compute_version_repository(name = "dashql_compute_version")

dashql_compute_version_ext = module_extension(
    implementation = _dashql_compute_version_ext_impl,
)

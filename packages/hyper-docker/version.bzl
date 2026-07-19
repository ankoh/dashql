"""Repository rule: resolve the hyperd binary and the Docker image repo_tag.

Exposes two targets in @hyperd_image:
  :hyperd         -- the hyperd binary to bake into the image
  :repo_tags.txt  -- the single repo_tag for oci_load

Binary source:
  Default: hyperd from the pinned tableauhyperapi wheel.
  Override: set HYPERD_BINARY to an absolute path to inject a one-off binary,
            e.g. a locally built hyperd:
              HYPERD_BINARY=/abs/path/to/hyperd \
                bazel run //packages/hyper-docker:load_image

Tag scheme (Option A -- pre-release convention, matches //bazel:versioning.bzl):
  Release (no override): ankoh/hyperdb:<wheel>
  One-off  (override):   ankoh/hyperdb:<wheel>-dev.g<sha>
  A one-off image carries the short git SHA so it sorts next to the release tag
  but can never be mistaken for it.
"""

load("//bazel:external_tableauhyperapi.bzl", "TABLEAUHYPERAPI_VERSION")

_IMAGE_REPO = "ankoh/hyperdb"

def _hyperd_image_repository_impl(repository_ctx):
    override = repository_ctx.os.environ.get("HYPERD_BINARY", "").strip()

    if override:
        src = repository_ctx.path(override)
        if not src.exists:
            fail("HYPERD_BINARY is set to '{}' but that file does not exist.".format(override))
        repository_ctx.symlink(src, "hyperd")
    else:
        # Resolve the wheel's flat-copied hyperd (bin/hyperd). Anchor on the
        # wheel repo's BUILD file and append the real path -- path(Label) on the
        # :hyperd filegroup would resolve to the label name, not the source.
        wheel_root = repository_ctx.path(Label("@tableauhyperapi_linux_x86_64//:BUILD.bazel")).dirname
        repository_ctx.symlink(wheel_root.get_child("bin").get_child("hyperd"), "hyperd")

    # Resolve repo root from this file's label for git queries.
    # packages/hyper-docker/version.bzl -> 3 levels up to the workspace root.
    self_path = repository_ctx.path(Label("//packages/hyper-docker:version.bzl"))
    repo_root = str(self_path.dirname.dirname.dirname)

    # Watch git state so Bazel re-evaluates when HEAD or refs change.
    git_dir = repository_ctx.path(repo_root + "/.git")
    repository_ctx.watch(git_dir.get_child("HEAD"))
    packed_refs = git_dir.get_child("packed-refs")
    if packed_refs.exists:
        repository_ctx.watch(packed_refs)

    if override:
        sha = "unknown"
        sha_result = repository_ctx.execute(
            ["git", "rev-parse", "--short=9", "HEAD"],
            working_directory = repo_root,
            timeout = 5,
        )
        if sha_result.return_code == 0:
            sha = sha_result.stdout.strip()

        repo_tag = "{repo}:{version}-dev.g{sha}".format(
            repo = _IMAGE_REPO,
            version = TABLEAUHYPERAPI_VERSION,
            sha = sha,
        )
    else:
        repo_tag = "{repo}:{version}".format(
            repo = _IMAGE_REPO,
            version = TABLEAUHYPERAPI_VERSION,
        )

    repository_ctx.file("repo_tags.txt", repo_tag + "\n")
    repository_ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])

filegroup(
    name = "hyperd_bin",
    srcs = ["hyperd"],
)

exports_files(["hyperd", "repo_tags.txt"])
""")

hyperd_image_repository = repository_rule(
    implementation = _hyperd_image_repository_impl,
    doc = "Resolves the hyperd binary (wheel or HYPERD_BINARY override) and the image repo_tag.",
    local = True,
    environ = ["HYPERD_BINARY"],
)

def _hyperd_image_ext_impl(_mctx):
    hyperd_image_repository(name = "hyperd_image")

hyperd_image_ext = module_extension(
    implementation = _hyperd_image_ext_impl,
)

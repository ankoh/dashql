"""Repository rule that writes the version of DashQL from git describe into version.env."""

# The output of `git describe --tags --long` that CI determines once per workflow run and gives every job, so that all
# jobs of a run build the same version, even when a tag arrives while it runs (see .github/workflows/build_trusted.yml)
DESCRIBE_ENV = "DASHQL_GIT_DESCRIBE"

def _dashql_app_version_repository_impl(repository_ctx):
    repo_root = str(repository_ctx.path(Label("//:MODULE.bazel")).dirname)

    # Watch git state so Bazel re-evaluates this rule when HEAD or tags change.
    git_dir = repository_ctx.path(repo_root + "/.git")
    repository_ctx.watch(git_dir.get_child("HEAD"))
    packed_refs = git_dir.get_child("packed-refs")
    if packed_refs.exists:
        repository_ctx.watch(packed_refs)

    # getenv makes the repository rule run again when the variable changes
    describe = (repository_ctx.getenv(DESCRIBE_ENV) or "").strip()
    if describe == "":
        describe_result = repository_ctx.execute(
            ["git", "describe", "--tags", "--long"],
            working_directory = repo_root,
            timeout = 5,
        )
        if describe_result.return_code == 0:
            describe = describe_result.stdout.strip()

    # <tag>-<commits since the tag>-g<commit>, the tag is v<major>.<minor>.<patch>. A build between tags is a
    # prerelease of the next patch.
    version = "0.0.1"
    commit = "unknown"
    dev = 0
    if describe != "":
        parts = describe.rsplit("-", 2)
        major, minor, patch = 0, 0, 1
        digits = parts[0].lstrip("v").split(".")
        if len(digits) >= 3:
            major = int(digits[0])
            minor = int(digits[1])
            patch = int(digits[2])
        if len(parts) >= 2:
            dev = int(parts[1])
        if dev > 0:
            version = "{}.{}.{}-dev.{}".format(major, minor, patch + 1, dev)
        else:
            version = "{}.{}.{}".format(major, minor, patch)
        if len(parts) >= 3:
            commit = parts[2].lstrip("g")

    # The version of the packages on npm: a build between tags adds its commit, the same number of commits since the
    # tag can belong to another commit on the branch dev, and a version on npm is published once
    npm_version = version
    if dev > 0 and commit != "unknown":
        npm_version = "{}.g{}".format(version, commit)

    # KEY=VALUE pairs that the genrules and package_macos.sh read with awk
    repository_ctx.file("version.env", """DASHQL_VERSION_COMMIT={commit}
DASHQL_VERSION_TEXT={version}
DASHQL_VERSION_NPM={npm_version}
""".format(commit = commit, version = version, npm_version = npm_version))

    repository_ctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["version.env"])
""")

dashql_app_version_repository = repository_rule(
    implementation = _dashql_app_version_repository_impl,
    doc = "Generates version.env (KEY=VALUE) from git describe for the genrules of the packages.",
    local = True,
)

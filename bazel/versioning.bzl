"""Shared git->semver parsing for DashQL Bazel version generation."""

# The output of `git describe --tags --long` that CI determines once per workflow run and gives every job, so that all
# jobs of a run build the same version, even when a tag arrives while it runs (see .github/workflows/build_trusted.yml)
DESCRIBE_ENV = "DASHQL_GIT_DESCRIBE"

def parse_dashql_git_version(repository_ctx, repo_root):
    """Return parsed version fields preserving current DashQL semver behavior."""
    major, minor, patch, dev = 0, 0, 1, 0
    version_text = "0.0.1"
    commit = "unknown"

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
    if describe == "":
        return struct(
            major = major,
            minor = minor,
            patch = patch,
            dev = dev,
            version_text = version_text,
            commit = commit,
        )

    # <tag>-<commits since the tag>-g<commit>, the tag is v<major>.<minor>.<patch>
    parts = describe.rsplit("-", 2)
    digits = parts[0].lstrip("v").split(".")
    if len(digits) >= 3:
        major = int(digits[0])
        minor = int(digits[1])
        patch = int(digits[2])

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

    return struct(
        major = major,
        minor = minor,
        patch = patch,
        dev = dev,
        version_text = version_text,
        commit = commit,
    )

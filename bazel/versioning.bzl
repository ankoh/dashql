"""Shared git->semver parsing for DashQL Bazel version generation."""

def parse_dashql_git_version(repository_ctx, repo_root):
    """Return parsed version fields preserving current DashQL semver behavior."""
    major, minor, patch, dev = 0, 0, 1, 0
    version_text = "0.0.1"
    commit = "unknown"

    describe_result = repository_ctx.execute(
        ["git", "describe", "--tags", "--long"],
        working_directory = repo_root,
        timeout = 5,
    )
    if describe_result.return_code != 0:
        return struct(
            major = major,
            minor = minor,
            patch = patch,
            dev = dev,
            version_text = version_text,
            commit = commit,
        )

    describe = describe_result.stdout.strip()

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

    return struct(
        major = major,
        minor = minor,
        patch = patch,
        dev = dev,
        version_text = version_text,
        commit = commit,
    )

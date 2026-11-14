"""The agent harnesses of the agent integration tests (//tests/agents).

npm ships each harness as a native binary in a package per platform. The tests download that package, verified with
the integrity that npm publishes, and run the binary directly, without the wrapper package and its postinstall.
Only the agent integration tests depend on them, so they are fetched on first use.

To move to another version, set the version and take the integrity of each platform from
`npm view @anthropic-ai/claude-code-<platform>@<version> dist.integrity` and
`npm view @openai/codex@<version>-<platform> dist.integrity`.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

CLAUDE_CODE_VERSION = "2.1.325"

# Bazel platform -> (npm platform, integrity of the package)
_CLAUDE_CODE = {
    "linux_x86_64": ("linux-x64", "sha512-BqZzMvP/zgLLL34S+7OzbG+cyoFp7gwWHU5koVwsyMlTAz+0zZAmbY+UkzvtN2RXxp6AcMenbYIjQJxoXfUY3w=="),
    "macos_arm64": ("darwin-arm64", "sha512-Ds1f1B+qy2BWDI+VnmDHwkNyTbXCwFrBtrinPD95RBmUubFJu9nCzMgn+wrg5VwwF6vtkkzGexogneZIYZKb6A=="),
}

CODEX_VERSION = "0.169.0"

# Bazel platform -> (npm platform, target triple, integrity of the package)
_CODEX = {
    "linux_x86_64": ("linux-x64", "x86_64-unknown-linux-musl", "sha512-o05NyAOCDygSPRo1yinzxvkRSdmsZyBD9E7mbpmjRanSfM8lypqWtQgEo4XfNkwhuCR2aFu8mlGOsQGFXVbVww=="),
    "macos_arm64": ("darwin-arm64", "aarch64-apple-darwin", "sha512-5WsWFBbVP78D+6FvNo1MMVxLPZdmcoQlqVJFrF4qx/TmvneLnMQKtLyXkUo54XOTDfoYKpNouTJ/F7gTVA8FnQ=="),
}

# Codex finds its resources (e.g. the bubblewrap of its sandbox on Linux) next to its binary, a test needs them all
_CODEX_BUILD = """\
package(default_visibility = ["//visibility:public"])

exports_files(["vendor/{triple}/bin/codex"])

filegroup(
    name = "files",
    srcs = glob(["vendor/**"]),
)
"""

_BUILD = """\
package(default_visibility = ["//visibility:public"])

exports_files(["{binary}"])

filegroup(
    name = "licenses",
    srcs = ["LICENSE.md"],
)
"""

def _agent_harnesses_ext_impl(_mctx):
    for platform, (npm_platform, integrity) in _CLAUDE_CODE.items():
        http_archive(
            name = "claude_code_" + platform,
            url = "https://registry.npmjs.org/@anthropic-ai/claude-code-{p}/-/claude-code-{p}-{v}.tgz".format(
                p = npm_platform,
                v = CLAUDE_CODE_VERSION,
            ),
            integrity = integrity,
            strip_prefix = "package",
            build_file_content = _BUILD.format(binary = "claude"),
        )
    for platform, (npm_platform, triple, integrity) in _CODEX.items():
        http_archive(
            name = "codex_" + platform,
            url = "https://registry.npmjs.org/@openai/codex/-/codex-{v}-{p}.tgz".format(
                p = npm_platform,
                v = CODEX_VERSION,
            ),
            integrity = integrity,
            strip_prefix = "package",
            build_file_content = _CODEX_BUILD.format(triple = triple),
        )

agent_harnesses_ext = module_extension(
    implementation = _agent_harnesses_ext_impl,
)

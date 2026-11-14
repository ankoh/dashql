"""The agent harnesses of the agent integration tests (//tests/agents).

npm ships each harness as a native binary in a package per platform. The tests download that package, verified with
the integrity that npm publishes, and run the binary directly, without the wrapper package and its postinstall.
Only the agent integration tests depend on them, so they are fetched on first use.

To move to another version, set the version and take the integrity of each platform from
`npm view @anthropic-ai/claude-code-<platform>@<version> dist.integrity`.
"""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

CLAUDE_CODE_VERSION = "2.1.325"

# Bazel platform -> (npm platform, integrity of the package)
_CLAUDE_CODE = {
    "linux_x86_64": ("linux-x64", "sha512-BqZzMvP/zgLLL34S+7OzbG+cyoFp7gwWHU5koVwsyMlTAz+0zZAmbY+UkzvtN2RXxp6AcMenbYIjQJxoXfUY3w=="),
    "macos_arm64": ("darwin-arm64", "sha512-Ds1f1B+qy2BWDI+VnmDHwkNyTbXCwFrBtrinPD95RBmUubFJu9nCzMgn+wrg5VwwF6vtkkzGexogneZIYZKb6A=="),
}

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

agent_harnesses_ext = module_extension(
    implementation = _agent_harnesses_ext_impl,
)

# Agent Integration Tests

Status: the first test is built (Claude Code, sandbox and hooks), the rest is proposed.

The integrations with agent harnesses rest on assumptions about their sandboxes: what a command of the agent can
reach, where hooks run, what an approval by prefix allows. These tests run the real harnesses with a fake model, so
they check those assumptions on every machine that runs them, without model calls and in CI.
`//packages/dashql-cli:bridge_harness_test` stays for the behavior of real models (manual, costs model calls).

| Part | State |
|---|---|
| Harness binaries from npm, pinned and verified (`//bazel:external_agent_harnesses.bzl`) | Claude Code |
| Fake Messages API of Anthropic (`tests/agents/fake_anthropic.mjs`) | Done |
| `//tests/agents:claude_code_sandbox_test`: loopback from a command with and without the sandbox, and from hooks | Done |
| Approvals by prefix, `session serve` from `SessionStart`, the `dashql` commands of the agent | Planned |
| Codex with a fake Responses API, opencode | Planned |
| The job `agent_integration` of `build_trusted.yml` and `build_untrusted.yml` | Added, not yet run on GitHub |

## How it works

- **Harnesses.** npm ships each harness as a native binary in a package per platform
  (`@anthropic-ai/claude-code-linux-x64`, `@openai/codex@<version>-linux-x64`, `opencode-linux-x64`). A module
  extension downloads that package with `http_archive`, verified with the integrity that npm publishes, and the tests
  run the binary directly, without the wrapper package and its postinstall. The harnesses stay out of the
  `package.json` and the lockfile of the app. Only the tests depend on them, so they are fetched on first use.
- **Fake model.** A local server per API. Claude Code takes `ANTHROPIC_BASE_URL` and any key. A test scripts the turns
  of the main conversation (the requests that offer the tool `Bash`), e.g. a call of a command and then a final text;
  every other request (titles, summaries, token counts) gets a short answer. The server records every request, so a
  test sees the tool results that the harness sent back: what really happened inside the sandbox.
- **Isolation.** Each run gets its own `HOME`, a fixed `PATH`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` and
  `DISABLE_AUTOUPDATER`. Managed settings of the machine (e.g. `/Library/Application Support/ClaudeCode/`) still apply:
  run locally, the tests report what that machine allows.
- **Bazel.** The tests are `js_test`s tagged `no-sandbox`: the harnesses start their own sandboxes, which don't nest
  in the sandbox of Bazel.

## Findings

Claude Code 2.1.325 on Linux (bubblewrap 0.11.1):

| | Loopback | DNS | Listening | Writing the workspace |
|---|---|---|---|---|
| A command of `Bash`, sandbox on | blocked | blocked | yes, in its own network namespace | yes |
| A command of `Bash`, sandbox off | yes | yes | yes | yes |
| Hooks (`SessionStart`, `PostToolUse`, `Stop`), sandbox on or off | yes | yes | yes | yes |

Hooks run outside the sandbox, so they are the way out of it for the live view: a hook starts `dashql session serve`
and carries the events of the agent to it, while the commands of the agent work on files. The test checks loopback;
DNS and listening were checked by hand. Writing outside the workspace isn't checked yet, the `HOME` of the test is
below the temporary folder, which the sandbox may allow.

## Next

- **Claude Code:** an approval by prefix (`--allowedTools "Bash(dashql run:*)"`) lets that command leave the sandbox
  and no other; `session serve` started by `SessionStart` reaches a simulated page; the `dashql` commands of the SDK,
  offline inside the sandbox.
- **Codex:** a fake of the Responses API (Codex takes a `model_provider` with a `base_url`), the sandbox modes
  (`read-only`, `workspace-write` with and without network), hooks, and prefix rules of its execution policy.
- **opencode:** its plugins run in its process and see every event.
- **CI:** the job `agent_integration` installs `bubblewrap` and `socat` on `ubuntu-26.04`, lifts the restriction of
  unprivileged user namespaces of Ubuntu, and runs `bazel test //tests/agents/...`. A macOS job could follow, the
  sandbox of Claude Code uses `sandbox-exec` there, which every Mac has.
- **Versions:** a newer harness is a new version and new integrity values in `//bazel:external_agent_harnesses.bzl`
  (`npm view @anthropic-ai/claude-code-<platform>@<version> dist.integrity`). Testing two versions side by side is a
  second repository per platform.

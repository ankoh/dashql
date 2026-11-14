# Agent Integration Tests

Status: Claude Code and Codex are tested (sandbox, hooks, rules of Codex), the rest is proposed.

The integrations with agent harnesses rest on assumptions about their sandboxes: what a command of the agent can
reach, where hooks run, what an approval by prefix allows. These tests run the real harnesses with a fake model, so
they check those assumptions on every machine that runs them, without model calls and in CI.
`//packages/dashql-cli:bridge_harness_test` stays for the behavior of real models (manual, costs model calls).

| Part | State |
|---|---|
| Harness binaries from npm, pinned and verified (`//bazel:external_agent_harnesses.bzl`) | Claude Code 2.1.325, Codex 0.169.0 |
| Fake Messages API of Anthropic (`tests/agents/fake_anthropic.mjs`), fake Responses API of OpenAI (`tests/agents/fake_openai.mjs`) | Done |
| `//tests/agents:claude_code_sandbox_test`: loopback from a command with and without the sandbox, and from hooks | Done |
| `//tests/agents:codex_sandbox_test`: `workspace-write`, hooks in `workspace-write` and `read-only`, an `allow` rule, a request to escalate | Done |
| Approvals by prefix in Claude Code, `session serve` from `SessionStart`, the `dashql` commands of the agent | Planned |
| opencode | Planned |
| The job `agent_integration` of `build_trusted.yml` and `build_untrusted.yml` | Added, not yet run on GitHub |

## How it works

- **Harnesses.** npm ships each harness as a native binary in a package per platform
  (`@anthropic-ai/claude-code-linux-x64`, `@openai/codex@<version>-linux-x64`, `opencode-linux-x64`). A module
  extension downloads that package with `http_archive`, verified with the integrity that npm publishes, and the tests
  run the binary directly, without the wrapper package and its postinstall. The harnesses stay out of the
  `package.json` and the lockfile of the app. Only the tests depend on them, so they are fetched on first use.
- **Fake model.** A local server per API. Claude Code takes `ANTHROPIC_BASE_URL` and any key, Codex a
  `model_provider` with a `base_url` in the `config.toml` of its `CODEX_HOME`. A test scripts the turns
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

Codex 0.169.0 on Linux (its own bubblewrap), a command of `exec_command` in `codex exec`:

| | Loopback | DNS | Writing the workspace |
|---|---|---|---|
| `read-only` | blocked | blocked | blocked |
| `workspace-write` | blocked | blocked | yes |
| `workspace-write` with `sandbox_workspace_write.network_access = true` | yes | yes | yes |
| `danger-full-access` | yes | yes | yes |
| a command that a `prefix_rule(..., decision = "allow")` of `$CODEX_HOME/rules/` matches, in `workspace-write` | yes | yes | yes |

The test asserts loopback in `workspace-write`, the hooks, the rule and the request to escalate; DNS, writing and the
other modes were checked by hand.

- **Hooks of Codex** run outside the sandbox as well, in `read-only` too. Codex skips a hook of a user until the user
  trusted it in `/hooks` (the trust is recorded against its hash), without a message. A test passes
  `--dangerously-bypass-hook-trust`; a plugin needs that one trust per user, unless the hooks are managed.
- **An `allow` rule** lets the matching command run outside the sandbox, without approval and without a request to
  escalate. That is the rule that "always" writes when a user approves a command in the terminal.
- **A request to escalate** (`sandbox_permissions = "require_escalated"`) fails in `codex exec`, whose approval policy
  is `Never`: the model gets "approval policy is Never; reject command", with or without a rule. The skill should
  never ask Codex to escalate `dashql run`, it should rely on the rule.

Hooks run outside the sandbox in both harnesses, so they are the way out of it for the live view: a hook starts `dashql session serve`
and carries the events of the agent to it, while the commands of the agent work on files. The test checks loopback;
DNS and listening were checked by hand. Writing outside the workspace isn't checked yet, the `HOME` of the test is
below the temporary folder, which the sandbox may allow.

## Next

- **Claude Code:** an approval by prefix (`--allowedTools "Bash(dashql run:*)"`) lets that command leave the sandbox
  and no other; `session serve` started by `SessionStart` reaches a simulated page; the `dashql` commands of the SDK,
  offline inside the sandbox.
- **opencode:** its plugins run in its process and see every event.
- **CI:** the job `agent_integration` installs `bubblewrap` and `socat` on `ubuntu-26.04`, lifts the restriction of
  unprivileged user namespaces of Ubuntu, and runs `bazel test //tests/agents/...`. A macOS job could follow, the
  sandbox of Claude Code uses `sandbox-exec` there, which every Mac has.
- **Versions:** a newer harness is a new version and new integrity values in `//bazel:external_agent_harnesses.bzl`
  (`npm view @anthropic-ai/claude-code-<platform>@<version> dist.integrity`). Testing two versions side by side is a
  second repository per platform.

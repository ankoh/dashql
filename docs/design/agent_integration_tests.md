# Agent Integration Tests

The integrations with agent harnesses rest on assumptions about their sandboxes: what a command of the agent can
reach and what an approval by prefix allows. The tests in `//tests/agents` run the real harnesses, Claude Code and
Codex, with a fake model, so they check those assumptions on every machine that runs them, without model calls and in
CI: the sandbox, the ways out of the sandbox, and a question as the desktop app runs it
([agent_integration.md](agent_integration.md)). opencode is planned.

| Part | State |
|---|---|
| Harness binaries from npm, pinned and verified (`//bazel:external_agent_harnesses.bzl`) | Claude Code 2.1.325, Codex 0.169.0 |
| Fake Messages API of Anthropic (`tests/agents/fake_anthropic.mjs`), fake Responses API of OpenAI (`tests/agents/fake_openai.mjs`) | Done |
| `//tests/agents:claude_code_sandbox_test`: loopback from a command with and without the sandbox, `excludedCommands`, a request to leave the sandbox with and without a rule; a question that the app runs: the calls of `dashql scripts` and `dashql edit --file input/…` reach the page, the guide in the system prompt, other commands refused, the next question resumes | Done |
| `//tests/agents:codex_sandbox_test`: loopback in `workspace-write`, an `allow` rule, a request to escalate; a question that the app runs: the calls reach the page with the network of `workspace-write`, `AGENTS.md`, the next question resumes | Done |
| `//tests/agents:hyperdb_edge_claude_code_test` and `hyperdb_edge_codex_test`: hyperdb-edge in both sandboxes, see [hyperdb_edge.md](../wip/hyperdb_edge.md#harness-tests) | Done |
| `//tests/agents:hyperdb_edge_tool_runner_test` and `hyperdb_edge_agent_sdk_test`: the tools of hyperdb-edge in the Tool Runner and the Claude Agent SDK, see [hyperdb_edge.md](../wip/hyperdb_edge.md#in-process-tools). The fake Messages API follows the message threads of the Tool Runner | Done |
| A question through `AgentHost` of `packages/dashql-native` (compiled, without Electron) with a fake page (`tests/agents/dashql_app.mjs`) that answers the calls of the Rust `dashql` | Done |
| A question in Electron through the IPC of the page | Planned |
| opencode | Planned |
| The job `agent_integration` of `build_trusted.yml` and `build_untrusted.yml` | Added; the first run on GitHub failed on AppArmor (see [Findings](#findings)), the fix not yet run |

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

The test asserts loopback in `workspace-write`, the rule and the request to escalate; DNS, writing and the other modes
were checked by hand.

- **An `allow` rule** lets the matching command run outside the sandbox, without approval and without a request to
  escalate. That is the rule that "always" writes when a user approves a command in the terminal.
- **A request to escalate** (`sandbox_permissions = "require_escalated"`) fails in `codex exec`, whose approval policy
  is `Never`: the model gets "approval policy is Never; reject command", with or without a rule. An agent should
  never ask Codex to escalate `dashql run`, it should rely on the rule.

Claude Code, the ways out of the sandbox for one command:

| | Result |
|---|---|
| The command in `sandbox.excludedCommands` | runs outside the sandbox |
| `dangerouslyDisableSandbox: true` from the model, `--allowedTools Bash` | refused: "Run outside of the sandbox" |
| `dangerouslyDisableSandbox: true` from the model, a rule `Bash(<command>:*)` | runs outside the sandbox |
| `dangerouslyDisableSandbox: true` with `sandbox.allowUnsandboxedCommands = false` | ignored, runs in the sandbox |
| `allowed_domains: ["127.0.0.1"]` from the model | loopback stays blocked |

Every `dashql` command calls the app on loopback. The app runs Codex in `workspace-write` with the network on, its
sandbox can't allow only loopback. Claude Code in `-p` runs a command in its sandbox only when the settings of the user
turn the sandbox on; then `dashql` needs `sandbox.excludedCommands` or a rule for it, see Open of
[agent_integration.md](agent_integration.md#open).

**AppArmor on Ubuntu.** Ubuntu confines `/usr/bin/bwrap` with the profiles `bwrap` and `unpriv_bwrap`
(`/etc/apparmor.d/bwrap-userns-restrict`): a child of bwrap may create a user namespace but gets no capabilities in
it. The seccomp helper of Claude Code creates one inside the sandbox, so every command in the sandbox fails with
`apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide
CAP_SYS_ADMIN): Permission denied`, while commands outside the sandbox and hooks work. Setting
`kernel.apparmor_restrict_unprivileged_userns=0` doesn't help, the profiles attach to the path of bwrap. Codex brings
its own bubblewrap and isn't affected. The CI job removes the two profiles; a user of Ubuntu needs the same, or a rule in
`/etc/apparmor.d/local/unpriv_bwrap`.

The app reads the events of a turn from the output of the harness, it needs no hooks. The test checks loopback; DNS
and listening were checked by hand. Writing outside the workspace isn't checked yet, the `HOME` of the test is
below the temporary folder, which the sandbox may allow.

## Next

- **Electron:** a question through the IPC of a window, with a fake harness on the `PATH` that calls `dashql edit`.
- **opencode:** its plugins run in its process and see every event.
- **CI:** the job `agent_integration` installs `bubblewrap` and `socat` on `ubuntu-26.04`, lifts the restriction of
  unprivileged user namespaces of Ubuntu, removes the AppArmor profiles `bwrap` and `unpriv_bwrap`, and runs
  `bazel test //tests/agents/...`. A macOS job could follow, the
  sandbox of Claude Code uses `sandbox-exec` there, which every Mac has.
- **Versions:** a newer harness is a new version and new integrity values in `//bazel:external_agent_harnesses.bzl`
  (`npm view @anthropic-ai/claude-code-<platform>@<version> dist.integrity`). Testing two versions side by side is a
  second repository per platform.

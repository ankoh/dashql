# Agent Sessions

Status: the agent bridge is removed; the page shows the session of an agent once `dashql session serve` exists.

An agent works on DashQL from a harness in the terminal, Claude Code or Codex, with the Node `dashql` on the SDK
(`docs/wip/dashql_sdk.md`). The page of DashQL only watches. There is no agent server that the page asks, no agent
access per workbook and no prompt in natural language.

## The session

- **Hooks carry the events.** A `SessionStart` hook of the harness starts `dashql session serve` on loopback, the
  hooks of `UserPromptSubmit`, `PostToolUse` and `Stop` send their events to it, and the page reads them from there.
  Hooks run outside the sandbox of both harnesses, the commands of the agent inside it don't need the server:
  `//tests/agents` checks both (`docs/wip/agent_integration_tests.md`).
- **The agent works on files.** Its commands (`dashql workbook check`, `lint`, …) read and write the workbook folder
  offline. The page follows the folder.
- **The page watches.** The questions come from the terminal, and the terminal stops the agent.

## The page

`packages/dashql-app/src/agent/agent_session.ts` holds the model: an `AgentSession` with the harness, its folder,
whether the page still reaches it, and its turns (the question, the status line, the final message or the error, and
the scripts the agent wrote). `useAgentSession` returns null until `dashql session serve` exists.

| Event | What the page shows |
|---|---|
| `UserPromptSubmit` | A new turn with the question; the feed follows the agent again |
| `PostToolUse` | The status line of the turn, the scripts the agent wrote; the feed follows the agent to a script it edits or runs |
| `Stop` | The final message of the turn |

- **The bar of Wobble** shows the harness and its folder at the right end, and the log of the turns in its bubble
  (`agent/agent_prompt_panel.tsx`). A turn can be dismissed, not stopped.
- **The feed** follows the agent to the scripts it edits and runs until the user scrolls, clicks or types in it.
- **The composer** takes SQL only. While a session works on the workbook its prompt is closed, edits of the page
  would race the writes of the agent.
- **Wobble** stays: the greeting of an empty workbook and the face of the bar.

## Next

- `dashql session serve` and the hooks of the plugin of DashQL for Claude Code and Codex.
- How the page finds the session: a link that the `SessionStart` hook prints, like the links of `hyperd run --ui`.
- The browser reaches `127.0.0.1` from `https://dashql.app` only with the permission for the local network of the
  browser; the desktop app reaches it directly.

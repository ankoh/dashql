# Agent Sessions

Status: built. The hooks of Claude Code and Codex reach `dashql session serve`, the page follows the session through a
link. The files of the agent are not yet the workbook of the page.

An agent works on DashQL from a harness in the terminal, Claude Code or Codex, with the Node `dashql` on the SDK
(`docs/wip/dashql_sdk.md`). The page of DashQL only watches. There is no agent server that the page asks, no agent
access per workbook and no prompt in natural language.

## The session

- **Hooks carry the events.** Every hook runs `dashql session hook <event>` (`packages/dashql-cli/README.md` has the
  settings of both harnesses). The first event starts `dashql session serve` on `127.0.0.1` with a token, detached;
  `UserPromptSubmit`, `PostToolUse`, `Stop` and `SessionEnd` go to it, and the page reads them from there.
  `SessionStart` prints the link of the session, `https://dashql.app/?data=` with `{"agentSession": {"endpoint",
  "token"}}`; the harness hands the output of the hook to the agent, which tells the user.
  Hooks run outside the sandbox of both harnesses, the commands of the agent inside it don't need the server:
  `//tests/agents` checks both (`docs/wip/agent_integration_tests.md`).
- **The agent works on files.** Its commands (`dashql workbook check`, `lint`, …) read and write the workbook folder
  offline. The page follows the folder.
- **The page watches.** The questions come from the terminal, and the terminal stops the agent.

## The page

- **The server** (`packages/dashql-cli/src/session_server.ts`) keeps the state that the SDK reduces from the events
  (`session/agent_session_state.ts`): per turn the question, the latest status line, the files the tools named, the
  final message. Hooks post to `/v1/events`, pages read `/v1/stream`, server-sent events with the state after every
  event. Every request carries the token, pages in the query; only the pages of DashQL get CORS headers, and a
  preflight allows the local network for Chrome. The server stops with `SessionEnd`.
- **The final message** comes from the payload (`last_assistant_message` of Codex) or from the transcript (the last
  text of the assistant in the JSONL of Claude Code).
- **The page** gets the link as an app event. `AgentSessionProvider` (`agent/agent_session_provider.tsx`) follows the
  server with `followAgentSession` of the SDK (`fetch`, in the browser and in Node), tries a lost server again every
  2 s until it ended the session, and keeps the link in the storage of the tab for a reload. A session belongs to the
  page: every workbook shows it. `agentSessionOf` (`agent/agent_session.ts`) maps it onto the model of the bar, the
  files that the agent touched are the scripts of the workbook with the same file name.

| Event | What the page shows |
|---|---|
| `UserPromptSubmit` | A new turn with the question; the feed follows the agent again |
| `PostToolUse` | The status line of the turn, the scripts the agent wrote; the feed follows the agent to a script it edits or runs |
| `Stop` | The final message of the turn |

- **The bar of Wobble** shows the harness and its folder at the right end, and the log of the turns in its bubble
  (`agent/agent_prompt_panel.tsx`). A turn can be dismissed, not stopped.
- **The feed** follows the agent to the scripts it edits and runs until the user scrolls, clicks or types in it.
- **The composer** takes SQL only. While the page reaches a session its prompt is closed, edits of the page would race
  the writes of the agent.
- **Wobble** stays: the greeting of an empty workbook and the face of the bar.

## Tests

- `//tests/agents`: Claude Code and Codex run a turn with the hooks of `dashql session hook`, the server holds the
  question, the command with its SQL file and the final message.
- `//packages/dashql-cli:test`: the server (token, origins, preflight), the payloads of both harnesses, a session that
  a hook starts.
- The page test `app_agent_session`: the app with a link to a server, the bar, the log, the closed prompt and its
  reopening once the session ended.

## Next

- The workbook of a session: the agent works on a workbook folder with the `dashql workbook` commands, the page shows
  that workbook and its changes.
- The browser reaches `127.0.0.1` from `https://dashql.app` only with the permission for the local network of the
  browser (Chrome asks), Safari doesn't; the desktop app reaches it directly.

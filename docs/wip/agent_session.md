# Agent Sessions

Status: built. The hooks of Claude Code and Codex reach `dashql session serve`, the page follows the session through a
link. The files of the agent are not yet the workbook of the page.

An agent works on DashQL from a harness in the terminal, Claude Code or Codex, with the Node `dashql` on the runtime
(`docs/wip/dashql_runtime.md`). The page of DashQL only watches. There is no agent server that the page asks, no agent
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

## The journal

The files of the agent reach the page through a journal, not through the hooks: every agent interaction with a workbook
goes through a `dashql` command, so the commands tell what they changed.

- **The server creates it.** `dashql session serve` creates `.dashql/journal.jsonl` in the folder of the session, empty
  for every session; the folder ignores itself (`.dashql/.gitignore` is `*`). A folder it can't write to has no
  journal.
- **Commands append their log to it.** A command of a workbook folder walks up to the nearest `.dashql/journal.jsonl`
  and appends its log records from `info` on, one JSON line each, the `LogRecord`s of the log of the app. Records of
  the target `workbook_journal` are markers of what changed (`session/workbook_journal.ts` of the runtime), with the
  workbook folder relative to the folder of the session and the workbook id in their values:
  - `Workbook files`: the paths of all files of the folder (`files` is a list, log values are texts or lists of texts);
    the stamps of the whole folder make the edits of the harness's own tools show up with the next command
  - `Script started`, `Script progress` (the phase, percent and rows of its query, at most once a second while it
    changes) and `Script result` (the key in the query result cache, the rows, the error, whether the cache served it).

  A command writes its files first and the marker after. Without a journal it appends nothing. `dashql run` writes
  today.
- **The server follows it.** It reads what was appended every 200 ms. It folds the markers into the `workbooks` of the
  state, reading the stamps of the files of a `Workbook files` marker itself, and keeps the latest 100 other records as
  the `log` of the commands. The markers are the contract, the other records are for display.
- **The page pulls.** The server hands out the files of a workbook folder at
  `/v1/workbooks/<token>/<workbook id>/<path>` (the files of a published workbook, `workbook_publishing.md`) and the
  newest result of a key at `/v1/results/<token>/<key>` from `.dashql/cache`, where the commands of the session keep
  their files (or `DASHQL_HOME/cache`). The token is part of the path, so the
  relative paths of a workbook folder keep it. The page fetches what it lacks and keeps it in its OPFS, results through
  `QueryResultCache.importFile`; it doesn't do that yet.
- **The hooks stay** for the conversation: `SessionStart` starts the server, `UserPromptSubmit` and `Stop` carry the
  question and the final message. The journal can replace `PostToolUse`.

## The page

- **The server** (`packages/dashql-cli/src/session_server.ts`) keeps the state that the runtime reduces from the events
  (`session/agent_session_state.ts`): per turn the question, the latest status line, the files the tools named, the
  final message. Hooks post to `/v1/events`, pages read `/v1/stream`, server-sent events with the state after every
  event. Every request carries the token, pages in the query; only the pages of DashQL get CORS headers, and a
  preflight allows the local network for Chrome. The server stops with `SessionEnd`.
- **The final message** comes from the payload (`last_assistant_message` of Codex) or from the transcript (the last
  text of the assistant in the JSONL of Claude Code).
- **The page** gets the link as an app event. `AgentSessionProvider` (`agent/agent_session_provider.tsx`) follows the
  server with `followAgentSession` of the runtime (`fetch`, in the browser and in Node), tries a lost server again every
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

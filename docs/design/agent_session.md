# Agent Sessions

An agent works on DashQL from a harness in the terminal, Claude Code or Codex, with the Node `dashql` on the runtime
(`docs/design/dashql_runtime.md`). `dashql connect` is the one way to attach a harness: it launches the harness with
hooks that send the events of the session to its server. The page follows the session through the line of the AI side of
its prompt. A tab that connects copies its workbooks into the folder of the session, takes the scripts that the agent
changes there and runs them when the agent runs them ([agent_integration.md](agent_integration.md), "Runs in the tab").
There is no agent server that the page asks, no agent access per workbook and no prompt in natural language.

Which side does what, and why, is in [agent_integration.md](agent_integration.md). This document has the details of
the session: connecting, the hooks, the handoff, the protocol, the folder of the session, the copies and what the agent
is told. What
is not built yet is in [docs/wip/agent_session.md](../wip/agent_session.md).

## Connecting from the page

The prompt switches between SQL and AI. AI keeps the white card of the prompt, disables Run and the snippets, and
shows in the place of the editor a line to run in the folder of a project, in a field to copy with a button for a new
port: `npx -y --registry=https://registry.npmjs.org/ --min-release-age=0 @akohn/dashql-cli@<version> connect --launch claude --port <port> --secret <secret>`.
The version is the one of the build of the page (`DASHQL_CLI_VERSION`, a release like `0.0.19` or a build of main like
`0.0.20-latest.<commits>.g<commit>`, `-dev.` on dev.dashql.app): CI publishes the packages of a build to npm before it deploys the page, so the
command is of the same commit, and npx caches each version by itself. The dev server shows `@latest`. `--registry` and
`--min-release-age=0`, because a company's npm mirror or release-age policy would otherwise refuse a version published
minutes ago. A fresh terminal starts in the home folder: there, `connect` fails without `--folder`, the agent would get
all of home. A switch between Claude Code and Codex follows the switch of SQL and AI while AI is on. The editor keeps
its draft for SQL.

- **The tab picks the address.** The first switch to AI picks a random port of 49152–65535 on `127.0.0.1` and a random
  secret, and follows that target like the target of a link, trying it every 2 s until a server answers
  (`agent/agent_connect.ts`, `AgentSessionProvider`). The tab keeps the target, the mode and the harness in the
  storage of the tab, a reload waits on the same line.
- **`dashql connect` listens and launches.** It runs the server of the session on that port with the secret as token
  and launches the harness with the hooks of the session in its arguments, nothing is installed
  (`packages/dashql-cli/README.md`). The session ends when the harness exits.
- **The first state switches to AI**, the user can switch back to SQL, see [Who has the workbook](#who-has-the-workbook).
- **The line runs again.** Once the harness ended its session, the tab keeps trying the port and the composer shows
  the line again: it runs the next session on the same port and secret, with either harness. Every server names its
  session with `id` in the state; a new id is a new session, the tab copies its workbooks into it again, forgets the
  dismissed turns of the old one and switches to AI again.
- The page waits with requests that fail until the server is up; the browser logs them. Chrome asks once for the local
  network of a public page; Safari doesn't allow it, the desktop app reaches `127.0.0.1` directly.

## The session

- **One session per folder.** `dashql connect` runs one session in a folder, in its workspace `.dashql/`. A second
  `connect` in the folder fails while the server of the first answers; a session whose server is gone, e.g. after a
  crash, goes with its folder at the next start. The session has an id, a new UUID: the `id` of the state that the tab
  follows. The workspace file `.dashql/dashql-workspace.json` (`session`) holds the address and the token of the
  server, removed from it when the session ends.
- **The workspace in every command.** The hooks take the workspace, the `.dashql/` of the folder that the harness
  works in, `--workspace <folder>/.dashql`, the commands of the agent a copy, `<folder>/.dashql/workbooks/<id>`, and
  the workspace that holds it (`describe` takes `--workspace`, `.dashql/` of the invoking directory by default); they
  read the session from the workspace file; `connect` sets no variable for them but the
  `PATH` of the `dashql` of the agent. A workspace is a folder that `dashql init` or `dashql connect` set up, with a
  workspace file; the commands fail on any other, also on the project folder around it. `dashql init` gives a
  `.dashql/` from before the workspace file, whose `.gitignore` ignores all of it, the file.
- **Hooks carry the events.** Every hook that `connect` gives the harness runs `dashql session hook <event> --harness
  <name> --workspace <folder>/.dashql` and sends the event to the server that the workspace file names: `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd`, the page reads them from there. Claude Code
  sends three more: `PostToolUseFailure` goes as a `PostToolUse` with the error, `StopFailure` (a turn that an error
  ended) as a `Stop`, and `Notification` for an approval that the agent waits for in the terminal (`permission_prompt`)
  and for an agent that is idle (`idle_prompt`); Codex has none of them. `SessionStart`
  prints the session that the commands take, the workbooks and the connections; the harness hands it to the agent.
  There are no hooks to install in the settings of a harness, so a session never has two servers.
  Hooks run outside the sandbox of both harnesses, the commands of the agent inside it don't need the server:
  `//tests/agents` checks both ([agent_integration_tests.md](agent_integration_tests.md)).
- **The agent works on files.** Its commands (`dashql lint`, `format`, `run`) read and write the workbook folder, the
  page follows the folder.
- **The page watches.** The questions come from the terminal, and the terminal stops the agent.

## Who has the workbook

The switch of the prompt decides who changes the workbooks, the agent in AI or the user in SQL. The session stays
attached either way, on the same port and secret: the tab picks them once and keeps them across the switch and a reload,
only the button of a new port gives new ones.

- **AI, the agent has it.** While a session that did not end follows the tab, the editors of the scripts are read-only
  (`useAgentHasControl`, `ScriptEditor`), the status of the prompt says to switch to SQL to edit them. The tab takes the
  scripts of the agent and runs for it.
- **SQL, the user has it.** The editors are editable, the edits of the user go into the copies as before. The tab holds
  the changes of the agent (`AgentSessionCopies.pause`): it keeps the latest state of the session and takes nothing. A
  run of `dashql run` fails at once with `AGENT_PAUSED_ERROR`, which tells the agent to tell the user and stop; the guide
  of `dashql describe` says the same.
- **Back to AI.** The tab takes what the agent changed meanwhile from the latest state. A script that the user changed
  in between keeps the text of the user: its write into the copy is the newest stamp, the copy holds the text of the page.

The page test `app_agent_session` switches to SQL and back: the read-only editor, the edit of the user, a run and an
edit of the agent that wait, and the edit that the tab takes in AI.

## Protocol

The server of a session and its clients (the page, the hooks, `dashql run`) name a protocol, an integer in
`platform/session/agent_session_protocol.ts`, so that a mismatch shows instead of failing later in one request. The line
of the tab runs the `dashql-cli` of the build of the page, so both sides speak exactly one protocol, the same.

- **On the wire.** Every answer of the server, also an error, carries `X-DashQL-Protocol`; pages may read it (CORS
  expose). Requests name no protocol, the server takes every request as it is.
- **The client checks.** `fetchAgentSession` checks every answer: a server of another protocol throws
  `AgentSessionProtocolError` with the older side, a server that names none is the older one.
- **The page** keeps trying the server and shows in the status of the composer which side to update: an older
  `dashql-cli` (stop it, run the command again) or the page (reload). `dashql run` fails with the error.
- **Changing it.** Raise `AGENT_SESSION_PROTOCOL` with every change of what goes over the wire, also an added field, and
  add a line to the list in the module. The fake server of the page test `app_agent_session` speaks the protocol of the
  page.

## The session in the workspace

One session runs in a workspace, and it works in its root. The server of `dashql connect` sets up `.dashql/` in the
folder that the harness works in, a folder that it can't write fails the start; the workspace ignores itself
(`.dashql/.gitignore` is `*`). The session keeps in it:

- `dashql-workspace.json`, the workspace file, `session`: the address and the token of the server, readable
  by the user only, where the hooks and the commands find it, and `connections`, the connections that the tab lets
  the agent use. The agent may not edit it without asking. The session goes from it when it ends.
- `workbooks/<workbook id>/`: the copies of the workbooks of the tab, see below, the workbooks of the workspace as in
  the storage of the app. They go when the session ends, with the attachments that a run without a session mirrors
  there, which it mirrors again.
- `bin/dashql`: the `dashql` of the agent, first on its `PATH`, gone when the session ends.

`catalog`, `run` and `vis` of a copy take the workspace that holds it, `describe` takes `--workspace
<folder>/.dashql`, which the start of the session gives the agent; nothing comes from the environment and nothing is
searched for. A path that names no
workspace, the project folder around it or a relative one after the shell of the agent changed into another folder,
fails. Only the user sets up a
workspace with `dashql init`: the guide tells the agent not to, Claude Code asks before it runs it. While
the workspace file names a session, `dashql run` and `dashql vis` run only the copies, in the tab, and refuse every other workbook folder, in `.dashql/` or outside of
it, which would otherwise run in the process without the tab noticing. A copy runs only with the workspace of its
session. The edits of the agent reach the tab through the stamps of the copies, which the server
takes after every tool and before every run; the page fetches the files at `/v1/workbooks/<token>/<workbook id>/<path>`.
The token is part of the path, so the relative paths of a workbook folder keep it.

## The copies of the workbooks

A conversation that starts in the page works on a copy: the site is the truth, the disk holds a copy for the agent in
`<project>/.dashql/workbooks/<workbook id>/`, a workbook folder in the layout of OPFS
(`dashql-workbook.json`, `scripts/`, `attachments/`). It goes with the session, the tab has everything.

- `.dashql/`, the workspace, is also the root of Node of the session (`docs/design/storage_layout.md`, "The root of Node"):
  `workbooks/<id>/attachments/`, `workbooks/<id>/results/` and `instances/` have the layout of OPFS, nothing is
  converted.
- It is in the project, where the sandbox of Codex and the permissions of Claude Code let the agent write, a folder of
  the system for temporary files is not.
- `.dashql/.gitignore` is `*`, the copy never reaches the repository of the user.
- **The page writes it** once the server of the session answers, for every workbook that it shows
  (`AgentSessionProvider`): it writes the pending writes of the workbook, then sends the files of its OPFS folder with
  `writeAgentSessionWorkbook` of the runtime: `DELETE /v1/workbooks/<token>/<id>` removes an older copy, the site wins,
  `PUT /v1/workbooks/<token>/<id>/<path>` writes the scripts and the attachments and the workbook file last. With the
  workbook file the server names the copy in the `workbooks` of its state with the stamps of its files, and hands out
  its files on the same route. A native workbook has its folder on disk
  already, the page copies nothing. The page copies a workbook once per session (the target and the `id` of the
  state), also across a reload (the storage of the tab keeps the copied workbooks): a copy again would replace what the
  agent did. After a reload the page adopts the copy, every script of it that differs from the page is a change of the
  agent.
- **The changes of the agent come back** (`agent/agent_session_copy.ts`). The first state that names a copy is what the
  page wrote, later stamps of its scripts that differ are changes of the agent: the page fetches a changed script and
  takes its text (`setScriptText`, no rewrite to accept or reject), a new script becomes a script of the workbook, and
  its next changes go to that script. A new script goes where the workbook file of the copy lists it, at the end
  without an entry (`createScript` with its `index`). A script with the text of the page stays as it is. The server stamps the copies
  again after every `PostToolUse` and `Stop`, so an edit with a tool of the harness shows without a `dashql` command.
- **The changes of the user go into the copy.** Half a second after an edit, the page writes the scripts whose text
  differs from what the copy holds, removes the ones it deleted and, when the list or the order of the scripts changed,
  writes its workbook file. A script that it took from the agent counts as held by the copy. Both directions run one after the
  other (`AgentSessionCopies`).
- **The connections of the scripts of the agent.** The workbook file of the copy names the connection of every script,
  `{"name": "x.sql", "connectionId": "<id>"}`. A new script of the agent runs on the connection that the workbook file
  of the copy names for it when the tab takes it, else on the connection of the script before it at its place; the
  guide tells the agent to add the entry before it writes the script. A later change of the workbook file moves the
  scripts to the connections it names (`setScriptConnection`), a connection that the tab doesn't have leaves the script
  where it is, and the feed into its order (`reorderScripts`), the scripts that it leaves out follow. The workbook file
  of the copy is the one order of the scripts of the agent.
- **The catalogs of the connections.** The tab writes `connections/<id>/dashql-catalog-relations.sql` into every copy for
  every connection that the agent may use: the tables that the connection reported, as `CREATE TABLE` statements with
  the types of their columns, the file that the core writes into the storage of the connection
  (`catalogRelationsFile` of the module, `relations_file_of_entry`). It writes a catalog again when its
  stamp changed: the relations entry and the catalog updates that finished. `dashql catalog` prints them, the route of
  the files of the copy takes them, nothing new goes over the wire.
- **Runs of the copies run in the tab**, see [agent_integration.md](agent_integration.md), "Runs in the tab".

A folder runs one session: a second tab that connects to the same folder gets a line whose `connect` fails while the
first runs.

## The connections of the agent

The connection picker of the prompt becomes, in AI, a menu `2 / 4 connections` (`agent/agent_connections_picker.tsx`):
the list of connections of the connection picker with a checkbox as the trailing visual of each, the clouds in a group
of their own after the other connections. Only the connections that the shown workbooks and the copies of the session
use are allowed until the user ticks or unticks one: every connection of the tab would confuse the agent, the user ticks
the others when the agent needs them. A cloud keeps the published workbooks, a workbook doesn't use it. The tab keeps what the user
ticked and unticked per target in the storage of the tab. Once the server answers and after every change, the page
sends the allowed connections with their labels (`PUT /v1/connections/<token>`), the server writes them into the
session of the workspace file, `connections` in `.dashql/dashql-workspace.json`. A run in the tab takes only the allowed connections,
the tab decides. `dashql describe` and `dashql catalog` tell the agent which connections it may use. The file is
guidance for the agent, not a boundary: the tab decides.

**Logins stay in the tab.** The tab logs in as it does for its own runs, a run of the agent in the tab uses its
connections as they are. No token or password reaches `dashql connect` or a process of the agent.

**What the page sends to the server.** One channel from the page to the server, requests with the token of the
session: the copies of its workbooks (`PUT` and `DELETE` on the routes of their files), the selection of connections
(`PUT /v1/connections/<token>`) and the events of the runs that it runs (`POST /v1/runs/<token>/<run id>`). The server
stays the one place the page talks to.

## How the agent learns DashQL

- **The guide** is `DESCRIBE_TEXT` of `describe_command.ts`: the layout of a workbook folder with the connection of a
  script in the workbook file, the commands, the rules of scripts (one statement each, reentrant DDL, `:name` of
  scripts, the embedded Hyper over cheap remote results, `@param`, `@manual`, client functions), charts (the `@vis` tag
  with an example, no sizes, `dashql vis` after every change), how to work, and that the user may take the workbook
  back. The text lives in the command, it fits the installed version.
- **In context from the start.** Claude Code gets the guide with a preface (`CONNECTED_AGENT_GUIDE`) in its system
  prompt (`--append-system-prompt`), which outranks the `CLAUDE.md` of a project. Codex gets the same text in the output
  of the hook at the start. The hook tells both the session that the commands take and where the copies are, and lists
  the workbooks and the connections of the session. `dashql describe` prints the guide again with them.
- **Commands that check.** `dashql catalog` prints the tables of the connections from the catalog files of the copy,
  `dashql vis` checks a chart against the result of its script and writes the PNG of it to look at, `dashql run`
  prints the syntax errors of its scripts first. The checks are local, on files and the core. The tab renders the PNG
  as it runs the query, an option of the run request and an event of the run.
- **Fewer approvals.** Claude Code may run `dashql` and edit the copies without asking.
- **`dashql` on the path.** The agent of a harness that `npx` launched has no `dashql`: `dashql connect` writes one
  into the folder of the session and puts it first on the `PATH` of the harness.
- **No MCP server.** The commands are the one interface for every session, with `dashql connect` or without, the agent
  runs them with its shell, `//tests/agents` covers that.

## The page

- **The server** (`packages/dashql-cli/src/session_server.ts`) keeps the state that the runtime reduces from the events
  (`session/agent_session_state.ts`): per turn the question, the latest status line, what the agent waits for in the
  terminal, whether the turn was interrupted, the steps, the files the tools named, the final message. A harness tells
  no Stop on an interrupt: the next question or an idle notification ends the open turn as interrupted. The harness and the folder of the state come from `dashql connect`, the events don't
  repeat them. A step is a use of a tool: `PreToolUse` starts it at the time of the server, the
  `PostToolUse` with the same `tool_use_id` (else the oldest open step of the same line) ends it, a failed tool ends it
  as failed, `Stop` and `SessionEnd` end the open ones. A turn keeps its latest 30 steps.
- **What the agent does** the tab derives from the open turn (`agentActivity` of `agent/agent_session.ts`): it waits
  for the user in the terminal, a tool runs, or it thinks between its tools, where no hook fires. The bar of Wobble
  names the running tool or thinking; while the agent waits, the line, the agent at its end and the dot on Wobble turn
  to the color of attention and stop pulsing, the frame of the prompt holds still. Wobble reads along while the agent
  works (a faster wobble, darting eyes) and looks out at the user while it waits. The title of the browser tab starts
  with `●` while the agent works and with `(!)` while it waits, for a user in the terminal next to the tab. The feed has
  no entry of the agent: it may only edit the cards that are there.
- **The line of a step** comes from the hook (`session_hook.ts`): the command of a shell, else the tool with its file,
  its pattern, query, URL or description, else the tool. Paths are relative to the folder of the session, paths in a
  copy of a workbook relative to the copy, a leading `cd <folder> &&` is dropped. Hooks post to `/v1/events`, pages
  read `/v1/stream`, server-sent events with the state after every event. Every request carries the token, pages in
  the query; only the pages of DashQL get CORS headers, and a preflight allows the local network for Chrome. The server
  stops with `SessionEnd`.
- **The final message** comes from the payload (`last_assistant_message` of Codex) or from the transcript (the last
  text of the assistant in the JSONL of Claude Code).
- **The page** follows the target of the line of its prompt. `AgentSessionProvider` (`agent/agent_session_provider.tsx`)
  follows the server with `followAgentSession` of the runtime (`fetch`, in the browser and in Node), tries a lost server
  again every 2 s, also once the session ended, for the next session on the port, and keeps the target in the storage of
  the tab for a reload. A lost session shows as lost in the status of the bar, an ended one shows nothing there. A
  session belongs to the page: every workbook shows it. `agentSessionOf` (`agent/agent_session.ts`) maps it onto the
  model of the bar, the files that the agent touched are the scripts of the workbook with the same file name.

| Event | What the page shows |
|---|---|
| `UserPromptSubmit` | A new turn with the question; the feed follows the agent again |
| `PreToolUse` | A step that runs, with the time since it started; the feed follows the agent to a script it edits or runs |
| `PostToolUse` | The step ends with the time it took, red if the tool failed; the scripts the agent wrote |
| `Stop` | The final message of the turn below its steps |
| A run of `dashql run` | The tab runs the workbook, the feed shows the run with its progress ([agent_integration.md](agent_integration.md), "Runs in the tab") |

- **The bar of Wobble** shows the harness and its folder at the right end, the step of the agent in its status line,
  and the log of the turns in its bubble (`agent/agent_prompt_panel.tsx`): the steps of the turn that the agent works
  on, which follow the newest step while the user stays at the bottom. The bubble opens only on a click on Wobble: it
  covers the end of the feed, where the scripts of the agent appear while it works. A turn can be dismissed, not
  stopped.
- **The feed** follows the agent to the scripts it edits and runs until the user scrolls, clicks or types in it, also
  to a new script once the tab created it. A script that the user picks in the log shows in the feed, also from the
  dashboard or the dataflow.
- **The prompt** (`workbook/feed/workbook_prompt.tsx`) belongs to the page of the workbook, not to one of its views: it
  floats over the feed, the dashboard and the dataflow, holds the composer, the bar of Wobble and the greeting, and
  follows the session of the agent. The feed is one of the three views; the prompt asks it through a handle to follow
  the agent, to show a script and to scroll to an appended script, the feed asks the prompt to mention a script.
- **The composer** takes SQL in SQL and nothing in AI, see [Connecting from the page](#connecting-from-the-page).
  It docks below the scripts of the feed and floats over the dashboard and the dataflow, and creates scripts in every
  view. A click on the bar of Wobble (or its chevron) shrinks it into the bar with its draft and the inputs of the
  draft, and grows it out again; it then takes the focus. A switch of the view returns it to the default of the view:
  shown in the feed, shrunk into the bar over the dashboard and the dataflow. The greeting of an empty workbook always
  shows it.
- **Wobble** stays: the greeting of an empty workbook and the face of the bar.

## Tests

- `//tests/agents`: Claude Code and Codex run a turn under `dashql connect`, the state of its server holds the
  question, the command with its SQL file and the final message.
- `//packages/dashql-cli:test`: the server (token, origins, preflight, malformed paths, a folder that it can't write),
  the payloads of both harnesses with the lines of their steps and the hooks of the tools that `dashql connect` gives
  them; the folder of the session: its file, one session per folder, the folder of a crashed one taken over, gone
  when the session stops.
- `//packages/dashql:test_platform_node`: the folder of a session and the stamps of its copies
  (`session/session_folder.test.ts`), the state of a session with the steps of a turn (tools at once, a failed one,
  hooks without an id), the protocol (`session/agent_session_protocol.test.ts`: the older side, the check of an
  answer).
- `//packages/dashql-cli:test` also: the server names its protocol on every answer and to pages.
- `agent/agent_prompt_panel.test.tsx`: the steps of a turn that works and of a finished one.
- The page test `app_agent_session`: the line of AI and a server on its port, the bar, the log, the switch back to SQL;
  then a new port, Codex, a server without a protocol on the port and secret of the line that the composer calls an
  older `dashql-cli`, and a server of the protocol in its place.
- `//packages/dashql-cli:test`: `dashql connect` with a harness of the test that runs the hooks it was given; the
  copy of the workbook of a page (writes, replacement, the stamps after a tool, paths it refuses).
- `//packages/dashql-cli:test` also: the connections of the agent in the folder of the session, `dashql describe`
  and `dashql catalog` that tell them; a run in the tab (`run_command.test.ts`): the events of a fake tab with the
  first rows of a result, an interrupt that stops the run in the tab, no tab, a folder that is no copy.
- `agent/agent_session_copy.test.ts`: the scripts of a copy that changed, the texts and the new scripts of the agent,
  the edits of the user into the copy, a copy adopted after a reload.
- The page test `app_agent_session` also checks that the tab writes its workbook into the session once it connects,
  not again after a reload, that an edit reaches the copy, that the tab takes the text of the agent, that a run that
  the server asks for runs in the tab and posts its events, that the stored result of a script comes
  with its Parquet file, which the tab writes into the results of the copy, and that the menu of the connections of
  the agent sends the connections that stay ticked; that a session that ends leaves the line in the composer and no
  lost session, and that the next server on the same port gets a new copy.

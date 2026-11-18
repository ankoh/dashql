# Agent Sessions

Status: built. The hooks of Claude Code and Codex reach `dashql session serve`, the page follows the session through a
link or through the line of the AI side of its prompt (`dashql connect`). A tab that connects copies its workbook into
the folder of the session, takes the scripts that the agent changes there and runs them when the agent runs them
(`docs/wip/tab_driven_runs.md`); the other files of the agent are not yet the workbook of the page.

An agent works on DashQL from a harness in the terminal, Claude Code or Codex, with the Node `dashql` on the runtime
(`docs/design/dashql_runtime.md`). The page of DashQL watches and runs what the agent runs. There is no agent server that the page asks, no agent
access per workbook and no prompt in natural language.

## Connecting from the page

The prompt switches between SQL and AI. AI keeps the white card of the prompt, disables Run and the snippets, and
shows in the place of the editor a line to run in the folder of a project, in a field to copy with a button for a new
port: `npx -y --registry=https://registry.npmjs.org/ --min-release-age=0 @akohn/dashql-cli@<version> connect --launch claude --port <port> --secret <secret>`.
The version is the one of the build of the page (`DASHQL_CLI_VERSION`, `0.0.19-dev.255.ge8e09a80c`): CI publishes the
packages of a build to npm before it deploys the page, so the command is of the same commit, and npx caches each
version by itself. The dev server shows `@latest`. `--registry` and `--min-release-age=0`, because a company's npm
mirror or release-age policy would otherwise refuse a version published minutes ago. A switch between Claude Code
and Codex follows the switch of SQL and AI while AI is on. The editor keeps its draft for SQL.

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
  session with `id` in the state (protocol 3); a new id is a new session, the tab copies its workbooks into it again,
  forgets the dismissed turns of the old one and switches to AI again. A server before protocol 3 names none, the tab
  takes it for the session that it copied into before.
- The page waits with requests that fail until the server is up; the browser logs them. Chrome asks once for the local
  network of a public page.

## The session

- **Hooks carry the events.** Every hook runs `dashql session hook <event>` (`packages/dashql-cli/README.md` has the
  settings of both harnesses). The first event starts `dashql session serve` on `127.0.0.1` with a token, detached;
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd` go to it, and the page reads them from
  there. `PostToolUseFailure` of Claude Code goes as a `PostToolUse` with the error.
  `SessionStart` prints the link of the session, `https://dashql.app/?data=` with `{"agentSession": {"endpoint",
  "token"}}`; the harness hands the output of the hook to the agent, which tells the user.
  Hooks run outside the sandbox of both harnesses, the commands of the agent inside it don't need the server:
  `//tests/agents` checks both (`docs/wip/agent_integration_tests.md`).
- **The agent works on files.** Its commands (`dashql lint`, `format`, `run`) read and write the workbook folder
  The page follows the folder.
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

The server of a session and its clients (the page, the hooks, `dashql run`) come from different versions: npx picks a
`dashql-cli`, the page is whatever the tab loaded. Both sides name a protocol, an integer in
`platform/session/agent_session_protocol.ts`, so that a mismatch shows instead of failing later in one request.

- **Two numbers.** `AGENT_SESSION_PROTOCOL` is the protocol that this side speaks, `AGENT_SESSION_MIN_PROTOCOL` the
  oldest protocol of a peer that it still works with: for the server the oldest client it answers, for a client the
  oldest server it talks to.
- **On the wire.** A client sends `X-DashQL-Protocol` with every request. The server sends `X-DashQL-Protocol` and
  `X-DashQL-Min-Protocol` with every answer, also with an error, and pages may read both (CORS expose). A request
  without a protocol or of an older one than the server's minimum gets 426 and nothing else.
- **The client decides.** `fetchAgentSession` sends the protocol and checks every answer: a server that names no
  protocol or one below the client's minimum is outdated, a server whose minimum is above the client's protocol finds
  the client outdated. Either throws `AgentSessionProtocolError` with the side to update.
- **The page** keeps trying the server and shows in the status of the composer which side to update: an older
  `dashql-cli` (stop it, run the command again) or the page (reload). The hook treats a server of another protocol as
  gone and starts a new one, `dashql run` fails with the error.
- **Changing it.** Raise `AGENT_SESSION_PROTOCOL` with every change of what goes over the wire, also an added field, and
  add a line to the list in the module. Raise `AGENT_SESSION_MIN_PROTOCOL` to it as well when this side no longer works
  with a peer of the older protocol: a route or a field it needs, a meaning that changed. A field that a newer peer
  added is ignored. The fake server of the page test `app_agent_session` speaks protocol 1 and fails the test once the
  page needs a newer one.

## The journal

The files of the agent reach the page through a journal, not through the hooks: every agent interaction with a workbook
goes through a `dashql` command, so the commands tell what they changed.

- **The server creates it.** `dashql session serve` creates `.dashql/journal.jsonl` in the folder of the session, empty
  for every session; the folder ignores itself (`.dashql/.gitignore` is `*`). A folder it can't write to has no
  journal.
- **Commands append their log to it.** A command gets the workspace, the folder that the harness works in: the
  invoking directory, or `--workspace <dir>`. If the workspace has `.dashql/journal.jsonl`, a command of a workbook
  folder in the workspace appends its log records from `info` on, one JSON line each, the `LogRecord`s of the log of the app. Records of
  the target `workbook_journal` are markers of what changed (`session/workbook_journal.ts` of the runtime), with the
  workbook folder relative to the folder of the session and the workbook id in their values:
  - `Workbook files`: the paths of all files of the folder (`files` is a list, log values are texts or lists of texts);
    the stamps of the whole folder make the edits of the harness's own tools show up with the next command.

  The runs of the copies of a tab run in the tab and need no markers (`docs/wip/tab_driven_runs.md`).

  A command writes its files first and the marker after. Without a journal it appends nothing. `dashql run` is the
  only command that writes one today. When the server stops, it removes the journal.
- **The server follows it.** It reads what was appended every 200 ms. It folds the markers into the `workbooks` of the
  state, reading the stamps of the files of a `Workbook files` marker itself, and keeps the latest 100 other records as
  the `log` of the commands. The markers are the contract, the other records are for display.
- **The page pulls.** The server hands out the files of a workbook folder at
  `/v1/workbooks/<token>/<workbook id>/<path>` (the files of a published workbook, `workbook_publishing.md`). The token
  is part of the path, so the relative paths of a workbook folder keep it.
- **The hooks stay** for the conversation: `SessionStart` starts the server, `UserPromptSubmit` and `Stop` carry the
  question and the final message. The journal can replace `PostToolUse`.

## The page

- **The server** (`packages/dashql-cli/src/session_server.ts`) keeps the state that the runtime reduces from the events
  (`session/agent_session_state.ts`): per turn the question, the latest status line, the steps, the files the tools
  named, the final message. A step is a use of a tool: `PreToolUse` starts it at the time of the server, the
  `PostToolUse` with the same `tool_use_id` (else the oldest open step of the same line) ends it, a failed tool ends it
  as failed, `Stop` and `SessionEnd` end the open ones. A turn keeps its latest 30 steps.
- **The line of a step** comes from the hook (`session_hook.ts`): the command of a shell, else the tool with its file,
  its pattern, query, URL or description, else the tool. Paths are relative to the folder of the session, paths in a
  copy of a workbook relative to the copy, a leading `cd <folder> &&` is dropped. Hooks post to `/v1/events`, pages read `/v1/stream`, server-sent events with the state after every
  event. Every request carries the token, pages in the query; only the pages of DashQL get CORS headers, and a
  preflight allows the local network for Chrome. The server stops with `SessionEnd`.
- **The final message** comes from the payload (`last_assistant_message` of Codex) or from the transcript (the last
  text of the assistant in the JSONL of Claude Code).
- **The page** gets the link as an app event. `AgentSessionProvider` (`agent/agent_session_provider.tsx`) follows the
  server with `followAgentSession` of the runtime (`fetch`, in the browser and in Node), tries a lost server again every
  2 s, also once the session ended, for the next session on the port, and keeps the link in the storage of the tab
  for a reload. A lost session shows as lost in the status of the bar, an ended one shows nothing there. A session belongs to the
  page: every workbook shows it. `agentSessionOf` (`agent/agent_session.ts`) maps it onto the model of the bar, the
  files that the agent touched are the scripts of the workbook with the same file name.

| Event | What the page shows |
|---|---|
| `UserPromptSubmit` | A new turn with the question; the feed follows the agent again |
| `PreToolUse` | A step that runs, with the time since it started; the feed follows the agent to a script it edits or runs |
| `PostToolUse` | The step ends with the time it took, red if the tool failed; the scripts the agent wrote |
| `Stop` | The final message of the turn below its steps |
| A run of `dashql run` | The tab runs the workbook, the feed shows the run with its progress (`docs/wip/tab_driven_runs.md`) |

- **The bar of Wobble** shows the harness and its folder at the right end, the step of the agent in its status line,
  and the log of the turns in its bubble (`agent/agent_prompt_panel.tsx`): the steps of the turn that the agent works
  on, which follow the newest step while the user stays at the bottom. The bubble opens only on a click on Wobble: it
  covers the end of the feed, where the scripts of the agent appear while it works. A turn can be dismissed, not
  stopped.
- **The feed** follows the agent to the scripts it edits and runs until the user scrolls, clicks or types in it, also
  to a new script once the tab created it.
- **The composer** takes SQL in SQL and nothing in AI, see [Connecting from the page](#connecting-from-the-page).
- **Wobble** stays: the greeting of an empty workbook and the face of the bar.

## Tests

- `//tests/agents`: Claude Code and Codex run a turn with the hooks of `dashql session hook`, the server holds the
  question, the command with its SQL file and the final message.
- `//packages/dashql-cli:test`: the server (token, origins, preflight, malformed paths), the payloads of both
  harnesses with the lines of their steps and the hooks of the tools that `dashql connect` gives them, a session that
  a hook starts; the journal: the server creates it, follows partial lines, folds the markers and hands out the files
  they name, and removes it when it stops; `dashql run` appends the files and its log for a workbook in the workspace
  it is given.
- `//packages/dashql:test_platform_node`: the markers and their fold (`session/workbook_journal.test.ts`), the state of
  a session with the log of the commands and the steps of a turn (tools at once, a failed one, hooks without an id),
  the protocol (`session/agent_session_protocol.test.ts`: the side that is too old, the header of a request, the check
  of an answer).
- `//packages/dashql-cli:test` also: the server names its protocol on every answer and to pages, answers a client
  without one or of an older one with 426, a newer one as long as it is not older than the client's minimum.
- `agent/agent_prompt_panel.test.tsx`: the steps of a turn that works and of a finished one.
- The page test `app_agent_session`: the app with a link to a server, the bar, the log, AI and the switch back to SQL;
  then a new port, Codex, a server without a protocol on the port and secret of the line that the composer calls an
  older `dashql-cli`, and a server of the protocol in its place.
- `//packages/dashql-cli:test`: `dashql connect` with a harness of the test that runs the hooks it was given; the
  journal of a session of its own; the copy of the workbook of a page (writes, replacement, the stamps after a tool,
  paths it refuses).
- `//packages/dashql-cli:test` also: the connections of the agent next to the journal, `dashql run` that refuses
  the others, `dashql describe` that lists them; a run in the tab (`run_command.test.ts`): the events of a fake tab
  with the first rows of a result, an interrupt that stops the run in the tab, no tab, a folder that no tab copied.
- `agent/agent_session_copy.test.ts`: the scripts of a copy that changed, the texts and the new scripts of the agent,
  the edits of the user into the copy, a copy adopted after a reload.
- The page test `app_agent_session` also checks that the tab writes its workbook into the session once it connects,
  not again after a reload, that an edit reaches the copy, that the tab takes the text of the agent, that a run that
  the server asks for runs in the tab and posts its events, that the result of a connection that caches results comes
  with its Parquet file, which the tab writes into the cache of the session, and that the menu of the connections of
  the agent sends the connections that stay ticked; that a session that ends leaves the line in the composer and no
  lost session, and that the next server on the same port gets a new copy.

## Plan: the workbook, the connections and the runs of a session

Status: the first step is partly built, see [Order](#order).

### Two cases

- **A, the conversation starts in the page.** The user has a workbook with working connections in the tab, switches
  to AI and runs the line of `dashql connect` in the folder of a project. The site is the truth, the disk holds a copy
  for the agent.
- **B, the user stays in the shell.** The agent creates a workbook folder in the project and the page only shows it.
  The folder is the truth, the page holds a copy.

In both cases the agent works on files on disk and the page follows them, the direction of the files is what differs.

### Runs of the copies run in the tab

`dashql run` on a copy of the tab asks the tab, which runs the workbook with its own runtime: the feed of the tab is
the live preview of the run, the events go back to `dashql run` (`docs/wip/tab_driven_runs.md`). The tab reaches a
database only where its endpoint allows the origin of DashQL through CORS, there is no proxy; the desktop app reaches
every endpoint. Other workbook folders run in the process of `dashql run`.

### Where the workbook of case A lives

`<project>/.dashql/workbooks/<workbook id>/`, a workbook folder in the layout of OPFS (`dashql-workbook.json`,
`scripts/`, `attachments/`).

- `.dashql/` is already the root of Node of the session (`docs/design/storage_layout.md`, "The root of Node"): `cache/`,
  `workbooks/<id>/attachments/` and `instances/` have the layout of OPFS, nothing is converted.
- It is in the project, where the sandbox of Codex and the permissions of Claude Code let the agent write, a folder of
  the system for temporary files is not.
- `.dashql/.gitignore` is `*`, the copy never reaches the repository of the user.
- **The page writes it** once the server of the session answers, for every workbook that it shows
  (`AgentSessionProvider`): it writes the pending writes of the workbook, then sends the files of its OPFS folder with
  `writeAgentSessionWorkbook` of the runtime: `DELETE /v1/workbooks/<token>/<id>` removes an older copy, the site wins,
  `PUT /v1/workbooks/<token>/<id>/<path>` writes the scripts and the attachments and the workbook file last. With the
  workbook file the server names the copy in the `workbooks` of its state, like a workbook folder of the journal with
  the path `.dashql/workbooks/<id>`, and hands out its files on the same route. A native workbook has its folder on disk
  already, the page copies nothing; the agent could work in that folder (not built). The page copies a workbook once
  per session (the target and the `id` of the state), also across a reload (the storage of the tab keeps the copied
  workbooks): a copy again would replace what the agent did. After a reload the page adopts the copy, every script of it that differs from the page is a
  change of the agent.
- **The changes of the agent come back** (`agent/agent_session_copy.ts`). The first state that names a copy is what the
  page wrote, later stamps of its scripts that differ are changes of the agent: the page fetches a changed script and
  takes its text (`setScriptText`, no rewrite to accept or reject), a new script becomes a script of the workbook, and
  its next changes go to that script. A script with the text of the page stays as it is. The server
  stamps the copies again after every `PostToolUse` and `Stop`, so an edit with a tool of the harness shows without a
  `dashql` command.
- **The changes of the user go into the copy.** Half a second after an edit, the page writes the scripts whose text
  differs from what the copy holds, removes the ones it deleted and, when the list of scripts changed, writes its
  workbook file. A script that it took from the agent counts as held by the copy. Both directions run one after the
  other (`AgentSessionCopies`).
- **The connections of the scripts of the agent.** The workbook file of the copy names the connection of every script,
  `{"name": "x.sql", "connectionId": "<id>"}`. A new script of the agent runs on the connection that the workbook file
  of the copy names for it when the tab takes it, else on the connection of its neighbors; the guide tells the agent to
  add the entry before it writes the script. A later change of the workbook file moves the scripts to the connections
  it names (`setScriptConnection`), a connection that the tab doesn't have leaves the script where it is.
- **The catalogs of the connections.** The tab writes `connections/<id>/dashql-catalog-relations.sql` into every copy for
  every connection that the agent may use: the tables that the connection reported, as `CREATE TABLE` statements with
  the types of their columns, the file that the core writes into the storage of the connection
  (`catalogRelationsFile` of the module, `relations_file_of_entry`). It writes a catalog again when its
  stamp changed: the relations entry and the catalog updates that finished. `dashql catalog` prints them, the route of
  the files of the copy takes them, nothing new goes over the wire.
- Not yet: scripts that the agent deletes or renames, the order of the workbook file of the copy, the attachments, the
  functions of a connection in its catalog file.
- When the session ends, the tab has everything, the copy is a cache: removed with the journal, or kept to start the
  next session faster.
- **Keep in project** moves the copy to a visible folder of the project and registers it as a native workbook (the
  desktop app). From then on the folder is the truth, as in case B.

Two tabs in one folder have two workbook ids, their copies don't clash.

### One journal per session

Built. A session of `dashql connect` has its own journal, `.dashql/sessions/<port>/journal.jsonl`: the port names
the session, no other session on the machine has it while it runs. `dashql connect` passes the name to the harness in
an environment variable without a secret in it (`DASHQL_SESSION`), `dashql run` appends to the journal of that session,
and to `.dashql/journal.jsonl` of `dashql session serve` without it. The folder of the session goes when it ends, two
sessions in one folder keep apart.

### Connections travel with the workbook

The parameters of a connection (host, catalog, user name, no secrets) are in the workbook file, `connections[].params`
matched by `connectionId`. They travel both ways with the workbook: `dashql run` uses the parameters of the folder, the
app takes them when it opens a folder. A connection that works in the tab has the same address on disk, and one that
the agent set up appears in the tab.

**The connections of the agent** (built). The connection picker of the prompt becomes, in AI, a menu
`2 / 4 connections` (`agent/agent_connections_picker.tsx`): the list of connections of the connection picker with a
checkbox as the trailing visual of each, the clouds in a group of their own after the other connections. Every
connection but a cloud is allowed until the user unticks it, also a new one; a cloud keeps the published workbooks and
is allowed only once the user ticks it. The tab keeps what the user ticked and unticked per target in the storage of
the tab. Once the server answers and after every change, the
page sends the allowed connections with their labels (`PUT /v1/connections/<token>`), the server writes them next to
the journal, `.dashql/sessions/<port>/connections.json`. A run in the tab takes only the allowed connections, the tab
decides. `dashql run` on a folder of its own with `DASHQL_SESSION` reads that file and treats a connection that is not
in it like one that can't be set up: its scripts are not run, with the reason. A result that the cache serves needs no
connection and is still served. `dashql describe` lists the allowed connections. The file is guidance for the agent,
not a boundary: the agent can write it.

### Logins stay in the tab

The tab logs in as it does for its own runs, a run of the agent in the tab uses its connections as they are. No token or
password reaches `dashql connect` or a process of the agent. A login of the agent through the tab, with a relay of
`dashql connect` and stand-in tokens for the runs of the command line tool, was built and removed again with the runs
in the tab (`docs/wip/tab_driven_runs.md`).

### What the page sends to the server

One channel from the page to the server, requests with the token of the session: the workbook of case A (`PUT` and
`DELETE` on the routes of its files), the selection of connections (`PUT /v1/connections/<token>`) and the events of the
runs that it runs (`POST /v1/runs/<token>/<run id>`). The server stays the one place the page talks to.

### How the agent learns DashQL

Which side does what is in [agent_integration.md](../design/agent_integration.md).

- **The guide** is `DESCRIBE_TEXT` of `describe_command.ts`: the layout of a workbook folder with the connection of a
  script in the workbook file, the commands, the rules of scripts (one statement each, reentrant DDL, `:name` of
  scripts, the embedded Hyper over cheap remote results, `@param`, `@manual`, client functions), charts (the `@vis` tag
  with an example, no sizes, `dashql vis` after every change), how to work, and that the user may take the workbook
  back. The text lives in the command, it fits the installed version.
- **In context from the start.** Claude Code gets the guide with a preface (`CONNECTED_AGENT_GUIDE`) in its system
  prompt (`--append-system-prompt`), which outranks the `CLAUDE.md` of a project. Codex gets the same text in the output
  of the hook at the start. The hook tells both where the copies are and lists the workbooks and the connections of the
  folder. `dashql describe` prints the guide again with them.
- **Commands that check.** `dashql catalog` prints the tables of the connections from the catalog files of the copy,
  `dashql vis` checks a chart against the result of its script and writes the PNG of it to look at, `dashql run`
  prints the syntax errors of its scripts first. The checks are local, on files and the core. The tab renders the PNG
  as it runs the query, an option of the run request and an event of the run (protocol 2, `tab_driven_runs.md`).
- **Fewer approvals.** Claude Code may run `dashql` and edit the copies without asking. `dashql connect --workbook-only`
  refuses edits of the file tools outside the copies in the hook of `PreToolUse`.
- **`dashql` on the path.** The agent of a harness that `npx` launched has no `dashql`: `dashql connect` writes one
  into the folder of the session and puts it first on the `PATH` of the harness (built).
- **A skill** only for the installed path without `dashql connect` (case B with hooks in the settings): a short
  `SKILL.md` in the package that says when to use DashQL and to run `dashql describe`, as the one of hyperdb-edge.
- **No MCP server for now.** The commands are the one interface for both cases and for the sessions without
  `dashql connect`, the agent runs them with its shell, `//tests/agents` covers that. MCP is the fallback for the runs in
  the process of `dashql connect` if a sandbox stands in the way: a tool of an MCP server runs in that process, outside
  the sandbox, and needs no token of the session in the environment of the agent.

To check before the runs over the server:

- Whether the default `shell_environment_policy` of Codex drops variables with `TOKEN` in their name from the commands
  of the agent, then `dashql run` lacks `DASHQL_SESSION_TOKEN`.
- Whether the sandbox of Codex (`workspace-write` without network) and the one of Claude Code let a command reach
  `127.0.0.1`. `dashql connect` can allow it for Codex with `-c`.
- Whether the managed settings of a company allow an MCP server that a session adds, should the fallback be needed.

### Order

1. The tab sends its workbook to `.dashql/workbooks/<id>/` and follows it; one journal per session; the channel from
   the page to the server. Built: one journal per session, the copy, the scripts in both directions. Open: the rest of
   the copy (see above).
2. The parameters of connections from the folder in `dashql run` and in the app.
3. The output of the hook at the start and `dashql describe`. Built, without the connections of the agent.
4. Runs of the copies in the tab, with the logins of the tab. Built (`docs/wip/tab_driven_runs.md`).
5. The menu of the connections of the agent. Built.

## Next


- The browser reaches `127.0.0.1` from `https://dashql.app` only with the permission for the local network of the
  browser (Chrome asks), Safari doesn't; the desktop app reaches it directly.
- `@akohn/dashql` and `@akohn/dashql-cli` are not on npm yet, the line of the prompt needs both published.
- `dashql connect` without `--launch`: the server alone, for a harness that runs already or in an IDE, with hooks
  installed once in its settings.

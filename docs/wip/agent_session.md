# Agent Sessions

Status: built. The hooks of Claude Code and Codex reach `dashql session serve`, the page follows the session through a
link or through the line of the AI side of its prompt (`dashql connect`). A tab that connects copies its workbook into
the folder of the session and takes the scripts that the agent changes there; the other files of the agent are not
yet the workbook of the page.

An agent works on DashQL from a harness in the terminal, Claude Code or Codex, with the Node `dashql` on the runtime
(`docs/design/dashql_runtime.md`). The page of DashQL only watches. There is no agent server that the page asks, no agent
access per workbook and no prompt in natural language.

## Connecting from the page

The prompt switches between SQL and AI. AI keeps the white card of the prompt, disables Run and the snippets, and
shows in the place of the editor a line to run in the folder of a project, in a field to copy with a button for a new
port: `npx -y @ankoh/dashql-cli connect --launch claude --port <port> --secret <secret>`. A switch between Claude Code
and Codex follows the switch of SQL and AI while AI is on. The editor keeps its draft for SQL.

- **The tab picks the address.** The first switch to AI picks a random port of 49152–65535 on `127.0.0.1` and a random
  secret, and follows that target like the target of a link, trying it every 2 s until a server answers
  (`agent/agent_connect.ts`, `AgentSessionProvider`). The tab keeps the target, the mode and the harness in the
  storage of the tab, a reload waits on the same line.
- **`dashql connect` listens and launches.** It runs the server of the session on that port with the secret as token
  and launches the harness with the hooks of the session in its arguments, nothing is installed
  (`packages/dashql-cli/README.md`). The session ends when the harness exits.
- **The first state switches to AI**, the user can switch back to SQL. SQL opens the prompt while the bar keeps the
  session, edits of the page can then race the writes of the agent.
- The page waits with requests that fail until the server is up; the browser logs them. Chrome asks once for the local
  network of a public page.

## The session

- **Hooks carry the events.** Every hook runs `dashql session hook <event>` (`packages/dashql-cli/README.md` has the
  settings of both harnesses). The first event starts `dashql session serve` on `127.0.0.1` with a token, detached;
  `UserPromptSubmit`, `PostToolUse`, `Stop` and `SessionEnd` go to it, and the page reads them from there.
  `SessionStart` prints the link of the session, `https://dashql.app/?data=` with `{"agentSession": {"endpoint",
  "token"}}`; the harness hands the output of the hook to the agent, which tells the user.
  Hooks run outside the sandbox of both harnesses, the commands of the agent inside it don't need the server:
  `//tests/agents` checks both (`docs/wip/agent_integration_tests.md`).
- **The agent works on files.** Its commands (`dashql lint`, `format`, `run`) read and write the workbook folder
  The page follows the folder.
- **The page watches.** The questions come from the terminal, and the terminal stops the agent.

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
    the stamps of the whole folder make the edits of the harness's own tools show up with the next command
  - `Script started`, `Script progress` (the phase, percent and rows of its query, at most once a second while it
    changes) and `Script result` (the key in the query result cache, the rows, the error, whether the cache served it).

  A command writes its files first and the marker after. Without a journal it appends nothing. `dashql run` is the
  only command that writes one today. When the server stops, it removes the journal.
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
- **The composer** takes SQL in SQL and nothing in AI, see [Connecting from the page](#connecting-from-the-page).
- **Wobble** stays: the greeting of an empty workbook and the face of the bar.

## Tests

- `//tests/agents`: Claude Code and Codex run a turn with the hooks of `dashql session hook`, the server holds the
  question, the command with its SQL file and the final message.
- `//packages/dashql-cli:test`: the server (token, origins, preflight, malformed paths), the payloads of both
  harnesses, a session that a hook starts; the journal: the server creates it, follows partial lines, folds the
  markers and hands out the files and results they name, and removes it when it stops; `dashql run` appends the files,
  the progress and the results of a workbook in the workspace it is given.
- `//packages/dashql:test_platform_node`: the markers and their fold (`session/workbook_journal.test.ts`), the state of
  a session with the log of the commands.
- The page test `app_agent_session`: the app with a link to a server, the bar, the log, AI and the switch back to SQL;
  then a new port, Codex, and a server on the port and secret of the line.
- `//packages/dashql-cli:test`: `dashql connect` with a harness of the test that runs the hooks it was given; the
  journal of a session of its own; the copy of the workbook of a page (writes, replacement, the stamps after a tool,
  paths it refuses).
- `//packages/dashql-cli:test` also: the connections of the agent next to the journal, `dashql run` that refuses
  the others, `dashql describe` that lists them.
- `//packages/dashql-cli:test` also: the logins of `dashql connect` (PKCE, the refresh, a callback of another
  request, the loopback listener, the password of the tab, the redirect of a Salesforce login and answers that don't
  fit) and a run on a Trino connection with OAuth and one with basic auth through the relay, where Trino gets the real
  token or the password of the tab and the run neither (`run_command.test.ts`); a Salesforce login through the tab with
  the core in both processes, the setup of a run with the stand-ins, the health checks on a fake tenant with the real
  token (`run_relay.test.ts`).
- `salesforce_test` of the core: the stand-ins read like the tokens of the login without a secret, the relay puts the
  core token and the Data Cloud token on their origins.
- `workbook_composer.test.tsx`: the logins that a run waits for open with a click, a password needs none;
  `agent/agent_session_logins.test.ts`: the tab sends the password of a connection that the agent may use only.
- `agent/agent_session_copy.test.ts`: the scripts of a copy that changed, rewrites and new scripts, the edits of the
  user into the copy, a copy adopted after a reload, the results of the agent once.
- `runtime/workbook_runs.test.ts`: a result that `importCachedResult` adds shows on the script of its key.
- The page test `app_agent_session` also checks that the tab writes its workbook into the session once it connects,
  not again after a reload, that an edit reaches the copy, that a rewrite of the agent is staged to accept and that
  the page fetches a result that the journal names, and that the menu of the connections of the agent sends the
  connections that stay ticked.

## Plan: the workbook, the connections and the logins of a session

Status: the first step is partly built, see [Order](#order).

### Two cases

- **A, the conversation starts in the page.** The user has a workbook with working connections in the tab, switches
  to AI and runs the line of `dashql connect` in the folder of a project. The site is the truth, the disk holds a copy
  for the agent.
- **B, the user stays in the shell.** The agent creates a workbook folder in the project and the page only shows it.
  The folder is the truth, the page holds a copy.

In both cases the agent works on files on disk and the page follows them, the direction of the files is what differs.

### Runs stay in the command line tool

The page reaches a database only where its endpoint allows the origin of DashQL through CORS, often not for a Trino
behind the proxy of a company, and there is no CORS proxy of DashQL. The command line tool reaches every endpoint, the
desktop app does as well. So the runs of a session are runs of `dashql run`, the page shows their results through the
journal and the query result cache that the server hands out, as it does today.

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
  per target, also across a reload (the storage of the tab keeps the copied workbooks): a copy again would replace
  what the agent did. After a reload the page adopts the copy, every script of it that differs from the page is a
  change of the agent.
- **The changes of the agent come back** (`agent/agent_session_copy.ts`). The first state that names a copy is what the
  page wrote, later stamps of its scripts that differ are changes of the agent: the page fetches a changed script and
  stages it as a rewrite to accept or reject (`setScriptText` with a diff), a new script becomes a script of the
  workbook, and its next changes go to that script. A script with the text of the page stays as it is. The server
  stamps the copies again after every `PostToolUse` and `Stop`, so an edit with a tool of the harness shows without a
  `dashql` command.
- **The changes of the user go into the copy.** Half a second after an edit, the page writes the scripts whose text
  differs from what the copy holds, removes the ones it deleted and, when the list of scripts changed, writes its
  workbook file. A script that it took from the agent counts as held by the copy, a rejected rewrite goes back. Both
  directions run one after the other (`AgentSessionCopies`).
- **The results of the agent's runs come into the page.** A result of the journal of a copy names its key in the query
  result cache: the page fetches its file from `/v1/results/<token>/<key>` once and adds it to its own cache with
  `importCachedResult` of the runtime, which makes the workbooks look up the cached results of their scripts again. A
  script of the page with the same key shows the result. The keys are equal when the connection signatures are
  (`docs/design/query_cache.md`): Trino with basic auth needs the same user on both sides (`DASHQL_TRINO_USER`), and a
  script that reads attachments has another key, the copy's attachments have other stamps. A key that the page has
  cached keeps its file, a run of the agent with `--refresh` doesn't replace it. Not checked end to end yet: the keys of
  a run of `dashql run` against the keys of the same scripts in the page.
- Not yet: scripts that the agent deletes or renames, the workbook file of the copy that the agent changes (the order,
  the connections), the attachments.
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
checkbox as the trailing visual of each. Every connection is allowed until the user unticks it, also a new one; the
tab keeps the unticked ones per target in the storage of the tab. Once the server answers and after every change, the
page sends the allowed connections with their labels (`PUT /v1/connections/<token>`), the server writes them next to
the journal, `.dashql/sessions/<port>/connections.json`. `dashql run` with `DASHQL_SESSION` reads that file and treats
a connection that is not in it like one that can't be set up: its scripts are not run, with the reason. A result that
the cache serves needs no connection and is still served. `dashql describe` lists the allowed connections. The file
is guidance for the agent, not a boundary: the agent can write it.

### Logins go through the page

Built for Trino with OAuth, Salesforce and Trino with basic auth. Logins don't leave the side that made them: the page
never hands a token to the command line tool, and no token or password reaches a process of the agent, which can read
and print it, and the telemetry of a managed Mac logs tool content. The process of `dashql connect` logs in and keeps
the channels, it is Node on the machine of the browser.

1. `dashql run` in a session of `dashql connect` sets up such a connection as usual, but first asks the server for a
   login (`POST /v1/auth/<token>/<connection id>` with the label and the params of the connection). It finds the
   server in `DASHQL_SESSION_ENDPOINT` and `DASHQL_SESSION_TOKEN`, else in `.dashql/sessions/<port>/server.json`, which
   `dashql connect` writes for the user only: a harness may keep variables with a token in their name from the
   commands of its agent.
2. The process of `dashql connect` (`connect_auth.ts`) keeps a runtime of its own, without storage, with the
   connections that runs logged in to. A connection without a channel is set up there with the setup of the core: the
   PKCE challenge, the authorization URL, the code exchange, the account of the token and, for Salesforce, the exchange
   for the Data Cloud token. Only the way to the user is Node and the tab. The login goes into `logins` of the state of
   the session with its kind (`AgentSessionLoginKind`):
   - `loopback`, Trino with OAuth: it redirects to a loopback address (`http://localhost:56512/Callback` unless the
     connection names another), not to the redirect page of the app: the web app can't take it at all, the desktop app
     listens on it. The process listens there. The prompt of the tab shows "The agent waits for a login to
     <connection>", **Log in** opens the URL in a popup, the identity provider redirects to the listener.
   - `redirect`, Salesforce: the connected app knows only the redirect page of the app. The tab says how its redirect
     page hands a login back (`AgentSessionOAuth`: the redirect page of the config of the app, the redirect variant,
     the callback page and the flavor of its OAuth flow) with its connections (`PUT /v1/connections/<token>`, kept in
     memory, not in `connections.json`), the setup of the process builds the state of the flow with it. **Log in**
     opens the URL with the OAuth flow of the app (`agent_session_provider.tsx`), the redirect page hands the callback
     to the tab, the tab posts it to the server (`POST /v1/login/<token>/<connection id>` with `{ oauthRedirect }`),
     and the process exchanges the code with its verifier.
   - `credentials`, Trino with basic auth: the tab sends the user and the password of its connection by itself
     (`{ basic: { username, secret } }` to the same route), for a connection that it lets the agent use; the prompt
     shows "The agent waits for the password of <connection>" until then. The channel of the process connects with
     them, the params of the process keep no password. The tab has the password while its connection was set up in
     this tab, the workbook keeps none.

   Logins run one after the other. A login waits 10 minutes; the request of the run answers "waiting" after 20 s and
   the run asks again, no request outlives the timeouts of fetch.
3. The run gets the account of the login and stand-ins, never a token. The answer of the login names the origins that
   the relay reaches and the responses of the token requests of the login with a stand-in token (`stand_ins` of
   `executor/connectors.rs`): for Trino with OAuth the token response with the account, for Salesforce the core token
   without a refresh token and the Data Cloud JWT with its header and claims and the stand-in as its signature
   (`salesforce/relay.rs`): the run reads the tenant, the data space and the expiry from it. The runtime of the run
   sets the connection up with the setup of the core: its OAuth flow gets a stand-in code, its HTTP client answers the
   token requests with the stand-ins (`run_relay.ts`), so the cached results are keyed by the account like in the app.
   Trino with basic auth needs no stand-in, its channel connects with the user of the tab and no password. Every
   request to an origin of the connection goes to the relay of the server (`/v1/relay/<token>/<connection id>`, the
   URL in `X-DashQL-Url`), which puts the auth of that origin in: the token of the core for the instance of Salesforce,
   the Data Cloud token with its audience for the tenant, the token or the password for Trino. The relay hands the
   headers of the answer back, e.g. the status of a query of Data Cloud, not the encoding of the body.
4. The relay asks the runtime for the auth of the channel before every request, `connectionAuthorization` of the
   runtime (`fresh_relay_auth` of the executor): the auth headers by origin and the account, with tokens that are
   refreshed first if they are about to expire, by the same refresh that a query runs before its requests.

- Anyone with the token of the session can query through the relay, as the agent can with `dashql run`. The tokens and
  the passwords of the connections stay in the process of `dashql connect`.
- The tokens end with the session. Keeping the refresh token in the keychain of the system is a later step.
- A run of Salesforce keeps the expiry of the Data Cloud token of its login: a client function on the tenant fails
  once it passed, a new run asks the process again, which refreshed it.
- Trino with basic auth keeps `DASHQL_TRINO_USER` and `DASHQL_TRINO_PASSWORD`: with the password set, a run doesn't
  ask the tab. A server of `dashql session serve` logs in to nothing, a run there takes the password of the workbook.
- Not checked against a real org or a real Trino with OAuth yet, the tests fake the login API of Salesforce and the
  Hyper of the tenant.

### What the page sends to the server

One channel from the page to the server, requests with the token of the session, for three things: the workbook of
case A (built, `PUT` and `DELETE` on the routes of its files), the selection of connections with the OAuth settings of
the tab (built, `PUT /v1/connections/<token>`), the answers to logins (built, `POST /v1/login/<token>/<connection id>`:
the callback of a Salesforce login, the password of a Trino connection; Trino with OAuth logs in on a loopback
address). The server stays the one place the page talks to.

### How the agent learns DashQL

- **The output of the hook at the start** goes into the context of the agent with both harnesses. Built: the hook of
  `dashql connect` says that DashQL shows the session, that the tab copies its workbook into `.dashql/workbooks/<id>/`
  and to run `dashql describe` first. Nothing is installed.
- **`dashql describe`** (built) prints the layout of a workbook folder, the commands, how the tab takes the changes of
  the agent and the workbooks that the tabs copied into the folder, like `hyperdb-edge describe`
  (`docs/wip/hyperdb_edge.md`). The text lives in the command, it fits the installed version. It reads the copies from
  disk, it needs no server and no token.
- **`dashql` on the path.** The agent of a harness that `npx` launched has no `dashql`: `dashql connect` writes one
  into the folder of the session and puts it first on the `PATH` of the harness (built).
- **A skill** only for the installed path without `dashql connect` (case B with hooks in the settings): a short
  `SKILL.md` in the package that says when to use DashQL and to run `dashql describe`, as the one of hyperdb-edge.
  Whether `dashql connect` can hand a skill to a harness without installing it is to check in the vendored harnesses,
  as the `-c` of the hooks of Codex was. With the output of the hook it doesn't need to.
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
   the page to the server. Built: one journal per session, the copy, the scripts in both directions, the results of the
   agent's runs. Open: the rest of the copy (see above).
2. The parameters of connections from the folder in `dashql run` and in the app.
3. The output of the hook at the start and `dashql describe`. Built, without the connections of the agent.
4. Logins through the page, runs of connections with a login through the process of `dashql connect`. Built for Trino
   with OAuth or basic auth and for Salesforce, through the relay.
5. The menu of the connections of the agent. Built.

## Next

- The browser reaches `127.0.0.1` from `https://dashql.app` only with the permission for the local network of the
  browser (Chrome asks), Safari doesn't; the desktop app reaches it directly.
- `@ankoh/dashql` and `@ankoh/dashql-cli` are not on npm yet, the line of the prompt needs both published.
- `dashql connect` without `--launch`: the server alone, for a harness that runs already or in an IDE, with hooks
  installed once in its settings.

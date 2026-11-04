# Agent Bridge

DashQL works with agents in both directions through a local **agent server**: agents call `dashql agent` commands
against the open DashQL session, and questions in the composer run the user's agent harness headless. The agent
bridge is the only way DashQL reaches models; there is no built-in LLM client.

The unbuilt parts (the rest of the menu bar mode, inline edit, "Fix with agent", data settings and the query policy)
and the open checks are in [docs/wip/agent_bridge.md](../wip/agent_bridge.md).

| Area | State |
|---|---|
| Transport | The page connects to a local agent server over `ws://127.0.0.1` |
| Server host | DashQL.app on macOS (menu bar); `dashql agent serve` everywhere else |
| Agent side | A skill plus the `dashql agent` commands of the `dashql` command line tool |
| App → agent | The agent server runs the user's harness headless, once per request |
| Agent edits | Applied directly, no pending diffs |
| Agent context | One harness session per DashQL session |
| Editor UI | No agent panel; the composer shows the agent |
| Browsers | Chrome and Edge (one-time permission), Firefox; Safari unsupported |
| Agent server, CLI and skill | One Rust binary, `packages/dashql-cli`, `dashql agent serve` |
| Real harnesses | Run on macOS: Claude Code 2.1 and opencode 1.18 pass; Codex 0.162 parses the arguments, no model access |
| `dashql` in DashQL.app | Bundled as `Contents/Resources/bin/dashql`; on macOS the app runs it as a child process |
| Page client, command registry, per-session toggle | `packages/dashql-app/src/agent/` |
| Menu bar mode | Server supervision, tray icon and menu, activation policy, `--menu-bar`, quit and update handling |

## Motivation

DashQL runs entirely on the client. It talks to embedded HyperDB WASM, remote
databases, or a local hyperd, and ships as a web build (https://dashql.app) and as an
Electron desktop build (`packages/dashql-native`, see `docs/design/electron.md`). It
should work with agents in both directions, without DashQL building its own agent loop:

- **(A) App → agent.** The user asks something in DashQL and a harness they already
  use (Codex, Claude Code, Gemini CLI, ...) does the work.
- **(B) Agent → app.** An agent reads the session's scripts and catalog, edits
  scripts, and runs queries in the open DashQL tab.

The web build is the priority. It also has to work on locked-down corporate machines.
There, harness settings are signed by admins, custom MCP servers cannot be configured
(or are overwritten after a few days), and only some harnesses are allowed. What works
there is a skill plus a script plus a local daemon.

## Decision

A browser page cannot listen on a port or start processes, so the page connects out
to a local **agent server**. On macOS, the agent server runs inside DashQL.app, which
stays in the menu bar after its windows close. Agents reach it through the `dashql agent` commands of the `dashql`
command line tool, which a skill teaches them to use.

```
                    DashQL.app (menu bar)
                    ┌───────────────────────────────────────────────┐
agent shell         │ main: tray menu, supervision                   │
  dashql agent … ───┼─HTTP + token─► `dashql agent serve`            │◄──WebSocket── dashql.app tab (Chrome, Edge, Firefox)
                    │                 127.0.0.1:47100                │◄──WebSocket── DashQL desktop windows
                    │                   └─ spawns `claude -p …`      │
                    └───────────────────────────────────────────────┘
```

- **Agent → app:** the agent calls `dashql agent` commands. The agent server forwards
  them to the connected tab, which executes them against the live session.
- **App → agent:** the tab sends a request to the agent server, which runs the
  configured harness headless with the request as the prompt. The agent then works
  through the same commands; its final message is the reply. One request and its reply
  are a **turn** of the session, as Codex and ACP call it.
- **The tab is the runtime.** Data, connections and the embedded database live in the
  page. The agent server only relays and starts turns, so the agent can act
  only while dashql.app (or a desktop window) is open.
- **No MCP, no ACP, no pairing flow, no files to sync.**

Running the server in a menu bar app solves the problems a script daemon has: it
runs outside any agent sandbox, so a harness cannot kill it; harness runs
start with the user's normal environment; and its state is visible in the menu bar. The same binary runs as
`dashql agent serve` for users without the desktop app.

This is the shape of other web apps with local helpers: Postman's desktop agent for
the browser version of Postman, Figma's font helper for figma.com, QZ Tray for printing
from web apps, and Ollama's menu bar app with its localhost API.

## Constraints

### Browsers

- **A page cannot listen.** It can only be the client of a local process.
- **Chrome and Edge:** [Local Network Access](https://developer.chrome.com/blog/local-network-access)
  gates requests from a public HTTPS page to loopback behind the "Apps on device"
  (`loopback-network`) permission. Since about Chrome 147 this also applies to
  [WebSockets](https://groups.google.com/a/chromium.org/g/blink-dev/c/4gx2y5jPGbU).
  Whether WebSockets get a prompt or are blocked outright is an open check.
- **Firefox:** treats `ws://127.0.0.1` as potentially trustworthy, so it is allowed
  from HTTPS.
- **Safari:** blocks `ws://localhost` from HTTPS pages as mixed content
  ([WebKit 171934](https://bugs.webkit.org/show_bug.cgi?id=171934), open since 2017).
  Safari users get a notice pointing to another browser or the desktop app.
- **CSP:** `connect-src` allows `ws:` (`packages/dashql-app/index.html`).

### macOS

- **Listening on loopback** needs no entitlement: DashQL.app uses the hardened runtime
  without the App Sandbox (`packages/dashql-native/Entitlements.plist`), and main
  also runs a loopback server for OAuth (`packages/dashql-native/src/oauth_loopback.ts`). Binding to
  127.0.0.1 only does not trigger the firewall prompt, and loopback is exempt from
  macOS's local network privacy prompt.
- **Environment:** apps started at login or from Finder get launchd's minimal `PATH`
  (`/usr/bin:/bin:/usr/sbin:/sbin`). Harness binaries in Homebrew, nvm or `~/.local/bin`
  are not on it.
- **Only macOS is packaged** (`docs/design/electron.md`). Windows and Linux
  users use `dashql agent serve`.

### Corporate harnesses

- Codex with admin-signed settings does not accept custom MCP servers. Claude Code's
  [managed MCP policy](https://code.claude.com/docs/en/managed-mcp.md) can restrict
  servers the same way. Skills and the agent's own shell are not affected.
- Harness sandboxes may block network access from the agent's shell, which would
  block the CLI's connection to the agent server. Codex does by default; its built-in template turns network access
  on, which admin-managed Codex settings may reject.

### App pieces the bridge builds on

- **Single owning tab:** `packages/dashql-app/src/platform/crosstab/app_ownership.ts` (Web Lock plus
  BroadcastChannel). Only that tab of a browser profile connects.
- **Electron lifecycle:** `app.requestSingleInstanceLock()` with `second-instance`
  handling, and `window-all-closed` keeps the app running on macOS
  (`packages/dashql-native/src/main.ts`). Main also supervises a utility process
  for the native proxy (`packages/dashql-native/src/native_proxy.ts`).
- **App actions the commands map to** (`packages/dashql-app/src/`):
  - the `session_scripts` reducer (`session/scripts/session_scripts.ts`):
    `CREATE_SCRIPT`, `SET_SCRIPT_TEXT`, `RENAME_SCRIPT`, `DELETE_SCRIPT`;
  - `useQueryExecutor` and `useCancelQuery` (`connections/query_executor.tsx`);
  - the catalog loader (`connections/catalog/catalog_loader.tsx`) and
    `buildSchemaContext` (`agent/agent_catalog.ts`);
  - the command-shaped shell API (`shell/api.ts`).
- **Question → SQL UX:** `ComposerInputMode.Ai` (`agent/input_mode.ts`) and
  `useAgentQuestions` (`agent/use_agent_questions.ts`), with the agent on top of the composer
  (`agent/agent_prompt_panel.tsx`). Without agent access the composer takes SQL only.

## Design

### Agent server

The agent server is part of `dashql`, one Rust binary (`packages/dashql-cli`, built with the core crates)
that also holds the agent commands of the command line tool and `dashql lint` for SQL files on disk. It needs
no runtime and runs in two hosts:

- **DashQL.app:** main starts the bundled binary as a child process (`dashql agent serve --exit-with-stdin`,
  `packages/dashql-native/src/agent_host.ts`), restarts it when it crashes (1, 2, 5, 10, 30 s), stops it on quit
  and before an update (SIGTERM, SIGKILL after 6 s), and follows its state for the menu (connected clients, turns)
  through `GET /v1/status` with the token from `config.json`. The app holds the server's stdin, so the server exits
  when the app crashes or is killed instead of keeping the port. When another server with the same
  `config.json` holds the port (`dashql agent serve` in a terminal), the app follows that one and takes over
  once it stops; anything else on the port shows as a failure in the menu.
- **`dashql agent serve`:** the same binary in a terminal or as a user-managed login item. For Windows, Linux,
  and users without the desktop app.

What it does:

- Listens on `127.0.0.1:47100` (configurable). The WebSocket endpoint takes
  connections from DashQL clients: the owning dashql.app tab of each browser profile,
  and desktop windows. The HTTP endpoint takes CLI calls.
- Tracks which client holds which DashQL session, and routes each CLI call to the
  client holding the target session.
- Queues CLI calls while no client holds the target session (default wait 30 s), then
  fails with "DashQL is not connected: open https://dashql.app and turn on agent
  access".
- Starts turns for requests from clients (see [App → agent](#app--agent)).
- On SIGTERM fails every turn with "The agent server stopped", kills the harness process groups (SIGKILL
  after 3 s) and waits until they exited, so no harness outlives the server.

Configuration and state live in `~/.dashql/agent/` (readable by the user only):
`config.json` (port, CLI token, harness commands) and `sessions/<id>/` (working folder
and harness session id per DashQL session).

Deleting a session in the app sends `agent/forget`: the server stops the session's turns and removes its folder,
once a running harness exited. A session deleted while the app is not connected leaves its folder behind, and no
client can tell that a folder is unused: every client (the desktop app, dashql.app in each browser profile)
announces only its own sessions with agent access. So the server also removes, at the start and then once a day,
the folders of sessions unused for 30 days. The time of `state.json` is the last use: every turn and every
announcement of the session marks it, and the folders of sessions with turns or announced by a client stay.

### Menu bar app

DashQL.app has a menu bar mode (macOS only). One process covers both states: menu bar only, and
menu bar plus windows.

| State | Dock | Menu bar | Agent server |
|---|---|---|---|
| Started with `--menu-bar` | Hidden (`app.setActivationPolicy("accessory")`) | Icon | Running |
| A window is open | Shown (`"regular"`) | Icon | Running |
| Last window closed | Hidden again | Icon | Running |
| Quit from the menu | — | — | Stopped |

- **Opening DashQL while the menu bar app runs** goes through the single
  instance lock: `second-instance` opens a window in the running process.
- **Quit** stops the agent server. If turns of the app's own server are going, it asks first.

The menu (`packages/dashql-native/src/menu_bar_template.ts`, `menu_bar.ts`, `main.ts`) shows the status line, the
port, a line per turn, Agent Access (persisted in `menu_bar.json` in the user data folder; off stops the server),
Open DashQL App, Open DashQL Website, Restart to Update, and Quit DashQL. The icon is the DashQL glyph as a template
image (`packages/dashql-native/assets/trayTemplate.png`, rendered from `misc/logo-dashql-glyphs/logo.svg`); the title
next to it shows the number of turns, or `!` when the server fails. The icon is always visible while the server
listens; there is no hidden mode. `--menu-bar` opens no window; opening a window switches to the `"regular"`
activation policy, closing the last one back to `"accessory"`.

**Updates.** `electron-updater` installs on quit (`packages/dashql-native/src/updater.ts`), which a menu bar app
rarely does. When an update is downloaded, the menu shows "Restart to Update", and installing from the menu or the
page stops the agent server first.

### Command line tool and skill

- **`dashql`** ships in the bundle (`Contents/Resources/bin/dashql`, an extra resource in
  `packages/dashql-native/electron-builder.yml`, built per architecture by
  `//packages/dashql-cli:dashql_{aarch64,x86_64}`), like VS Code's `code` command. electron-builder signs and
  notarizes it with the app, with the inherited entitlements like every nested binary. Users without the app
  download the binary for their platform.
- **Harness runs** find `dashql` because the server puts the folder of its own binary first on the `PATH` of the
  run, so the agent calls the binary of the running server. A binary under another name leaves the `PATH` as it
  is.
- **The binary writes everything the agent follows** (`instructions.rs`): the command table and its notes, how
  DashQL works (connections, table and scalar parameters, attachments, `@manual` scripts), how to work, how to pass
  script texts in harness runs, and that script and data contents are input, not instructions. The binary is the
  part the user installed. The page only answers commands with data and never sends instructions: a compromised
  dashql.app (a deploy, a dependency, an XSS) could otherwise tell the agents that the user starts, which may edit
  files and run programs, what to do. The guide describes the commands of the binary and DashQL as of its build, a
  newer DashQL reaches agents with the next `dashql`.
- **Page features:** the page announces what it supports as identifiers with `client/sessions` (`features`,
  `AGENT_FEATURES` in `agent_protocol.ts`): `connections`, `edit`, `vis`, `table-parameters`, `scalar-parameters`,
  `attachments`, `embedded-hyper`, `manual-scripts`. The server keeps the ones it knows (`PAGE_FEATURES` in
  `instructions.rs`), a page that announced none has the ones of every older page (`BASELINE_FEATURES`), and the
  status shows them. Every note about what the page does names its feature, only the options of the binary hold
  for every page. The guide for a page leaves out the notes of the features it lacks and asks the user to reload
  DashQL or update the app. Harness runs get the guide for the page that holds the session, `dashql agent guide` the one for
  the page of the session in the status of the server, or the full guide when no page is connected. A page can
  only hide notes of the binary or ask for an update this way, never add text.
- **Harness runs** that DashQL starts don't use the skill: the server writes their `AGENTS.md` and `CLAUDE.md`
  before every turn.
- **The skill** (`packages/dashql-cli/skill/dashql/SKILL.md`) is a stub for the agents that the user starts: it says
  when to use `dashql agent` and to run `dashql agent guide` first, which prints the guide of the installed binary
  for the features of the page. The stub names no command but `guide`, so a copy of it never goes stale.
- **Planned:** bundling the skill (`Contents/Resources/skill/dashql`) and the menu's "Install command line tool…"
  and "Install agent skill…", see [docs/wip/agent_bridge.md](../wip/agent_bridge.md).

### Commands

The agent commands are defined once, in `packages/dashql-cli/src/agent/commands.rs`: the table makes the usage
of `dashql agent`, the command table of the `AGENTS.md` and `CLAUDE.md` of harness runs, and the server accepts
only their calls. A test checks that the skill sends the agent to `dashql agent guide`. Next to them, `dashql agent serve` runs the agent server in the foreground
and `dashql lint <file.sql|dir|->...` lints SQL files on disk with the native dashql-core, without DashQL.

- Compact text on stdout, `--json` where useful, real exit codes (0 ok, 1 failed, 2 not
  connected or usage).
- **Target session:** `--session <id>`, otherwise `DASHQL_SESSION` (set for harness
  runs the server starts), otherwise the focused session.
- **One call at a time per session**; a concurrent call gets a clear "busy" error.
- **Writes are verifiable:** `edit` prints the new text's hash and the analyzer's
  diagnostics.
- **Connections:** the commands take the connections of the session and the embedded Hyper, which combines the
  results of the other connections and the attachments. `scripts` marks it as `embedded Hyper` and lists it for
  every session, the page allocates it when the app holds none yet. `scripts` lists the attachments with their
  columns, `catalog` of the embedded Hyper lists the Parquet attachments as table parameters. `scripts` marks the
  remote connections whose query results DashQL caches with `caches results` (`cachesResults` in `--json`): the
  scripts on the embedded Hyper that read their scripts rerun on the cached results, so the guide asks for a cheap
  remote script at the grain of the question and the post-processing on the embedded Hyper.

### Page side

The WebSocket client (`agent_client.ts`), the protocol types (`agent_protocol.ts`), the command registry
(`agent_commands.ts`), the provider (`agent_bridge.tsx`), the agent view and the agent session menu live in
`packages/dashql-app/src/agent/`.

- **Agent access toggle** per session, off by default. Start Session in the header of a session turns it on
  right away. The sessions with access are an app setting (`agentSessions`), so a shared session file never turns
  access on. While on, the client keeps a WebSocket to `ws://127.0.0.1:47100/v1/ws` and reconnects with backoff.
  After a page reload it reconnects and the server delivers whatever is queued, so nothing is lost. A call that is
  in flight when the page goes away fails. The page counts as connected once the server answered its
  announcement. When the connection drops, the page fails the turns it follows, a new server does not know them.
  A server with another protocol version closes with 1008: the page shows that the versions differ (update
  DashQL or reload the page) and retries every 30 s.
- **Command registry:** one handler per command, wrapping the existing reducers,
  executor and catalog code.
- **Protocol:** JSON-RPC-style messages (`{id, method, params}` → `{id, result |
  error}`), plus notifications for turns (`agent/status`, `agent/done`,
  `agent/failed`). The JSON Schema `proto/json/dashql/agent_bridge.json` defines the messages, the page
  generates its types from it. A client announces the sessions it holds when it connects and when
  they change.
- **Desktop windows** use the same client over the same WebSocket. They need no
  special path, and the agent can target a desktop session like a browser one.
- **Safari** shows a notice instead of the toggle.

### Authentication

- **Clients → server:** the server accepts a WebSocket only with `Origin:
  https://dashql.app`, `app://bundle` (desktop windows) or the origins configured in `config.json`, and
  `Host: 127.0.0.1:<port>` or `localhost:<port>`. Development builds also accept the web dev server
  (`http://localhost:9002` or `http://127.0.0.1:9002`, `client_origins` in `config.rs`); release builds
  (`--config=release`, `cfg(dashql_release)`) don't, since any page on that port, e.g. the dev server of another
  project, would become a DashQL client. Other websites cannot fake `Origin`,
  and the `Host` check blocks DNS rebinding. Local processes can fake both, but they
  can already read the user's files. No pairing flow is needed.
- **CLI → server:** a token from `~/.dashql/agent/config.json`. This keeps out other
  users on the same machine, who share 127.0.0.1.
- **Consent:** the per-session toggle in the app, and the global "Agent Access" switch
  in the menu.

### App → agent

1. The user asks in the composer.
2. The client sends `agent/request {session, harness, model, effort, prompt}`. `harness` is a name
   such as `codex`, `model` and `effort` are values of the harness's `models` and `efforts` in `config.json`, the
   harness's own defaults if omitted; the prompt carries the request, the target script and selection,
   and a short summary of what changed since the previous request.
3. The server runs the command template for that harness from `config.json` in
   `~/.dashql/agent/sessions/<id>/`, with `DASHQL_SESSION` set and the resolved `PATH`.
   The prompt is passed as one argument, never through a shell. The built-in templates
   (`packages/dashql-cli/src/agent/config.rs`); Claude Code is the default:

   ```sh
   claude -p --output-format stream-json --verbose --allowedTools "Bash(dashql agent:*)" "Edit(./input/*)" \
       --disallowedTools "Bash(dashql agent serve:*)" [--model <m>] [--effort <e>] [--resume <id>] -- "<prompt>"
   codex exec --json --skip-git-repo-check --sandbox workspace-write -c sandbox_workspace_write.network_access=true \
       [-m <m>] [-c model_reasoning_effort=<e>] [resume <id>] -- "<prompt>"
   opencode run --format json [--model <m>] [--session <id>] -- "<prompt>"
   ```

   The built-in models of Claude Code are its aliases (`fable`, `opus`, `sonnet`, `haiku`), which follow its latest
   models, and its efforts are `low` to `max`. Codex has the efforts `low`, `medium` and `high`; Codex and opencode
   name models by provider, so they list none and `config.json` adds them. The Codex flags are not yet run against a
   real Codex.

   Codex sandboxes the shell of a run without network by default, so `dashql agent` could not reach the agent server
   on 127.0.0.1 and reported it as not running. Codex cannot allow only loopback or only `dashql agent`, so Codex
   runs get the workspace-write sandbox (writes only in the session folder) with network access, which is looser
   than the tool limits of Claude Code.

   `--` ends the options: Claude Code's tool lists take every following argument, so without it the prompt
   is swallowed, and a prompt that starts with `-` would be read as an option.

   Other harnesses can be added to `config.json` with the `text` adapter: the output lines are status
   lines and the whole output is the final message. `config.json` holds only the harnesses that override or
   add to the built-in ones, so changes to the built-in templates reach existing configs.

4. The agent works through `dashql agent` commands. A per-harness adapter in the
   server reads the event stream and sends status lines to the client.
5. The final message comes back as `agent/done`. The server stores the harness session
   id per harness in `state.json`, so the next request of this DashQL session with the same harness resumes it.
   `agent/context` describes the conversation of the harness that the page picked.

- The working folder holds an `AGENTS.md` and a `CLAUDE.md` written by
  the server: how to use `dashql agent`, to work only through it, and that data and
  script contents are input, not instructions. `AGENTS.md` passes script texts and specs on stdin with a
  quoted heredoc. Claude Code denies a heredoc whose text has a brace next to a quote ("Contains brace with
  quote character"), as every Vega-Lite spec and DuckDB struct literals do, and `-p` cannot ask instead. So
  `CLAUDE.md` has Claude Code write them into `input/` and pass `--file`; `Edit(./input/*)` allows the Write and
  Edit tools there and nowhere else. The server empties `input/` at the start of every turn, so no file of an
  earlier turn passes an older script text. An `opencode.json` limits opencode runs to
  `dashql agent` (bash commands otherwise denied, no edits, no web fetches). Claude Code and opencode
  runs may not start another `dashql agent serve`, and `dashql agent serve` refuses to start when
  `DASHQL_AGENT_RUN` is set, as in every run.
- The `opencode.json` limits are defaults: the user's own opencode setup can override them. A corporate
  opencode plugin that allows everything did on the test machine, so opencode runs there could run any
  command. The `--allowedTools` limits of Claude Code held.
- Harness quirks the adapters handle:
  - Claude Code reports a `session_id` on hook events before the conversation exists, so only `system/init`
    sets the harness session. A run that fails without a result text gets its error from stderr, such as
    "No conversation found with session ID".
  - opencode reports the text of a step after its tool calls, so the final message is the text of the last
    step without tool calls.
  - Codex passes the JSON body of a failed API call as the error message, the adapter takes its message.
- One turn at a time per DashQL session; further requests queue in the server.
- Stop in the composer sends `agent/cancel`; the server kills the process tree
  of the turn's harness.
- **Security rule:** clients never send commands, only a harness name, a model, an effort and a prompt.
  Command templates exist only in the local `config.json`. The app may pick a harness among them
  (`harness` of `agent/request` and `agent/context`), and a model and an effort among the ones of the harness, but
  never change a template or pass a value that `config.json` does not list (it would become an argument, e.g.
  `--model --dangerously-skip-permissions`), and the server never writes
  `config.json` after creating it. Otherwise a bug in dashql.app (XSS, for example) could run arbitrary commands
  on the user's machine.

**Environment for harness runs.** Because launchd's `PATH` lacks Homebrew, nvm and
`~/.local/bin`, the agent server resolves `PATH` once from the user's login shell
(`$SHELL -ilc 'printf %s "$PATH"'`), as VS Code does, and harness templates may use
absolute paths.

### Settings

The Agent button in the top bar configures the bridge. It holds the connection open while
it is shown, so it also works before any session has agent access. Once a session has agent access, its
header shows Control Session: Disconnect the Session turns the access off, Reset the Session forgets the agent
context, Continue in terminal copies the command that continues the harness session.

- **Port** of the agent server, an app setting (`agentPort`); the build's default otherwise.
- **Harness:** picks among the configured harnesses (`agent/info`), an app setting (`agentHarness`); the
  `defaultHarness` of `config.json` otherwise. A harness whose binary is not on the `PATH` of harness runs is
  disabled. Templates are edited in `config.json`.
- **Model** and **effort:** pick among the `models` and `efforts` of the harness (`agent/info`), or Default for the
  harness's own, app settings (`agentModel`, `agentEffort`). Picking another harness restores both defaults. Turns show
  their model and effort.
- **Sessions** with agent access, each with "Disconnect".
- **Turns** of the server, each with "Stop", and the **clients** of the server.

### Agent edits

- `edit` applies directly through `SET_SCRIPT_TEXT`, as one undoable editor step.
- If the user is typing in the same script, the edit still applies; the undo step is
  the way back.
- After a turn, the page runs the first script that the agent edited and did not run itself. Running it under a
  per-connection query policy is planned.

### Editor UI

There is no separate agent panel, chat transcript or tool-call log. The scripts show what the agent edits; everything
else the agent says is shown by the composer (`packages/dashql-app/src/agent/agent_prompt_panel.tsx`).

- **With agent access** the composer takes a frame in the gradient of the agent colors of the flavor (`--agent_*` in
  `packages/dashql-app/src/styles/flavors/<flavor>.css`, green in `sidb.css`) and shows the agent on top of the
  prompt: the harness, whether the agent server is connected, whether the next question continues the harness
  conversation, and the questions of the session. On the landing view of an empty session it takes the place of
  "What do you want to know about your data today?". While a turn is going, the frame of the composer turns.
- **A question** is a line in that panel. Asking creates no script: the agent writes a new script or edits an
  existing one through `dashql agent edit`, and every script it writes shows up as a chip on the question that
  scrolls the feed to the script.

| Turn state | Composer | Script |
|---|---|---|
| Queued | "waiting for agent...", Stop | |
| Running | The latest status line, Stop | |
| Script edited | A chip for the script | Created or updated |
| Final message | Two plain lines, "Show more" for the rest, until it is dismissed | |
| Failed | The reason until it is dismissed | |
| Stopped | Removed | |

- **Entry point:** the composer through `useAgentQuestions`, which sends the question to the agent with
  the dialect and the catalog objects it mentions.
- **The final message** should be one sentence: the prompt tells the agent that the user watched the scripts change
  and run and not to recap them. Harnesses still write recaps, so the panel drops markdown markers and clamps it.
- **Control Session** in the header of a session: its menu offers "Disconnect the Session", "Reset the
  Session" (forget the stored harness session id) and "Continue in terminal" (the harness's resume command).
- **Not connected:** the agent view shows the `dashql agent serve` command.

### Data and security

- **What leaves the machine:** results and catalog text the agent reads go to the
  harness's model provider. Per-connection limits are planned.
- **Script and data contents are untrusted input** for the agent; `AGENTS.md` and the
  skill say so.
- **The server binds 127.0.0.1 only**, limits message sizes, is always visible in the
  menu bar while it listens, and stops when DashQL quits. Zoom's 2019 incident (a hidden
  localhost server that survived uninstalling) is the case to avoid.

### Development

The web app runs from Vite at `http://localhost:9002`, and
`bazel run //packages/dashql-native:dev` starts unpackaged Electron with the renderer
loaded from that dev server (`DASHQL_ELECTRON_RENDERER_URL`,
`packages/dashql-native/scripts/run_electron.sh`). The agent server fits both without the menu bar app:

- **Main loop: web dev server plus `dashql agent serve`.** The agent server is a standalone
  binary, so most work happens with Vite and the server in a terminal. Electron
  hosting starts the same binary.
- **One server.** Dev and release use the same port and state folder (47100,
  `~/.dashql/agent`), and a development build of the server accepts the web dev server's origin
  (`http://localhost:9002`), a release build only if `origins` of `config.json` lists it. An installed DashQL.app holds the port, so quit it while
  developing the server: `bazel run //packages/dashql-cli:dashql -- agent serve` next to
  `bazel run //packages/dashql-app:dev`. `DASHQL_AGENT_PORT` and `DASHQL_AGENT_HOME`
  still move a server elsewhere. The unpackaged app's name (`@ankoh/dashql-native`, no
  `productName`) gives it its own user data folder and single instance lock.
- **Menu bar in dev:** the tray, menu and activation policy work in unpackaged Electron;
  `bazel run //packages/dashql-native:dev -- --menu-bar` simulates a start at login.
- **CLI in dev:** `bazel run //packages/dashql-cli:dashql -- agent <command>`.
- **Local Network Access is not exercised in dev.** A page on `http://localhost`
  reaching 127.0.0.1 is local to local, so Chrome shows no permission prompt. Testing the
  prompt needs the page on a public HTTPS origin: the deployed site, a preview
  deployment, or a tunnel.
- **Logs.** `dashql agent serve` writes `[dashql] <UTC time> <message>` lines to stderr:
  every WebSocket message in full (`Client 3 <-` received, `Client 3 ->` sent), the
  bodies of `POST /v1/call` and their responses, the turns from queued to answered, and
  each turn's harness command, PATH, raw stdout and stderr lines and exit status.
  `GET /v1/status` polls are not logged. The page logs the same messages and its
  connection changes under `agent_client` and `agent_bridge` in the app's log.
  DashQL.app writes the server's lines and its own `[agent-host]` lines (spawn, exit,
  restart, state) to the console of the main process. Messages and lines over 64 KiB
  are cut.

## Files

- `packages/dashql-cli/src/agent/`: the agent server and the commands of the `dashql` binary (Rust,
  tokio and tungstenite), `packages/dashql-cli/skill/`, tests (`bazel test //packages/dashql-cli:tests`)
- `packages/dashql-app/src/agent/`: WebSocket client, protocol types, command registry, provider, agent view, agent
  session menu, composer question flow (`use_agent_questions.ts`, `agent_prompt_panel.tsx`)
- `packages/dashql-app/src/app/app.tsx` (`AgentBridgeProvider`), `packages/dashql-app/src/app/navbar.tsx` (Agent button)
- `proto/json/dashql/agent_bridge.json`: the protocol schema
- `packages/dashql-native/src/agent_host.ts`: supervision of the `dashql agent serve` child process, status
- `packages/dashql-native/src/menu_bar_template.ts`: the menu as data, tested without Electron
- `packages/dashql-native/src/menu_bar.ts`: tray and menu
- `packages/dashql-native/src/main.ts`: menu bar mode, `--menu-bar`, `second-instance`, quit and update handling
- `packages/dashql-native/src/updater.ts`: status listener for the menu
- `packages/dashql-native/electron-builder.yml`: the `dashql` binary and the tray icons as extra resources
- `packages/dashql-native/assets/trayTemplate.png`, `trayTemplate@2x.png`: the menu bar icon

## Verification

- **Agent server unit tests** (`bazel test //packages/dashql-cli:tests`): `Origin`, `Host` and token checks;
  routing calls to the client holding a session; queuing while disconnected; one call at a time; cancel
  kills the process tree.
- **Bridge tests** (`bazel test //packages/dashql-cli:bridge_test`): the `dashql` binary as server, command
  line tool and `dashql` of harness runs, a page on the WebSocket, and a scripted harness that speaks Claude Code's
  stream-json. Agent → DashQL: every command, `--file` and stdin, `--json`, session targeting, exit codes, wrong token,
  no server, the page going away during a call. DashQL → agent: a run that calls back into its own session,
  status lines, resume and reset, a failed run's stderr, cancel stopping the harness's children, no nested
  server. It also checks that `--exit-with-stdin` stops the server.
- **Real harnesses** (`bazel test //packages/dashql-cli:bridge_harness_test`, manual, unsandboxed, costs
  model calls; `--test_env=DASHQL_TEST_HARNESSES=opencode` picks harnesses): a composer question that edits,
  runs and answers, a follow-up that needs the conversation, and a cancel.
- **Page tests:** the commands against a test session (`agent_commands.test.ts`), the client and its reconnect
  (`agent_client.test.ts`).
- **Agent host** (`bazel test //packages/dashql-native:test`, `agent_host.test.ts` against the real `dashql`
  binary): starts the server, sees a page connect with `app://bundle`, restarts after SIGKILL, follows another
  server with the same configuration and takes over when it stops, reports a taken port and a missing binary,
  stops and frees the port. The menu itself is tested as data (`menu_bar_template.test.ts`).
- **Menu bar mode** is checked by hand with `bazel run //packages/dashql-native:dev -- --menu-bar`: the icon
  shows, `dashql agent status` reaches the server, a killed server comes back, and killing Electron stops the
  server.

## Prior Art

| Project | Shape |
|---|---|
| Postman desktop agent, Figma font helper, QZ Tray | A small local helper serves localhost so a web app in the browser can do what the browser can't. QZ Tray installs a local certificate to use `wss://localhost`. |
| Ollama | Menu bar app keeping a localhost API running for web UIs and CLIs. |
| Obsidian | [Official CLI](https://www.dsebastien.net/the-complete-guide-to-the-obsidian-cli-everything-you-can-do-from-the-terminal/) that remote-controls the running Electron app over local IPC. Lessons: real exit codes, one call at a time, verifiable writes. |
| Zotero, Joplin, Anytype | The desktop app serves a local HTTP API with a token; MCP servers and scripts are thin clients ([Zotero](https://mcpservers.org/servers/kujenga/zotero-mcp), [Anytype](https://glama.ai/mcp/servers/ohneben/Anytype-MCP)). |
| tldraw / Excalidraw MCP servers, Agent MCP Studio | A local process pushes to a browser page over WebSocket ([tldraw](https://glama.ai/mcp/servers/Mihai-Codes/tldraw-mcp-server), [Agent MCP Studio](https://news.ycombinator.com/item?id=47899375)). |

## Alternatives Considered

- **A separate menu bar app** (its own small Electron bundle, or a native helper inside
  DashQL.app). A second Electron runtime doubles the download; a native helper means a
  second code base. DashQL.app in menu bar mode reuses packaging, signing, notarization
  and updates.
- **Script daemon only** (`dashql agent serve` started by the CLI). Kept as the
  fallback; as the main path, a daemon started from inside an agent's sandbox may be
  killed with the agent's call, and runs inherit the sandbox.
- **Hosted cloud relay** (page and agent both connect out, messages
  end-to-end encrypted). Works in every browser including Safari and lets remote agents
  reach the tab, but puts a service into the data path. Can reuse the same protocol
  later.
- **Shared folder** (File System Access API plus files, Maildir-style mailbox). Chrome
  and Edge only; one permission click per visit.
- **Browser extension with native messaging.** Covers Safari, but is heavy to build and
  ship, and companies often restrict extensions.
- **Desktop app only** (no web support). Simple, but leaves the web build without agent
  features.
- **MCP server or ACP client.** Blocked or overwritten under corporate MCP policy; ACP
  needs adapter packages, and the browser cannot speak it without a local relay.
- **An OpenAI-compatible LLM client in the app** with endpoint settings. Removed: the agent bridge is the only path
  to models.
- **[Claude Code channels](https://code.claude.com/docs/en/channels-reference),
  [Codex app-server](https://learn.chatgpt.com/codex/app-server), MCP sampling,
  WebMCP, browser automation.** Single-harness, experimental, deprecated, in-browser
  agents only, or brittle.

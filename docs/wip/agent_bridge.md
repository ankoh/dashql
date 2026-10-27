# Agent Bridge

## Status

Agent → app and the composer's question flow are implemented; the menu bar mode is started (macOS: DashQL.app
runs the agent server and shows it in the menu bar). The agent bridge is
the only way DashQL reaches models: the OpenAI-compatible client and its endpoint settings are removed.

| Area | State |
|---|---|
| Research and option survey | Complete |
| Priority | Decided: the web build at https://dashql.app |
| Transport | Decided: the page connects to a local agent server over `ws://127.0.0.1` |
| Server host | Decided: DashQL.app on macOS, running as a menu bar app; `dashql agent serve` as the fallback |
| Agent side | Decided: a skill plus the `dashql agent` commands of the `dashql` command line tool |
| App → agent | Decided: the agent server runs the user's harness headless, once per request |
| Agent edits | Decided: applied directly, no pending diffs |
| Agent context | Decided: one harness session per DashQL session |
| Editor UI | Decided: no agent panel |
| Browsers | Chrome and Edge (one-time permission), Firefox; Safari unsupported |
| Browser loopback probe | Built (`~/repos/dashql-agent-bridge-spike`), not yet run in browsers |
| Agent server, CLI and skill | Built: one Rust binary, `packages/dashql-cli`, `dashql agent serve` |
| Bridge tests | Built: `//packages/dashql-cli:bridge_test` (scripted harness), `:bridge_harness_test` (real ones, manual) |
| Real harnesses | Run on macOS: Claude Code 2.1 and opencode 1.18 pass; Codex 0.162 parses the arguments, no model access |
| `dashql` in DashQL.app | Bundled as `Contents/Resources/bin/dashql`; on macOS the app runs it as a child process |
| Page client, command registry, per-session toggle | Built: `platform/agent/`, `app/agent/` |
| App → agent from the composer | Built: questions run the harness, status lines, notes, stop, reset, continue in terminal |
| OpenAI-compatible client and AI endpoint settings | Removed |
| Menu bar mode | Started: server supervision, tray icon and menu, activation policy, `--menu-bar`, quit and update handling; login item, installers, settings and stopping single turns planned |
| Inline edit, "Fix with agent", data settings, query policy | Planned |
| Earlier MCP, ACP, mailbox and desktop-only designs | Superseded, see [Alternatives Considered](#alternatives-considered) |

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
stays in the menu bar after its windows close and starts at login. Agents reach it
through the `dashql agent` commands of the `dashql` command line tool, which a skill teaches them to use.

```
                    DashQL.app (menu bar, starts at login)
                    ┌───────────────────────────────────────────────┐
agent shell         │ main: tray menu, login item, supervision       │
  dashql agent … ───┼─HTTP + token─► `dashql agent serve`            │◄──WebSocket── dashql.app tab (Chrome, Edge, Firefox)
                    │                 127.0.0.1:47100                │◄──WebSocket── DashQL desktop windows
                    │                   └─ spawns `codex exec …`     │
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
starts at login outside any agent sandbox, so a harness cannot kill it; harness runs
start with the user's normal environment; its state is visible in the menu bar; and
it installs the command line tool and the skill. The same binary runs as
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
  Sources disagree on whether WebSockets get a prompt or are blocked outright; the
  probe settles this. If Chrome blocks without a prompt, this decision has to be
  revisited.
- **Firefox:** treats `ws://127.0.0.1` as potentially trustworthy, so it is allowed
  from HTTPS.
- **Safari:** blocks `ws://localhost` from HTTPS pages as mixed content
  ([WebKit 171934](https://bugs.webkit.org/show_bug.cgi?id=171934), open since 2017).
  Safari users get a notice pointing to another browser or the desktop app. See
  [Later](#later) for a certificate-based path.
- **CSP:** `connect-src` already allows `ws:` (`packages/dashql-app/index.html`).

### macOS

- **Listening on loopback** needs no entitlement: DashQL.app uses the hardened runtime
  without the App Sandbox (`packages/dashql-native/Entitlements.plist`), and main
  already runs a loopback server for OAuth (`src/oauth_loopback.ts`). Binding to
  127.0.0.1 only does not trigger the firewall prompt, and loopback is exempt from
  macOS's local network privacy prompt.
- **Login items:** on macOS 13 and later, login items and background agents are
  registered through `SMAppService`, which Electron exposes through
  `app.setLoginItemSettings`. macOS notifies the user when one is added, lists it in
  System Settings → General → Login Items, and lets the user (or MDM) turn it off.
- **Environment:** apps started at login or from Finder get launchd's minimal `PATH`
  (`/usr/bin:/bin:/usr/sbin:/sbin`). Harness binaries in Homebrew, nvm or `~/.local/bin`
  are not on it.
- **Only macOS is packaged** today (`docs/design/electron.md`). Windows and Linux
  users use `dashql agent serve`.

### Corporate harnesses

- Codex with admin-signed settings does not accept custom MCP servers. Claude Code's
  [managed MCP policy](https://code.claude.com/docs/en/managed-mcp.md) can restrict
  servers the same way. Skills and the agent's own shell are not affected.
- Harness sandboxes may block network access from the agent's shell, which would
  block the CLI's connection to the agent server. The user's existing skill + script +
  daemon setup works at work, so loopback is presumably allowed; this needs confirming
  for `codex exec`.

### What already exists

- **Single owning tab:** `platform/crosstab/app_ownership.ts` (Web Lock plus
  BroadcastChannel). Only that tab of a browser profile connects.
- **Electron lifecycle:** `app.requestSingleInstanceLock()` with `second-instance`
  handling, and `window-all-closed` already keeps the app running on macOS
  (`packages/dashql-native/src/main.ts`). Main already supervises a utility process
  for the native proxy (`src/native_proxy.ts`).
- **App actions the commands map to:**
  - the `session_scripts` reducer (`app/session/scripts/session_scripts.ts`):
    `CREATE_SCRIPT`, `SET_SCRIPT_TEXT`, `RENAME_SCRIPT`, `DELETE_SCRIPT`;
  - `useQueryExecutor` and `useCancelQuery` (`app/connections/query_executor.tsx`);
  - the catalog loader (`app/connections/catalog_loader.tsx`) and
    `buildSchemaContext` / `findSqlProblems` (`app/session/ai/sql_generation.ts`);
  - the command-shaped shell API (`packages/dashql-app/src/shell/api.ts`).
- **Question → SQL UX:** `ComposerInputMode.Ai` (`app/session/ai/input_mode.ts`) and
  `useSqlGenerations` (`app/session/ai/use_sql_generations.ts`), with the agent on top of the composer
  (`ai/ui/agent_prompt_panel.tsx`).
- **An OpenAI-compatible LLM client** (`platform/ai/ai_client.ts`) with endpoint settings: removed. The agent
  bridge is the only path to models; without agent access the composer takes SQL only.

## Design

### Agent server

The agent server is part of `dashql`, one Rust binary (`packages/dashql-cli`, built with the core crates)
that also holds the agent commands of the command line tool and `dashql lint` for SQL files on disk. It needs
no runtime and runs in two hosts:

- **DashQL.app:** main starts the bundled binary as a child process (`dashql agent serve --exit-with-stdin`,
  `src/agent_host.ts`), restarts it when it crashes (1, 2, 5, 10, 30 s), stops it on quit and before an update
  (SIGTERM, SIGKILL after 6 s), and follows its state for the menu (connected clients, turns) through
  `GET /v1/status` with the token from `config.json`. The app holds the server's stdin, so the server exits
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

### Menu bar app

DashQL.app gains a menu bar mode. One process covers both states: menu bar only, and
menu bar plus windows.

**States**

| State | Dock | Menu bar | Agent server |
|---|---|---|---|
| Started at login | Hidden (`app.setActivationPolicy("accessory")`) | Icon | Running |
| A window is open | Shown (`"regular"`) | Icon | Running |
| Last window closed | Hidden again | Icon | Running |
| Quit from the menu | — | — | Stopped |

- **Starting at login:** a "Start DashQL at login" setting calls
  `app.setLoginItemSettings`. The app must know it was started at login so it opens no
  window. On macOS 13 and later the older `openAsHidden` / `wasOpenedAtLogin` flags are
  unreliable, so the login item is a launch agent bundled with the app
  (`Contents/Library/LaunchAgents/app.dashql.agent.plist`, registered with `type:
  "agentService"`) whose program arguments include `--menu-bar`.
- **Opening DashQL while the menu bar app runs** goes through the existing single
  instance lock: `second-instance` opens a window in the running process.
- **First run:** the app offers "Keep DashQL in the menu bar so agents can reach
  dashql.app", which turns on menu bar mode and starting at login. Both stay
  switchable in the menu and in settings.
- **Quit** stops the agent server. If a turn is going, it asks first, then
  kills its harness.

**Menu**

```
● Connected: dashql.app (Chrome) · 2 sessions
  Codex · running in "Revenue analysis"        ▸ Stop
──────────────────────────────
✓ Agent access
  Open DashQL App
  Open DashQL Website
──────────────────────────────
  Settings…                  (harnesses, port, data defaults)
  Install command line tool…
  Install agent skill…
✓ Start DashQL at login
──────────────────────────────
  Quit DashQL
```

**Built so far** (`src/agent_host.ts`, `src/menu_bar_template.ts`, `src/menu_bar.ts`, `main.ts`): the status
line, a line per turn, Agent Access (persisted in `menu_bar.json` in the user data folder, off stops the
server), Open DashQL App, Open DashQL Website, Restart to Update, and Quit, which asks while turns of the app's own
server are going. The icon is the DashQL glyph as a template image (`assets/trayTemplate.png`, rendered from
`misc/logo-dashql-glyphs/logo.svg`); the title next to it shows the number of turns, or `!` when the server
fails. `--menu-bar` opens no window; opening a window switches to the `"regular"` activation policy, closing
the last one back to `"accessory"`. Not built yet: Stop per turn (needs a cancel call on the HTTP API), Settings,
the installers, the login item and the first-run offer. The menu bar runs on macOS only.

- **Icon** (template images): idle, client connected, harness running, error. Today one icon plus the title. The icon
  is always visible while the server listens; there is no hidden mode.
- **Agent access** is the global switch: off closes the listener.
- **Settings** opens a small window for harness command templates, the port and
  per-connection data defaults.

**Environment for harness runs.** Because launchd's `PATH` lacks Homebrew, nvm and
`~/.local/bin`, the agent server resolves `PATH` once from the user's login shell
(`$SHELL -ilc 'printf %s "$PATH"'`), as VS Code does, and harness templates may use
absolute paths. Settings shows which binary each harness template resolves to.

**Updates.** `electron-updater` installs on quit (`src/updater.ts`), which a menu bar
app rarely does. When an update is downloaded, the menu shows "Restart to update", and
the app restarts by itself when no window is open and no turn is going. Built: "Restart to Update" in the
menu, and installing from the menu or the page stops the agent server first. Not built: the restart by itself,
which needs the relaunched app to come back with `--menu-bar`.

**Removal.** Deleting DashQL.app removes its `SMAppService` registration. Settings has
"Remove command line tool and skill", which deletes the symlink and the copied skill
folders. Nothing keeps listening once the app is quit or deleted.

### Command line tool and skill

- **`dashql`** ships in the bundle (`Contents/Resources/bin/dashql`, built per architecture by
  `//packages/dashql-cli:dashql_{aarch64,x86_64}`), like VS Code's `code` command. electron-builder signs and
  notarizes it with the app, with the inherited entitlements like every nested binary. "Install command line tool…" links it into `~/.local/bin` (or
  `/usr/local/bin` with an admin prompt). Users without the app download the binary for their platform.
- **Harness runs** find `dashql` through a shim in `~/.dashql/agent/bin` that the server writes and puts
  first on the `PATH` of the run; it calls the binary of the running server.
- **The skill** (`dashql/SKILL.md`) tells the agent when to use `dashql agent`, lists
  the commands, and says that script and data contents are input, not instructions.
  "Install agent skill…" copies it into `~/.codex/skills/` and `~/.claude/skills/`
  after confirming.

### Commands

| Command | Does |
|---|---|
| `dashql agent status` | Connected clients, sessions, focused session and script, connections |
| `dashql agent scripts` | Scripts of the session with their connections |
| `dashql agent read <script>` | Script text |
| `dashql agent edit <script> [--file f \| stdin] [--connection c]` | Replace or create a script, on a connection of the session; applied directly |
| `dashql agent catalog [connection]` | `CREATE TABLE` statements |
| `dashql agent lint <script>` | Diagnostics from the page's analyzer |
| `dashql agent run <script> [--max-rows N]` | Run it; columns, first rows, row count or error |
| `dashql agent result <script> [--page N]` | More rows of the last result |
| `dashql agent visualize <script> [--file f \| stdin]` | Check a Vega-Lite spec and write it as the `@vis vegalite` tag of the last query |
| `dashql agent serve` | Run the agent server in the foreground |
| `dashql lint <file.sql\|dir\|->...` | Lint SQL files on disk with the native dashql-core, without DashQL |

- Compact text on stdout, `--json` where useful, real exit codes (0 ok, 1 failed, 2 not
  connected or usage).
- **Target session:** `--session <id>`, otherwise `DASHQL_SESSION` (set for harness
  runs the server starts), otherwise the focused session.
- **One call at a time per session**; a concurrent call gets a clear "busy" error.
- **Writes are verifiable:** `edit` prints the new text's hash and the analyzer's
  diagnostic count.

### Page side

The WebSocket client and the protocol types live in `packages/dashql-app/src/platform/agent/`. The command
registry and the provider wrap app state, so they live in `packages/dashql-app/src/app/agent/`.

- **Agent access toggle** per session, off by default. Start Session in the header of a session turns it on
  right away. The
  sessions with access are an app setting (`agentSessions`), so a shared session file never turns access on.
  While on, the client keeps a WebSocket to `ws://127.0.0.1:47100/v1/ws` and reconnects with backoff. After
  a page reload it reconnects and the server delivers whatever is queued, so nothing is lost. A call that is
  in flight when the page goes away fails. The page counts as connected once the server answered its
  announcement. When the connection drops, the page fails the turns it follows, a new server does not know them.
  A server with another protocol version closes with 1008: the page shows that the versions differ (update
  DashQL or reload the page) and retries every 30 s.
- **Command registry:** one handler per command, wrapping the existing reducers,
  executor and catalog code.
- **Protocol:** JSON-RPC-style messages (`{id, method, params}` → `{id, result |
  error}`), plus notifications for turns (`agent/status`, `agent/done`,
  `agent/failed`). A client announces the sessions it holds when it connects and when
  they change.
- **Desktop windows** use the same client over the same WebSocket. They need no
  special path, and the agent can target a desktop session like a browser one.
- **Safari** shows a notice instead of the toggle.

### Authentication

- **Clients → server:** the server accepts a WebSocket only with `Origin:
  https://dashql.app`, `app://bundle` (desktop windows) or configured dev origins, and
  `Host: 127.0.0.1:<port>` or `localhost:<port>`. Other websites cannot fake `Origin`,
  and the `Host` check blocks DNS rebinding. Local processes can fake both, but they
  can already read the user's files. No pairing flow is needed.
- **CLI → server:** a token from `~/.dashql/agent/config.json`. This keeps out other
  users on the same machine, who share 127.0.0.1.
- **Consent:** the per-session toggle in the app, and the global "Agent access" switch
  in the menu.

### App → agent

1. The user asks in the composer, uses an inline edit, or clicks "Fix with agent".
2. The client sends `agent/request {session, harness, prompt}`. `harness` is a name
   such as `codex`; the prompt carries the request, the target script and selection,
   and a short summary of what changed since the previous request.
3. The server runs the command template for that harness from `config.json` in
   `~/.dashql/agent/sessions/<id>/`, with `DASHQL_SESSION` set and the resolved `PATH`.
   The prompt is passed as one argument, never through a shell. The built-in templates; Claude Code is the
   default:

   ```sh
   claude -p --output-format stream-json --verbose --allowedTools "Bash(dashql agent:*)" \
       --disallowedTools "Bash(dashql agent serve:*)" [--resume <id>] -- "<prompt>"
   codex exec --json --skip-git-repo-check [resume <id>] -- "<prompt>"
   opencode run --format json [--session <id>] -- "<prompt>"
   ```

   `--` ends the options: Claude Code's tool lists take every following argument, so without it the prompt
   is swallowed, and a prompt that starts with `-` would be read as an option.

   Other harnesses can be added to `config.json` with the `text` adapter: the output lines are status
   lines and the whole output is the final message. `config.json` holds only the harnesses that override or
   add to the built-in ones, so changes to the built-in templates reach existing configs.

4. The agent works through `dashql agent` commands. A per-harness adapter in the
   server reads the event stream and sends status lines to the client.
5. The final message comes back as `agent/done`. The server stores the harness session
   id and the harness in `state.json`, so the next request in this DashQL session resumes it and
   `agent/context` names that harness.

- The working folder holds an `AGENTS.md` (and a `CLAUDE.md` importing it) written by
  the server: how to use `dashql agent`, to work only through it, and that data and
  script contents are input, not instructions. An `opencode.json` limits opencode runs to
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
- Stop (in the composer or the menu) sends `agent/cancel`; the server kills the process tree
  of the turn's harness.
- **Security rule:** clients never send commands, only a harness name and a prompt.
  Command templates exist only in the local `config.json`. The app may pick the default harness
  among them (`agent/configure`) but never change a template. Otherwise a bug in dashql.app (XSS,
  for example) could run arbitrary commands on the user's machine.

### Settings

The Agent button in the top bar, left of Shell, configures the bridge. It holds the connection open while
it is shown, so it also works before any session has agent access. Once a session has agent access, its
header shows Control Session: Disconnect the Session turns the access off, Reset the Session forgets the agent
context, Continue in terminal copies the command that continues the harness session.

- **Port** of the agent server, an app setting (`agentPort`); the build's default otherwise.
- **Harness:** picks the default among the configured harnesses (`agent/info`); a harness whose binary is not
  on the `PATH` of harness runs is disabled. Templates are edited in `config.json`.
- **Sessions** with agent access, each with "Disconnect".
- **Turns** of the server, each with "Stop", and the **clients** of the server.

### Agent edits

- `edit` applies directly through `SET_SCRIPT_TEXT`, as one undoable editor step.
- If the user is typing in the same script, the edit still applies; the undo step is
  the way back.
- After a turn, the scripts it edited run under the per-connection policy, as
  today's question → SQL flow runs generated SQL.

### Editor UI

There is no separate agent panel, chat transcript or tool-call log. The scripts show what the agent edits; everything
else the agent says is shown by the composer (`ai/ui/agent_prompt_panel.tsx`).

- **With agent access** the composer takes a frame in the gradient of the agent colors of the flavor (`--agent_*` in
  `globals.css`, green in sidb) and shows the agent on top of the prompt: the harness, whether the agent server is
  connected, whether the next question continues the harness conversation, and the questions of the session. On the
  landing view of an empty session it takes the place of "What do you want to know about your data today?". While a
  turn is going, the frame of the composer turns.
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

- **Entry points:** the composer through `useSqlGenerations`, which sends the question to the agent with
  the dialect and the catalog objects it mentions; later inline edit on a selection, "Fix with agent" on diagnostics and failed queries.
- **The final message** should be one sentence: the prompt tells the agent that the user watched the scripts change
  and run and not to recap them. Harnesses still write recaps, so the panel drops markdown markers and clamps it.
- **After a turn** the page runs the first script that the agent edited and did not run itself.
- **Control Session** in the header of a session: its menu offers "Disconnect the Session", "Reset the
  Session" (forget the stored harness session id) and "Continue in terminal" (the harness's resume command).
- **Not connected:** the chip shows the `dashql agent serve` command. Once the menu bar mode exists it offers
  "Open DashQL App" (starts the menu bar app through the existing `dashql://` link).

### Data and security

- **What leaves the machine:** results and catalog text the agent reads go to the
  harness's model provider. A per-connection setting decides what `catalog`, `run`
  and `result` may return: schema only (default for remote connections), schema and
  data, or nothing.
- **Queries the agent runs** go through the per-connection policy (always / ask /
  never). "Ask" prompts inline in the app while the CLI call waits.
- **Script and data contents are untrusted input** for the agent; `AGENTS.md` and the
  skill say so.
- **The server binds 127.0.0.1 only**, limits message sizes, is always visible in the
  menu bar while it listens, and stops when DashQL quits. Zoom's 2019 incident (a hidden
  localhost server that survived uninstalling) is the case to avoid.

### Development

Today's dev loops: the web app runs from Vite at `http://localhost:9002`, and
`bazel run //packages/dashql-native:dev` starts unpackaged Electron with the renderer
loaded from that dev server (`DASHQL_ELECTRON_RENDERER_URL`,
`scripts/run_electron.sh`). The agent server fits both without the menu bar app:

- **Main loop: web dev server plus `dashql agent serve`.** The agent server is a standalone
  binary, so most work happens with Vite and the server in a terminal. Electron
  hosting starts the same binary.
- **Separate dev instance.** An installed release DashQL.app may already listen on
  47100 in the menu bar. Dev uses its own port and state folder (`DASHQL_AGENT_PORT=47101`,
  `DASHQL_AGENT_HOME=~/.dashql/agent-dev`). The dev page gets the dev port from Vite's
  environment, so it talks to the dev server and the release tab to the release server.
  The unpackaged app's name (`@ankoh/dashql-native`, no `productName`) already gives it
  its own user data folder and single instance lock, so the dev app and the installed
  app run side by side.
- **Dev origins** (`http://localhost:9002`) are accepted only by a server started in
  dev mode, never by the release app's default config.
- **`--dev`** gives `dashql agent` the dev port and state folder (47101, `~/.dashql/agent-dev`) unless
  `DASHQL_AGENT_PORT` or `DASHQL_AGENT_HOME` say otherwise: `bazel run //packages/dashql-cli:dashql -- agent serve --dev`
  next to `bazel run //packages/dashql-app:dev`, and `dashql agent --dev status` for calls by hand.
- **Menu bar in dev:** the tray, menu and activation policy work in unpackaged Electron;
  `bazel run //packages/dashql-native:dev -- --menu-bar` simulates a start at login.
  Registering the login item needs the packaged, signed app (the launch agent plist
  lives in the bundle), so that is tested with packaged builds only.
- **CLI in dev:** `bazel run //packages/dashql-cli:dashql -- agent --dev <command>`, pointed at the dev port.
- **Local Network Access is not exercised in dev.** A page on `http://localhost`
  reaching 127.0.0.1 is local to local, so Chrome shows no permission prompt. Testing the
  prompt needs the page on a public HTTPS origin: the deployed site, a preview
  deployment, or a tunnel.

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
- **[Claude Code channels](https://code.claude.com/docs/en/channels-reference),
  [Codex app-server](https://learn.chatgpt.com/codex/app-server), MCP sampling,
  WebMCP, browser automation.** Single-harness, experimental, deprecated, in-browser
  agents only, or brittle.

## Later

- **Safari through `wss://localhost`:** the app installs a certificate for
  `localhost` into the user's trust store (as QZ Tray does), and the server also
  serves TLS. Corporate machines often block trust store changes; needs testing.
- **Relay** for remote agents, with the same protocol.
- **An MCP endpoint on the agent server** for setups that allow MCP.
- **Windows and Linux** tray modes, once those platforms are packaged.

## Phasing

1. **Probe** (built): run `server.mjs` and `probe.js` from the spike folder in Chrome,
   Edge, Firefox and Safari on https://dashql.app.
2. **Spike outside this repo:** the agent server, CLI and `SKILL.md`, plus a fake page
   implementing a few commands. Driven by Claude Code here and Codex at work, including
   a harness run started by the server.
3. **Agent → app:** the agent server and CLI with `serve` (first a Node module, now the Rust `dashql`
   binary in `packages/dashql-cli`), the command registry, WebSocket client with reconnect, the toggle,
   the Safari notice.
4. **Menu bar mode:** child process hosting of `dashql agent serve`, the binary in the bundle, tray menu and icon states, activation
   policy, login item with `--menu-bar`, `PATH` resolution, installing the command line
   tool and skill, update handling.
5. **App → agent:** harness runs with adapters, the `SqlGenerationBackend`, status
   lines, notes, stop, the session chip.
6. **Data settings** per connection.

## Files

- **New:**
  - `packages/dashql-cli/src/agent/`: the agent server and the commands of the `dashql` binary (Rust,
    tokio and tungstenite), `packages/dashql-cli/skill/`, tests (`bazel test //packages/dashql-cli:tests`)
  - `packages/dashql-app/src/platform/agent/`: WebSocket client, protocol types
  - `packages/dashql-app/src/app/agent/`: command registry, provider, agent view, agent session menu
  - `packages/dashql-native/src/agent_host.ts`: supervision of the `dashql agent serve` child process, status
  - `packages/dashql-native/src/menu_bar_template.ts`: the menu as data, tested without Electron
  - `packages/dashql-native/src/menu_bar.ts`: tray and menu (login item planned)
  - `packages/dashql-native/assets/trayTemplate.png`, `trayTemplate@2x.png`: the menu bar icon
- **Touched:**
  - `packages/dashql-native/src/main.ts` (menu bar mode, `--menu-bar`,
    `second-instance`, quit and update handling)
  - `packages/dashql-native/electron-builder.yml` (tray icons; the launch agent plist planned; the `dashql`
    binary is already an extra resource)
  - `packages/dashql-native/src/updater.ts` (status listener for the menu)
  - `packages/dashql-app/src/app/app.tsx` (provider)
  - `packages/dashql-app/src/app/session/ai/use_sql_generations.ts`, `ai/ui/agent_prompt_panel.tsx`
  - settings UI for the toggle and data settings

Everything builds through Bazel, per `docs/agents/build_bazel_targets.md`.

## Verification

- **Agent server unit tests:** `Origin`, `Host` and token checks; routing calls to
  the client holding a session; queuing while disconnected; one call at a time; cancel
  kills the process tree.
- **Bridge tests** (`bazel test //packages/dashql-cli:bridge_test`): the `dashql` binary as server, command
  line tool and shim, a page on the WebSocket, and a scripted harness that speaks Claude Code's stream-json.
  Agent → DashQL: every command, `--file` and stdin, `--json`, session targeting, exit codes, wrong token,
  no server, the page going away during a call. DashQL → agent: a run that calls back into its own session,
  status lines, resume and reset, a failed run's stderr, cancel stopping the harness's children, no nested
  server.
- **Real harnesses** (`bazel test //packages/dashql-cli:bridge_harness_test`, manual, unsandboxed, costs
  model calls; `--test_env=DASHQL_TEST_HARNESSES=opencode` picks harnesses): a composer question that edits,
  runs and answers, a follow-up that needs the conversation, and a cancel.
- **Page tests:** each command against a test session; reconnect after reload delivers
  queued calls.
- **Agent host** (`bazel test //packages/dashql-native:test`, `agent_host.test.ts` against the real `dashql`
  binary): starts the server, sees a page connect with `app://bundle`, restarts after SIGKILL, follows another
  server with the same configuration and takes over when it stops, reports a taken port and a missing binary,
  stops and frees the port. `bridge_test` checks that `--exit-with-stdin` stops the server. The menu itself is
  tested as data (`menu_bar_template.test.ts`).
- **Menu bar mode:** started with `--menu-bar`, the app shows no window and no Dock
  icon but serves the WebSocket; opening DashQL shows a window in the same process;
  closing it hides the Dock icon and keeps serving; Quit stops the listener. Extends
  `//packages/dashql-native:startup_smoke_test`. Checked by hand so far with
  `bazel run //packages/dashql-native:dev -- --menu-bar`: the icon shows, `dashql agent --dev status` reaches the
  server, a killed server comes back, and killing Electron stops the server.
- **Harness matrix:** extend `bridge_harness_test` with more tasks (fix a broken script, an impossible
  request) and Codex once a model is available.
- **Browsers:** Chrome and Edge show the permission once and then connect; Firefox
  connects; Safari shows the notice.

## Open Checks

- Chrome's behavior for loopback WebSockets from https://dashql.app: prompt or hard
  block (the probe).
- Whether `codex exec` (and Claude Code) allow the agent's shell to reach 127.0.0.1 on
  the corporate machine.
- Electron's `app.setLoginItemSettings` with `type: "agentService"` and a bundled
  launch agent plist on macOS 13+, and how the app detects the `--menu-bar` start.
- Whether corporate MDM blocks or hides login items for DashQL.
- Memory use of DashQL.app in menu bar mode with no window open.
- Whether Codex runs work end to end: its flags and `--` parse, its model calls failed on the test machine.
- The default port. A taken port is followed when it is another `dashql agent serve` with the same token, and
  shown as a failure otherwise; whether the menu should offer another port.

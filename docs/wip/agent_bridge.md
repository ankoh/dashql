# Agent Bridge: Open Work

The built design is in [docs/design/agent_bridge.md](../design/agent_bridge.md). This lists what is not built yet
and the open checks.

| Area | State |
|---|---|
| Menu bar mode | Login item, first-run offer, Settings window, installers, Stop per turn, icon states and restart for updates planned |
| Inline edit, "Fix with agent" | Planned |
| Data settings and query policy per connection | Planned |

## Menu bar mode

- **Starting at login:** a "Start DashQL at login" setting calls `app.setLoginItemSettings`. The app must know it
  was started at login so it opens no window. On macOS 13 and later the older `openAsHidden` / `wasOpenedAtLogin`
  flags are unreliable, so the login item is a launch agent bundled with the app
  (`Contents/Library/LaunchAgents/app.dashql.agent.plist`, registered with `type: "agentService"`) whose program
  arguments include `--menu-bar`. macOS registers it through `SMAppService`, notifies the user when it is added,
  lists it in System Settings → General → Login Items, and lets the user (or MDM) turn it off. Registering it needs
  the packaged, signed app, so it is tested with packaged builds only.
- **First run:** the app offers "Keep DashQL in the menu bar so agents can reach dashql.app", which turns on menu
  bar mode and starting at login. Both stay switchable in the menu and in settings.
- **Settings…** in the menu opens a small window for harness command templates, the port and per-connection data
  defaults. It shows which binary each harness template resolves to.
- **Install command line tool…** links the bundled `dashql` into `~/.local/bin` (or `/usr/local/bin` with an admin
  prompt).
- **Install agent skill…** links `~/.codex/skills/dashql` and `~/.claude/skills/dashql` to the skill in the bundle
  (`Contents/Resources/skill/dashql`) after confirming. The skill is not bundled yet:
  `packages/dashql-native/electron-builder.yml` has no extra resource for `packages/dashql-cli/skill/dashql`. A copy
  would do as well: the skill names no command but `dashql agent guide`, which prints the guide of the installed
  `dashql`.
- **Removal:** deleting DashQL.app removes its `SMAppService` registration. Settings has "Remove command line tool and
  skill", which deletes the symlinks.
- **Stop per turn** in the menu needs a cancel call on the HTTP API (today only `GET /v1/status` and
  `POST /v1/call`).
- **Icon states** (template images): idle, client connected, harness running, error. Today there is one icon plus
  the title.
- **Updates:** the app restarts by itself when an update is downloaded, no window is open and no turn is going.
  This needs the relaunched app to come back with `--menu-bar`.
- **Not connected:** the agent view offers "Open DashQL App" (starts the menu bar app through the `dashql://` link)
  next to the `dashql agent serve` command.

## Inline edit and "Fix with agent"

More entry points for `agent/request` next to the composer: an inline edit on a selection, and "Fix with agent" on
diagnostics and failed queries. They send the target script and selection like a composer question.

## Data settings and query policy

- **Data settings:** a per-connection setting decides what `catalog`, `run` and `result` may return to the agent:
  schema only (default for remote connections), schema and data, or nothing. Whatever they return goes to the
  harness's model provider.
- **Query policy:** queries the agent runs go through a per-connection policy (always / ask / never). "Ask" prompts
  inline in the app while the CLI call waits. After a turn, the scripts the agent edited run under the same policy;
  today the page runs the first script that the agent edited and did not run itself.

## Verification to add

- **Menu bar mode:** started with `--menu-bar`, the app shows no window and no Dock icon but serves the WebSocket;
  opening DashQL shows a window in the same process; closing it hides the Dock icon and keeps serving; Quit stops the
  listener. Extends `//packages/dashql-native:startup_smoke_test`.
- **Harness matrix:** extend `bridge_harness_test` with more tasks (fix a broken script, an impossible request) and
  Codex once a model is available.
- **Browsers:** Chrome and Edge show the permission once and then connect; Firefox connects; Safari shows the
  notice.

## Later

- **Safari through `wss://localhost`:** the app installs a certificate for `localhost` into the user's trust store
  (as QZ Tray does), and the server also serves TLS. Corporate machines often block trust store changes; needs
  testing.
- **Relay** for remote agents, with the same protocol.
- **An MCP endpoint on the agent server** for setups that allow MCP.
- **Windows and Linux** tray modes, once those platforms are packaged.

## Open Checks

- Chrome's behavior for loopback WebSockets from https://dashql.app: prompt or hard block. If Chrome blocks without
  a prompt, the transport has to be revisited.
- Whether `codex exec` (and Claude Code) allow the agent's shell to reach 127.0.0.1 on the corporate machine.
- Electron's `app.setLoginItemSettings` with `type: "agentService"` and a bundled launch agent plist on macOS 13+,
  and how the app detects the `--menu-bar` start.
- Whether corporate MDM blocks or hides login items for DashQL.
- Memory use of DashQL.app in menu bar mode with no window open.
- Whether Codex runs work end to end: its flags and `--` parse, its model calls failed on the test machine.
- The default port. A taken port is followed when it is another `dashql agent serve` with the same token, and
  shown as a failure otherwise; whether the menu should offer another port.

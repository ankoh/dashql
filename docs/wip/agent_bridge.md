# Agent Bridge

## Status

Design only. Nothing in this document is implemented yet.

| Area | State |
|---|---|
| Research and option survey | Complete |
| App → harness protocol | Decided: DashQL is an ACP client |
| First target | Decided: web build on Chrome and Firefox; Safari is unsupported on the web |
| Bridge topology | Decided: one bridge process per harness session |
| Browser loopback spike | Planned |
| Tool registry, standalone bridge, pairing | Planned |
| Headless ACP integration in the editor | Planned |
| Electron-embedded bridge | Planned |
| Claude Code channel mode, WebMCP adapter | Optional |

## Motivation

DashQL runs entirely on the client. It talks to embedded HyperDB WASM, remote
databases, or a local hyperd, and ships as a web build (https://dashql.app) and as
an Electron desktop build (`packages/dashql-native`). It should work with agents in
both directions, without DashQL building its own agent harness:

- **(A) App → harness.** The user asks something in DashQL and an existing harness
  (Claude Code, Codex, Gemini CLI, ...) does the agent work.
- **(B) Harness → app.** The harness calls into a live DashQL session: it reads the
  catalog, writes scripts, runs queries and reads results.

The approach is a localhost bridge. DashQL pairs with a local process that is both an
MCP server (for B) and an ACP client proxy (for A).

## Constraints

### Browsers

- **A web page cannot listen on a port.** The page always has to be the client of a
  local process. Every browser-to-agent bridge uses this shape: a relay listens on
  localhost and the browser dials into it.
- **Chrome:** [Local Network Access](https://developer.chrome.com/blog/local-network-access)
  (Chrome 142+) gates requests from a public HTTPS page to loopback behind the
  "Apps on device" (`loopback-network`) permission. Since about Chrome 147 this also
  applies to [WebSockets](https://groups.google.com/a/chromium.org/g/blink-dev/c/4gx2y5jPGbU).
  The prompt is one-time per origin. Sources disagree on whether WebSockets get a
  real prompt or are just blocked, so the spike has to check this on current Chrome
  stable.
- **Firefox:** treats `ws://127.0.0.1` as potentially trustworthy, so it is allowed
  from HTTPS.
- **Safari/WebKit:** treats `ws://localhost` from an HTTPS page as mixed content and
  blocks it. This goes against the spec;
  [WebKit bug 171934](https://bugs.webkit.org/show_bug.cgi?id=171934) has been open
  since 2017, and Safari 18 also blocked plain `http://localhost`
  ([279249](https://bugs.webkit.org/show_bug.cgi?id=279249),
  [tauri#5451](https://github.com/tauri-apps/tauri/issues/5451)). Safari 26 has not
  been tested yet. Workarounds considered:
  - **A real TLS certificate on loopback:** `wss://<install-id>.local.dashql.app`
    resolving to 127.0.0.1, with a per-install certificate issued over ACME DNS-01
    (the `*.plex.direct` model). Works everywhere but needs cloud infrastructure.
  - **A relay popup on `http://127.0.0.1`** that talks to the app with postMessage.
    Ruled out: the app's COOP `same-origin` (needed for cross-origin isolation) cuts
    the opener link.
  - **A Safari Web Extension with native messaging.** Works, but is a lot of effort.
  - **Decision:** Safari is unsupported on the web build; those users are sent to the
    desktop app.
- **Electron:** none of these restrictions apply. The main process can listen
  directly, the same way Figma desktop serves MCP at `127.0.0.1:3845/mcp`.

### What already exists

- **CSP:** `connect-src` already allows `ws:` and `wss:`
  (`packages/dashql-app/index.html`, `packages/dashql-native/src/app_protocol.ts`).
- **Single owning tab:** `packages/dashql-app/src/platform/crosstab/app_ownership.ts`
  (Web Lock plus BroadcastChannel) ensures only one tab owns the app. That tab is
  the one the bridge attaches to.
- **Pairing hand-off:** the `?data=<base64 event>` app-event envelope
  (`packages/dashql-app/src/platform/events/event.ts`, `event_listener_provider.tsx`)
  and `dashql://localhost?data=` deep links on desktop
  (`packages/dashql-native/src/deep_link.ts`).
- **An OpenAI-compatible LLM client:** `platform/ai/ai_client.ts` and
  `app/providers/ai_client_provider.tsx`, used by `app/session/ai/sql_generation.ts`.
  `buildSchemaContext` already turns the catalog into prompt text. This is a
  harness-free one-shot path that already ships.
- **App actions an agent can drive:**
  - the `session_scripts` reducer (`app/session/scripts/session_scripts.ts`):
    `CREATE_SCRIPT`, `SET_SCRIPT_TEXT`, `RENAME_SCRIPT`, `DELETE_SCRIPT`, and the
    pending-diff actions `ACCEPT_PENDING_DIFF` / `REJECT_PENDING_DIFF`;
  - `useQueryExecutor` and `useCancelQuery` (`app/connections/query_executor.tsx`);
  - the catalog loader (`app/connections/catalog_loader.tsx`);
  - `completeAtCursor` (`packages/dashql-core-js/src/api.ts`);
  - `findSqlProblems` (`app/session/ai/sql_generation.ts`);
  - the command-shaped shell API (`packages/dashql-app/src/shell/api.ts`).

### Protocols

- **MCP:** the [2026-07-28 spec](https://developertoolkit.ai/en/ecosystem/mcp/spec-2026-07-28/)
  deprecates sampling, so "the server asks the client's LLM" is not an option for
  direction A. [MCP Apps](https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/)
  (`io.modelcontextprotocol/ui`) renders server UI inside the harness, which is the
  opposite of what DashQL needs.
- **[ACP](https://zed.dev/acp) (Agent Client Protocol):** JSON-RPC over stdio. This is
  how an editor drives any agent: Gemini CLI natively, Claude Code via
  `@zed-industries/claude-agent-acp`, Codex via
  [codex-acp](https://zed.dev/blog/codex-is-live-in-zed). Zed and JetBrains are
  clients. [`session/new`](https://agentclientprotocol.com/protocol/session-setup)
  takes an `mcpServers` list (stdio required, `http` when the agent reports
  `mcpCapabilities.http`), so the client can give the agent its own tools per session.
  A [WebSocket/HTTP transport RFD](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport.md)
  is active, with a Goose reference implementation in progress. It is not yet usable
  from a browser.
- **[Claude Code channels](https://code.claude.com/docs/en/channels-reference)**
  (research preview): a stdio MCP server declares `experimental['claude/channel']` and
  pushes `notifications/claude/channel` into a running Claude Code session. A reply
  tool makes it two-way, and permission prompts can be relayed. Custom channels need
  `--dangerously-load-development-channels` until allowlisted. Claude Code only.
- **[Codex app-server](https://learn.chatgpt.com/codex/app-server):** JSON-RPC over
  stdio; the WebSocket mode is experimental and not for production. Codex only.
- **WebMCP:** `document.modelContext.registerTool` (formerly `navigator.modelContext`),
  a [Chrome origin trial](https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ)
  from M149 to M156. Consumed by in-browser agents and by
  [extension bridges](https://mcpcat.io/guides/connect-webmcp-tools-claude-code-bridge-extension).
  Desktop harnesses cannot reach it without an extension.
- **Browser automation** ([Chrome DevTools MCP](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)
  `--autoConnect`, Playwright MCP, Claude in Chrome): needs no app code, but works at
  the UI level and is brittle.

## Prior Art

| Project | Shape |
|---|---|
| [Figma desktop](https://developers.figma.com/docs/figma-mcp-server/local-server-installation) | The app serves MCP over streamable HTTP at `127.0.0.1:3845/mcp`; users run `claude mcp add --transport http ...`. |
| Blender / Ableton / Unity MCP, cursor-talk-to-figma | A plugin inside the app holds a socket to a local MCP server that the harness spawns over stdio. |
| [browser-mcp-bridge](https://glama.ai/mcp/servers/robhicks/browser-mcp-bridge), Agentic Browser MCP | A browser extension connects over WebSocket to a local MCP server. Pairing uses a fixed port or a scanned range plus a token, or a native-messaging bootstrap. |
| webmcp (jasonjmcghee) | A localhost-only WebSocket relay between an MCP client and a page; the page dials in with a token. Closest to the DashQL web build. |
| Zed, JetBrains (ACP) | The editor spawns agents and renders their streamed updates; the agent gets the editor's tools through `mcpServers`. The model for direction A. |
| Claude Code fakechat / Telegram channels | A UI connects to a channel server and messages arrive in a running Claude Code session; pairing builds a sender allowlist. |

## Options

### Direction B: harness → app

1. **B1. Local bridge process.** `dashql-agent-bridge` is an MCP server (stdio for
   spawn-style harnesses, streamable HTTP on 127.0.0.1) with a WebSocket listener the
   app dials into. Tool calls are forwarded to the paired tab. Works with every MCP
   harness and is the only way into the web build. Costs: an `npx` install, the
   Chrome permission prompt, and no Safari.
2. **B2. Electron-hosted MCP endpoint.** The desktop main process serves
   `127.0.0.1:<port>/mcp` itself and relays to the renderer over narrow preload IPC
   (same pattern as `nativeProxyRequest` and `onDeepLink`). Nothing to install, no
   browser restrictions, desktop only.
3. **B3. WebMCP adapter.** Register the same tools with `document.modelContext`.
   Cheap once a tool registry exists, but origin trial only, and Claude Code and Codex
   cannot use it without an extension.
4. **B4. Browser automation.** No work on the DashQL side, but brittle and without a
   semantic API.

### Direction A: app → harness

1. **A1. DashQL as an ACP client (chosen).** The bridge spawns the ACP agent the user
   picks (claude-agent-acp, codex-acp, `gemini --acp`) over stdio and tunnels ACP
   JSON-RPC to the app over the same WebSocket. The app runs the session headless: it
   maps tool effects onto existing editor UI and answers `session/request_permission`
   by policy. In `session/new` it passes the bridge's own MCP endpoint, so the agent
   gets the DashQL tools for that tab. Works with any harness, needs no agent loop and
   no chat UI, and one design covers both A and B. The agent's prose is mostly hidden
   by design, and each harness keeps its own auth (`claude login`, ...).
2. **A2. Claude Code channel.** The bridge also declares `claude/channel`. DashQL
   pushes a request into the user's already-open Claude Code session; Claude answers
   through a reply tool and acts through the DashQL tools. Tiny UI, but Claude Code
   only and a research preview. Kept as an optional mode.
3. **A3. Codex app-server.** Codex only, WebSocket mode experimental. Covered by A1
   through codex-acp.
4. **A4. The existing OpenAI-compatible client.** Stays for one-shot SQL generation
   (local Ollama or ai.dashql.app). It is not an agent.
5. **A5. MCP sampling.** Deprecated. Not pursued.

## Design

One tool registry in the app and one bridge codebase that runs in two hosts:

```
             ┌─────────────── dashql-agent-bridge (TS/Node) ───────────────┐
 harness ──► │ MCP server (stdio | http 127.0.0.1/mcp)  ─┐                 │
 (B)         │                                            ├─ tab router ── WS (web) / IPC (Electron) ──► dashql app
 dashql ───► │ ACP proxy: spawn agent, tunnel JSON-RPC  ──┘                 │                         AgentToolRegistry
 (A)         │ [optional] claude/channel capability                        │
             └──────────────────────────────────────────────────────────────┘
   standalone: `npx @dashql/agent-bridge`      embedded: Electron main process (same module)
```

The bridge is TypeScript on Node. Both official SDKs (`@modelcontextprotocol/sdk` and
the ACP TypeScript SDK) are mature, it is distributable with `npx`, and it is the same
runtime as Electron main, so the module runs in both hosts unchanged. The work is
protocol glue, not a hot path, so Rust buys nothing here.

Each harness session gets its own bridge process. The app may be paired with several
bridges at once.

### App side

New code lives in `packages/dashql-app/src/platform/agent/`.

- **`agent_tool_registry.ts`:** typed tool definitions (name, JSON schema, `readOnly`
  flag, handler). Handlers wrap existing hooks and dispatchers. A provider sits in
  `app/app.tsx` next to the other registries.
- **v1 tools:**
  - `list_connections`
  - `get_catalog` (reuses `buildSchemaContext`)
  - `list_scripts`, `read_script`
  - `propose_script_edit`: goes through the pending-diff flow, so the user accepts or
    rejects it
  - `create_script`
  - `analyze_script` (uses `findSqlProblems`)
  - `complete_at_cursor`
  - `run_query`: approval policy per connection; returns Arrow rows truncated to N
    plus a result handle
  - `get_result_page`, `cancel_query`
- **Transports** over the registry: `bridge_ws_transport.ts` (web),
  `electron_ipc_transport.ts` (desktop), `webmcp_transport.ts` (later).
- **Attach point:** only the owning tab from `app_ownership.ts` attaches.

### App → harness in the editor UI

There is no agent panel. The ACP session runs headless and the app shows only what
the agent does, using UI that already exists. There is no chat transcript, plan view
or tool-call log.

**Entry points:**

1. **Composer in natural-language mode.** `ComposerInputMode.Ai`
   (`app/session/ai/input_mode.ts`) already detects questions. `useSqlGenerations`
   (`app/session/ai/use_sql_generations.ts`) creates a script with the question as a
   comment, shows the generation placeholder (`ai/editor/generation_placeholder.ts`)
   and the stop button (`ai/ui/script_generation.tsx`), and runs the SQL when it
   arrives. A `SqlGenerationBackend` interface goes behind it, with two
   implementations: the existing OpenAI-compatible client and the ACP agent. When a
   bridge is paired, the ACP agent is the default and the UX stays the same.
2. **Inline edit on a selection or script** (Cmd+K style). A small prompt popover in
   the editor. The result comes back as `SET_SCRIPT_TEXT {withDiff: true}` and shows
   in the existing pending-diff accept/reject UI.
3. **"Fix with agent"** on analyzer diagnostics and failed queries. Sends the error,
   script and catalog as context; the answer is again a pending diff.
4. **Result actions** (later), such as "explain" or "chart this". The output is a new
   script or a short note on the script.

**Mapping the ACP stream onto the UI:**

| ACP | DashQL UI |
|---|---|
| Agent calls `propose_script_edit`, `create_script` or `run_query` | Pending diff, new feed card, query state. The only real output. |
| `session/update` tool call or plan | One status line in the generation placeholder ("reading catalog...", "trying query..."). No log. |
| `agent_message_chunk` | Dropped while running. If the turn ends without an edit, the last message becomes a dismissible note on the script, styled like `GenerationError` but neutral. |
| `session/request_permission` | Answered by policy: allow DashQL read tools, deny everything else (the agent's own shell, file and web tools). Only DashQL's own consent prompts reach the user, such as running a query on a remote connection, shown inline in the script footer. |
| Stop button | `session/cancel` |

**Keeping the agent inside DashQL:**

- `initialize` is sent with `clientCapabilities.fs` and `terminal` off.
- The agent starts in an empty scratch directory as `cwd`.
- Any permission request outside the DashQL tools is denied.

To check per adapter: claude-agent-acp may run some read-only built-in tools without
asking. The scratch `cwd` limits what those can see.

### Agent context: one ACP session per DashQL session

- **Lifetime:** the ACP session is created on the first agent request in a DashQL
  session and reused for every later one, from any entry point and any script. The
  agent remembers earlier questions, the scripts it wrote, and what came of them.
- **Context deltas:** the user edits and runs scripts between agent turns, and the
  agent does not see that by itself. Each `session/prompt` starts with a small
  embedded-resource block:
  - which script and selection the request is about;
  - scripts created, edited or deleted since the last turn, with a short diff summary;
  - queries run since then: script, status, row count, and the error if any;
  - which connection is in focus.

  The agent fetches anything more detailed itself through `read_script`,
  `get_result_page` and `get_catalog`, which keeps prompts small.
- **Targeting:** mutating tools always name their script. The app routes the result
  to that script's pending diff or placeholder, so a request from script A can
  produce a change in script B or a new script.
- **Concurrency:** ACP runs one prompt turn at a time per session. A second request
  while a turn is running is queued and its placeholder reads "waiting for agent...".
  Stop cancels only the running turn.
- **Persistence:** the ACP `sessionId` is stored per bridge harness in the DashQL
  session's settings. After a reload, `session/load` is used when the agent
  advertises `loadSession`; otherwise a fresh session starts with a one-time digest of
  the whole DashQL session. `loadSession` support in claude-agent-acp and codex-acp is
  still to be checked.
- **Session chip:** a small chip in the session header shows the harness name and a
  busy or queued indicator. Its menu offers "Reset agent context" (starts a new ACP
  session) and "Continue in terminal" (`claude --resume <sessionId>`) for the full
  transcript. Whether claude-agent-acp sessions persist like Claude Code sessions is
  still to be checked.
- **Trade-off:** a long DashQL session grows the agent's context. Compaction is the
  harness's job; "Reset agent context" is the manual way out.

A Claude Code channel (A2) is the no-UI extreme: DashQL sends the request and the
conversation lives in the user's terminal, with only the effects showing up in the app.

### Pairing

1. The bridge starts, spawned by the harness or by hand. It binds `127.0.0.1` on a
   default port with a small fallback range and mints a one-time pairing secret.
2. The bridge prints or opens
   `https://dashql.app/?data=<base64 AgentPairEvent{port, secret, harness}>`
   (desktop: `dashql://localhost?data=...`). This reuses the existing event envelope
   and deep-link parser, extended with one new event type.
3. The app asks for confirmation ("Pair with Claude Code on port N?"), dials
   `ws://127.0.0.1:N`, swaps the secret for a long-lived device token, and keeps it
   for reconnects. A manual "Connect agent" dialog (port plus code) is the fallback.
4. The bridge enforces:
   - an Origin allowlist: `https://dashql.app`, `app://bundle`, and dev origins;
   - `Host` must be `127.0.0.1` or `localhost`, which blocks DNS rebinding;
   - the token on every connection;
   - one app connection per bridge.

### Security

- Query results and catalog text sent to the agent are untrusted data; tool
  descriptions say so.
- Mutating tools go through the pending-diff UI.
- Running a query needs per-connection consent (always / ask / never), shown in the
  app and not only in the harness.
- A visible "agent connected" indicator with a kill switch.

## Phasing

1. **Spike.** A standalone `ws://127.0.0.1` echo server opened from the deployed
   https://dashql.app on current Chrome stable, Firefox and Safari 26. Record the Local
   Network Access prompt behavior, confirm Safari fails, and check that COOP/COEP does
   not affect WebSockets.
2. **Registry, standalone bridge and pairing (B1, web).** `AgentToolRegistry`, the
   WebSocket transport, and `npx @dashql/agent-bridge` serving MCP over stdio and over
   `http://127.0.0.1/mcp`. Pairing through the `?data=` event. Checked with
   `claude mcp add dashql -- npx @dashql/agent-bridge`. Safari shows a "use the
   desktop app" notice instead of the pairing UI.
3. **Headless ACP integration (A1).** The bridge spawns claude-agent-acp, codex-acp or
   `gemini --acp` and tunnels ACP to the tab; the DashQL tools reach the agent through
   `session/new.mcpServers`. Then the `SqlGenerationBackend`, the inline-edit popover
   and "Fix with agent".
4. **Desktop embedding (B2).** The same bridge module runs in Electron main with the
   IPC transport, so desktop users install nothing.
5. **Optional.** Claude Code channel mode (A2) and the WebMCP adapter (B3).

## Files

- **New:** `packages/dashql-agent-bridge/`, `packages/dashql-app/src/platform/agent/`.
- **Touched:**
  - `packages/dashql-native/src/main.ts`, `packages/dashql-native/src/preload.ts`
  - `packages/dashql-app/src/platform/events/event.ts` and the proto/json event schema
  - `packages/dashql-native/src/deep_link.ts`
  - `packages/dashql-app/src/app/app.tsx`
  - `packages/dashql-app/src/app/session/ai/use_sql_generations.ts`
  - `packages/dashql-app/src/app/session/ai/ui/script_generation.tsx`,
    `packages/dashql-app/src/app/session/ai/editor/generation_placeholder.ts`
  - the script editor (inline prompt popover, "Fix with agent")
- **Reused:** `app/session/scripts/session_scripts.ts`,
  `app/connections/query_executor.tsx`, `app/session/ai/sql_generation.ts`,
  `packages/dashql-core-js/src/api.ts`, `platform/crosstab/app_ownership.ts`.

Everything builds through Bazel, per `docs/agents/build_bazel_targets.md`.

## Verification

- **Unit tests:** registry handlers against a test session; pairing token and
  Origin/Host checks; the ACP framing round-trip.
- **Phase 2:** with the web build on Chrome stable and Firefox, pair through the
  `?data=` link. Claude Code lists the tools, reads the catalog of an embedded HyperDB
  connection, proposes an edit (shown as a pending diff), and runs a query (which
  triggers the consent prompt). Safari shows the desktop-app notice.
- **Phase 3:** with claude-agent-acp and then codex-acp, ask a question in the
  composer:
  - the placeholder shows tool-call status lines;
  - the SQL arrives through `propose_script_edit` and then runs;
  - a Cmd+K edit shows up as a pending diff;
  - a request to use the agent's own shell tool is denied;
  - Stop cancels the turn;
  - a request in script B can refer to what the agent did in script A;
  - a query run by hand between turns shows up in the next context block;
  - a second request during a running turn shows as queued;
  - after a reload the session resumes through `session/load` where supported;
  - existing `useSqlGenerations` tests keep passing with the OpenAI backend.
- **Phase 4:** repeat the phase 2 checks against the Electron-embedded endpoint.

## Open Checks

- Chrome's WebSocket behavior under Local Network Access (prompt or hard block).
- Safari 26 behavior for `ws://127.0.0.1` from HTTPS.
- Which built-in tools claude-agent-acp runs without a permission request.
- `loadSession` support in claude-agent-acp and codex-acp.
- Whether claude-agent-acp sessions can be resumed with `claude --resume`.

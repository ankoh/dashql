// The messages between the page and the local agent server.
// The agent server documents these messages in packages/dashql-cli/src/agent/protocol.rs.
//
// Messages are JSON-RPC-style: a request {id, method, params} is answered by {id, result} or {id, error}.
// A message with a method but without an id is a notification.

/// The version of the protocol, the server turns away other versions
export const AGENT_PROTOCOL_VERSION = 1;

/// The default port of the agent server
export const DEFAULT_AGENT_PORT = 47100;

/// A session that the page holds
export interface AgentClientSession {
    /// The DashQL session id
    id: string;
    /// The display name of the session
    name: string;
}

/// page → server notification: the sessions with agent access, sent after connecting and on every change
export interface ClientSessionsParams {
    protocol: number;
    /// The kind of client, "web" or "desktop"
    client: string;
    sessions: AgentClientSession[];
    /// The session that the user looks at, null if it has no agent access
    focused: string | null;
}

/// server → page request: run a command against a session
export interface AgentCommandParams {
    session: string;
    command: string;
    args: Record<string, unknown>;
}

/// page → server response to a command
export interface AgentCommandResult {
    /// The output for the agent
    text: string;
    /// The structured output, printed with --json
    data?: unknown;
}

/// page → server request: run the harness with a prompt
export interface AgentRequestParams {
    session: string;
    /// The name of the harness, the server's default if omitted
    harness?: string;
    prompt: string;
}

/// server → page response to an agent request
export interface AgentRequestResult {
    runId: string;
    harness: string;
}

/// server → page response to agent/context
export interface AgentSessionContext {
    /// The working folder of harness runs of the session
    folder: string;
    /// The default harness
    harness: string;
    /// The harness session that the next request resumes
    harnessSession: string | null;
    /// The command that continues the harness session in a terminal
    terminalCommand: string[] | null;
}

/// page → server request: change the configuration of the server
export interface AgentConfigureParams {
    /// The harness that runs requests, one of the configured harnesses
    defaultHarness?: string;
}

/// A configured harness
export interface AgentHarnessInfo {
    name: string;
    /// The command template, changed in config.json only
    command: string[];
    adapter: string;
    /// The file that the program resolves to, null if it is not installed
    program: string | null;
}

/// A client of the agent server
export interface AgentServerClient {
    id: string;
    kind: string;
    origin: string;
    sessions: AgentClientSession[];
    focused: string | null;
}

/// A harness run of the agent server
export interface AgentServerRun {
    runId: string;
    session: string;
    harness: string;
    state: 'queued' | 'running';
    status: string;
}

/// server → page response to agent/info
export interface AgentServerInfo {
    port: number;
    /// The folder of the configuration and the state
    home: string;
    configPath: string;
    /// Does the server accept the dev origins?
    dev: boolean;
    defaultHarness: string;
    harnesses: AgentHarnessInfo[];
    clients: AgentServerClient[];
    runs: AgentServerRun[];
}

/// server → page notification: the state of a harness run
export interface AgentStatusParams {
    session: string;
    runId: string;
    state: 'queued' | 'running';
    /// The latest status line
    text: string;
}

/// server → page notification: a harness run finished
export interface AgentDoneParams {
    session: string;
    runId: string;
    /// The final message of the agent
    message: string;
}

/// server → page notification: a harness run failed or was stopped
export interface AgentFailedParams {
    session: string;
    runId: string;
    error: string;
    cancelled: boolean;
}

/// The error codes of failed calls
export type AgentErrorCode = 'failed' | 'not_connected' | 'busy' | 'usage';

export interface AgentRpcError {
    code: AgentErrorCode;
    message: string;
}

export interface AgentRpcMessage {
    id?: string | number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: AgentRpcError;
}

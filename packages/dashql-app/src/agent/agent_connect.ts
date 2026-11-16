import type { AgentSessionTarget } from '@ankoh/dashql/platform/session/agent_session_client';

/// What the prompt of a workbook takes: SQL that runs, or nothing while an agent in the terminal writes the scripts
export enum ComposerMode {
    Sql = 'sql',
    Ai = 'ai',
}

/// The harnesses that `dashql connect` runs
export type ConnectHarness = 'claude' | 'codex';

/// The command that runs the CLI of DashQL from npm, the latest version: npx would otherwise keep running a version
/// that it fetched once, and the page tells a server of an older protocol to update (agent_session_protocol.ts)
export const DASHQL_CLI_COMMAND = 'npx -y @ankoh/dashql-cli@latest';

/// The ports that a page picks for the server of a session, the dynamic ports that the system hands out rarely
const MIN_PORT = 49152;
const MAX_PORT = 65535;
/// The random bytes of a secret
const SECRET_BYTES = 18;

/// A new address for the server of a session: a random loopback port and a random secret as its token
export function newAgentConnectTarget(random: (bytes: Uint8Array<ArrayBuffer>) => void = bytes => crypto.getRandomValues(bytes)): AgentSessionTarget {
    const bytes = new Uint8Array(2 + SECRET_BYTES);
    random(bytes);
    const port = MIN_PORT + ((bytes[0] << 8) | bytes[1]) % (MAX_PORT - MIN_PORT + 1);
    const secret = btoa(String.fromCharCode(...bytes.subarray(2))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { endpoint: `http://127.0.0.1:${port}`, token: secret };
}

/// The line that runs a harness and shows its session in the page that waits on the target
export function agentConnectCommand(harness: ConnectHarness, target: AgentSessionTarget): string {
    const port = new URL(target.endpoint).port;
    return `${DASHQL_CLI_COMMAND} connect --launch ${harness} --port ${port} --secret ${target.token}`;
}

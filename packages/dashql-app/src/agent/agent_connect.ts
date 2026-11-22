import type { AgentSessionTarget } from '@akohn/dashql/platform/session/agent_session_client';

import { DASHQL_CLI_VERSION } from '../globals.js';

/// What the prompt of a workbook takes: SQL that runs, or nothing while an agent in the terminal writes the scripts
export enum ComposerMode {
    Sql = 'sql',
    Ai = 'ai',
}

/// The harnesses that `dashql connect` runs
export type ConnectHarness = 'claude' | 'codex';

/// The command that runs the CLI of DashQL from npm, the version of the build of the page: CI publishes it before it
/// deploys the page, the dev server takes the latest (DASHQL_CLI_VERSION). The page still tells a server of another
/// protocol to update (agent_session_protocol.ts). From the public registry without a minimum release age: a company's
/// mirror or release-age policy in the npm config of the user would hold back a version published minutes ago.
const NPX_LINES = ['npx -y', '--registry=https://registry.npmjs.org/', '--min-release-age=0'];
const DASHQL_CLI_PACKAGE = `@akohn/dashql-cli@${DASHQL_CLI_VERSION}`;
export const DASHQL_CLI_COMMAND = [...NPX_LINES, DASHQL_CLI_PACKAGE].join(' ');

/// The ports that a page picks for the server of a session: below the ports that the systems hand out to connections by
/// default, Linux from 32768 to 60999, macOS and Windows from 49152. A port that the system had given to a connection
/// fails `dashql connect` with EADDRINUSE, which happened in CI on port 60968.
const MIN_PORT = 20000;
const MAX_PORT = 32767;
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

/// The command that runs a harness and shows its session in the page that waits on the target, as lines to show: the
/// program, then every option on a line of its own. Joined with spaces it is the line to copy, a shell would run the
/// lines one by one.
export function agentConnectCommandLines(harness: ConnectHarness, target: AgentSessionTarget): string[] {
    const port = new URL(target.endpoint).port;
    return [...NPX_LINES, `${DASHQL_CLI_PACKAGE} connect`, `--launch ${harness}`, `--port ${port}`, `--secret ${target.token}`];
}

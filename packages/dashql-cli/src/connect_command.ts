import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SESSION_FOLDER_PATH } from '@akohn/dashql/platform/session/session_folder';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { CONNECTED_AGENT_GUIDE } from './describe_command.js';
import { options, shellWord } from './session_command.js';
import { sessionFolder } from './session_folder.js';
import { SESSION_RUNS_ERROR, startSessionServer } from './session_server.js';

export const CONNECT_USAGE = `Usage:
  dashql connect --launch <claude|codex> --port <port> --secret <secret> [--folder <dir>]
                 [--command <program>] [-- <argument>...]
      Shows a session of Claude Code or Codex live in the tab of DashQL that gave this command. Starts the server of
      the session on 127.0.0.1:<port> with the secret as its token, launches the harness in this terminal with the
      hooks that send its events there, and ends the session when the harness exits. The arguments after -- go to
      the harness. --command runs another program of the harness than claude or codex on the PATH.
      Codex asks to trust the hooks of DashQL once, at its start. One session runs in a folder (--folder, else this
      one), a second fails while the server of the first answers.

      The harness learns how to work on the workbooks of DashQL at its start: Claude Code in its system prompt,
      Codex from the output of the hook. Claude Code runs the commands of dashql and edits the workbooks of the
      session without asking.`;

/// The harnesses that `dashql connect` runs
const HARNESSES = new Set(['claude', 'codex']);

/// The events that the hooks of a harness send. Codex has no SessionEnd, `dashql connect` ends the session when the
/// harness exits either way. Claude Code tells a tool that failed with PostToolUseFailure instead of PostToolUse, a turn
/// that an error ended with StopFailure instead of Stop, and with Notification that it waits for an approval or is
/// idle; Codex has none of them.
const HOOK_EVENTS: Record<string, string[]> = {
    claude: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'],
    codex: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
};
/// The events of tools, their hooks match every tool
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

/// What `dashql connect` takes from the process, the tests pass their own
export interface ConnectEnvironment {
    /// The program and the arguments that run dashql again, the hooks call it
    dashql: string[];
    /// The search path of the process, the harness gets a `dashql` in front of it
    searchPath: string;
    /// Can the harness run a shell script as `dashql`? Not on Windows.
    posix: boolean;
    /// A new id of a session
    sessionId: () => string;
    /// Run the harness in this terminal, resolves with its exit code
    runHarness: (program: string, args: string[], env: Record<string, string>, cwd: string) => Promise<number>;
}

export function processConnectEnvironment(): ConnectEnvironment {
    return {
        dashql: [process.execPath, process.argv[1]],
        searchPath: process.env.PATH ?? '',
        posix: process.platform !== 'win32',
        sessionId: () => randomUUID(),
        runHarness: (program, args, env, cwd) => new Promise<number>((resolve, reject) => {
            const child = spawn(program, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
            // Ctrl-C reaches the harness in the same terminal, the harness decides what it means
            const ignore = () => { };
            const forward = () => child.kill('SIGTERM');
            process.on('SIGINT', ignore);
            process.on('SIGTERM', forward);
            const done = () => {
                process.off('SIGINT', ignore);
                process.off('SIGTERM', forward);
            };
            child.once('error', error => {
                done();
                reject(error);
            });
            child.once('exit', (code, signal) => {
                done();
                resolve(code ?? (signal != null ? 128 + (signalNumbers[signal] ?? 1) : EXIT_FAILED));
            });
        }),
    };
}

/// The numbers of the signals that end a harness, for the exit code like a shell reports it
const signalNumbers: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/// Put a `dashql` that runs this dashql into the folder of the session, the agent of a harness that `npx` launched
/// has none on its path. Returns the folder of the command, null if it can't be written. The folder of the session
/// goes when the session ends.
export function writeDashqlCommand(folder: string, dashql: string[]): string | null {
    const bin = path.join(sessionFolder(folder), 'bin');
    try {
        mkdirSync(bin, { recursive: true });
        const command = path.join(bin, 'dashql');
        writeFileSync(command, `#!/bin/sh\nexec ${dashql.map(shellWord).join(' ')} "$@"\n`);
        chmodSync(command, 0o755);
        return bin;
    } catch {
        return null;
    }
}

/// The command of a hook of a harness, the folder of the session in its arguments
function hookCommand(dashql: string[], event: string, harness: string, workspace: string): string {
    return [...dashql, 'session', 'hook', event, '--harness', harness, '--workspace', workspace].map(shellWord).join(' ');
}

/// The commands of dashql that the agent runs. Not init: a workspace is up to the user, an agent that set up the
/// folder of a wrong path would run it outside the tab.
const AGENT_COMMANDS = ['describe', 'catalog', 'run', 'vis', 'move', 'lint', 'format'];

/// What Claude Code may do in a session without asking: run the commands of dashql of the agent and edit the files of
/// the session, the copies of the workbooks of the tab
export const CLAUDE_ALLOWED_TOOLS = [...AGENT_COMMANDS.map(command => `Bash(dashql ${command}:*)`), `Edit(./${SESSION_FOLDER_PATH}/**)`];

/// The arguments that give Claude Code the session: settings that it loads in addition to its own, with the hooks of
/// the session and the tools it may use without asking, and the guide of DashQL in its system prompt
export function claudeHookArgs(dashql: string[], workspace: string): string[] {
    const hooks = Object.fromEntries(HOOK_EVENTS.claude.map(event => [event, [{
        ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}),
        hooks: [{ type: 'command', command: hookCommand(dashql, event, 'claude', workspace) }],
    }]]));
    return ['--settings', JSON.stringify({ hooks, permissions: { allow: CLAUDE_ALLOWED_TOOLS } }), '--append-system-prompt', CONNECTED_AGENT_GUIDE];
}

/// The arguments that give Codex the hooks of the session: a config override, its TUI asks to trust them
export function codexHookArgs(dashql: string[], workspace: string): string[] {
    // A TOML inline table, the basic strings of TOML escape like JSON
    const events = HOOK_EVENTS.codex.map(event => `${event}=[{hooks=[{type="command",command=${JSON.stringify(hookCommand(dashql, event, 'codex', workspace))}}]}]`);
    return ['-c', `hooks={${events.join(',')}}`];
}

/// Run `connect` with the arguments after it, returns the exit code
export async function runConnect(argv: string[], cli: CliProcess, env: ConnectEnvironment = processConnectEnvironment()): Promise<number> {
    let parsed: ReturnType<typeof options>;
    try {
        parsed = options(argv, new Set(['help']));
    } catch (error) {
        cli.stderr(`error: ${String(error)}\n\n${CONNECT_USAGE}\n`);
        return EXIT_USAGE;
    }
    const { positional, named, set, rest } = parsed;
    if (set.has('help') || argv[0] === '-h') {
        cli.stdout(`${CONNECT_USAGE}\n`);
        return EXIT_OK;
    }
    const harness = named.get('launch');
    const port = Number(named.get('port'));
    const secret = named.get('secret') ?? '';
    const usage = (message: string) => {
        cli.stderr(`error: ${message}\n\n${CONNECT_USAGE}\n`);
        return EXIT_USAGE;
    };
    if (harness == null || !HARNESSES.has(harness)) return usage(harness == null ? '--launch needs the harness, claude or codex' : `unknown harness ${harness}`);
    if (positional.length > 0) return usage(`unexpected argument ${positional[0]}`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return usage('--port needs a port between 1 and 65535');
    if (secret.length === 0) return usage('--secret needs the secret that DashQL shows');

    const folder = path.resolve(cli.cwd, named.get('folder') ?? '.');
    // The id of the session names its state, the file of the session holds it
    const session = env.sessionId();
    let server: Awaited<ReturnType<typeof startSessionServer>>;
    try {
        server = await startSessionServer({ harness, folder, port, token: secret, session });
    } catch (error) {
        const code = (error as { code?: string }).code;
        cli.stderr(code === 'EADDRINUSE'
            ? `dashql: port ${port} is taken, get a new line in DashQL\n`
            : code === SESSION_RUNS_ERROR
                ? `dashql: a session of dashql connect already runs in ${folder}, end it first\n`
                : `dashql: the server of the session did not start: ${String(error)}\n`);
        return EXIT_FAILED;
    }
    const program = named.get('command') ?? harness;
    const args = [...(harness === 'claude' ? claudeHookArgs(env.dashql, folder) : codexHookArgs(env.dashql, folder)), ...rest];
    cli.stdout(`DashQL follows this session on 127.0.0.1:${server.port}\n`);
    // The session goes to the harness in the arguments of its hooks, the agent learns it at the start: nothing in the
    // environment but the `dashql` of the agent, which runs this dashql like the hooks do
    const harnessEnv: Record<string, string> = {};
    const bin = env.posix ? writeDashqlCommand(folder, env.dashql) : null;
    if (bin != null) harnessEnv.PATH = env.searchPath.length > 0 ? `${bin}${path.delimiter}${env.searchPath}` : bin;
    let code: number;
    try {
        code = await env.runHarness(program, args, harnessEnv, folder);
    } catch (error) {
        cli.stderr((error as { code?: string }).code === 'ENOENT'
            ? `dashql: cannot run ${program}, is ${harness === 'claude' ? 'Claude Code' : 'Codex'} installed?\n`
            : `dashql: cannot run ${program}: ${String(error)}\n`);
        code = EXIT_FAILED;
    }
    // The page learns that the session ended, also from a harness without SessionEnd
    server.end();
    await server.close();
    return code;
}

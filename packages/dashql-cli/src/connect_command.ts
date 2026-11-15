import { spawn } from 'node:child_process';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { options, postSessionEvent, SESSION_ENDPOINT_ENV, SESSION_TOKEN_ENV, type SessionTarget } from './session_command.js';
import { startSessionServer } from './session_server.js';

export const CONNECT_USAGE = `Usage:
  dashql connect --launch <claude|codex> --port <port> --secret <secret> [--folder <dir>] [--command <program>] [-- <argument>...]
      Shows a session of Claude Code or Codex live in the tab of DashQL that gave this command. Starts the server of
      the session on 127.0.0.1:<port> with the secret as its token, launches the harness in this terminal with the
      hooks that send its events there, and ends the session when the harness exits. The arguments after -- go to
      the harness. --command runs another program of the harness than claude or codex on the PATH.
      Codex asks to trust the hooks of DashQL once, at its start.`;

/// The harnesses that `dashql connect` runs
const HARNESSES = new Set(['claude', 'codex']);

/// The events that the hooks of a harness send. Codex has no SessionEnd, `dashql connect` ends the session when the
/// harness exits either way.
const HOOK_EVENTS: Record<string, string[]> = {
    claude: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'],
    codex: ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'],
};

/// What `dashql connect` takes from the process, the tests pass their own
export interface ConnectEnvironment {
    /// The folder of the files of DashQL (DASHQL_HOME), null for the `.dashql/` of the folder of the session
    home: string | null;
    /// The program and the arguments that run dashql again, the hooks call it
    dashql: string[];
    /// Run the harness in this terminal, resolves with its exit code
    runHarness: (program: string, args: string[], env: Record<string, string>, cwd: string) => Promise<number>;
}

export function processConnectEnvironment(): ConnectEnvironment {
    return {
        home: process.env.DASHQL_HOME || null,
        dashql: [process.execPath, process.argv[1]],
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

/// A word of a POSIX shell command
export function shellWord(word: string): string {
    return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/// The command of a hook of a harness
function hookCommand(dashql: string[], event: string, harness: string): string {
    return [...dashql, 'session', 'hook', event, '--harness', harness, '--connected'].map(shellWord).join(' ');
}

/// The arguments that give Claude Code the hooks of the session: settings that it loads in addition to its own
export function claudeHookArgs(dashql: string[]): string[] {
    const hooks = Object.fromEntries(HOOK_EVENTS.claude.map(event => [event, [{
        ...(event === 'PostToolUse' ? { matcher: '*' } : {}),
        hooks: [{ type: 'command', command: hookCommand(dashql, event, 'claude') }],
    }]]));
    return ['--settings', JSON.stringify({ hooks })];
}

/// The arguments that give Codex the hooks of the session: a config override, its TUI asks to trust them
export function codexHookArgs(dashql: string[]): string[] {
    // A TOML inline table, the basic strings of TOML escape like JSON
    const events = HOOK_EVENTS.codex.map(event => `${event}=[{hooks=[{type="command",command=${JSON.stringify(hookCommand(dashql, event, 'codex'))}}]}]`);
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

    const folder = named.get('folder') ?? cli.cwd;
    let server: Awaited<ReturnType<typeof startSessionServer>>;
    try {
        server = await startSessionServer({ harness, folder, home: env.home, port, token: secret });
    } catch (error) {
        const code = (error as { code?: string }).code;
        cli.stderr(code === 'EADDRINUSE'
            ? `dashql: port ${port} is taken, get a new line in DashQL\n`
            : `dashql: the server of the session did not start: ${String(error)}\n`);
        return EXIT_FAILED;
    }
    const target: SessionTarget = { endpoint: `http://127.0.0.1:${server.port}`, token: secret };
    const program = named.get('command') ?? harness;
    const args = [...(harness === 'claude' ? claudeHookArgs(env.dashql) : codexHookArgs(env.dashql)), ...rest];
    cli.stdout(`DashQL follows this session on 127.0.0.1:${server.port}\n`);
    let code: number;
    try {
        code = await env.runHarness(program, args, { [SESSION_ENDPOINT_ENV]: target.endpoint, [SESSION_TOKEN_ENV]: target.token }, folder);
    } catch (error) {
        cli.stderr((error as { code?: string }).code === 'ENOENT'
            ? `dashql: cannot run ${program}, is ${harness === 'claude' ? 'Claude Code' : 'Codex'} installed?\n`
            : `dashql: cannot run ${program}: ${String(error)}\n`);
        code = EXIT_FAILED;
    }
    // The page learns that the session ended, also from a harness without SessionEnd
    if (!server.state().ended) {
        try {
            await postSessionEvent(target, { event: 'SessionEnd', harness, folder });
        } catch {
            // The page finds the server gone
        }
    }
    await server.close();
    return code;
}

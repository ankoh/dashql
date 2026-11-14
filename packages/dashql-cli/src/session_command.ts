import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { sessionEventOf } from './session_hook.js';
import { startSessionServer } from './session_server.js';

export const SESSION_USAGE = `Usage:
  dashql session hook <event> --harness <name>
      Called by a hook of the harness with its payload on stdin: SessionStart, UserPromptSubmit, PostToolUse, Stop or
      SessionEnd. Starts the server of the session if it has none and sends the event to it. SessionStart prints the
      link that shows the session in DashQL. Never fails the harness.
  dashql session serve --session <id> --harness <name> [--folder <dir>] [--port <port>]
      Runs the server of a session on 127.0.0.1 until the harness ends the session.
  dashql session link [--session <id>]
      Prints the link of a running session, the latest one by default.

DASHQL_SERVERS is the folder of the running servers of sessions (~/.dashql/servers), DASHQL_APP_URL the page of the links
(https://dashql.app).`;

/// A running session, as its server leaves it in the folder of the servers
interface SessionFile {
    session: string;
    port: number;
    token: string;
    pid: number;
}

/// Where the sessions and the links point to
export interface SessionEnvironment {
    /// The folder of the running servers of sessions, a file per server
    servers: string;
    /// The folder of the files of DashQL (DASHQL_HOME), null for the `.dashql/` of the folder of the session
    home: string | null;
    /// The page of the links
    appUrl: string;
    /// Start `dashql session serve` with the arguments after `session serve`, detached from the hook
    startServer: (args: string[]) => void;
}

export function processSessionEnvironment(): SessionEnvironment {
    return {
        servers: process.env.DASHQL_SERVERS || path.join(homedir(), '.dashql', 'servers'),
        home: process.env.DASHQL_HOME || null,
        appUrl: process.env.DASHQL_APP_URL || 'https://dashql.app',
        startServer: args => {
            // Node runs the module of dashql again, a hook must not wait for the server
            spawn(process.execPath, [process.argv[1], 'session', 'serve', ...args], { detached: true, stdio: 'ignore' }).unref();
        },
    };
}

/// The name of a session in a file name
function sessionFileName(session: string): string {
    return `${session.replace(/[^\w.-]/g, '_')}.json`;
}

function readSessionFile(servers: string, session: string): SessionFile | null {
    try {
        return JSON.parse(readFileSync(path.join(servers, sessionFileName(session)), 'utf8')) as SessionFile;
    } catch {
        return null;
    }
}

/// The link of a page to a session
export function sessionLink(appUrl: string, file: Pick<SessionFile, 'port' | 'token'>): string {
    const data = Buffer.from(JSON.stringify({ agentSession: { endpoint: `http://127.0.0.1:${file.port}`, token: file.token } })).toString('base64url');
    return `${appUrl.replace(/\/$/, '')}/?data=${data}`;
}

/// Does the server of a session answer?
async function alive(file: SessionFile): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${file.port}/v1/state`, {
            headers: { Authorization: `Bearer ${file.token}` },
            signal: AbortSignal.timeout(1000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

/// The options of a command, `--name value` or `--name=value`
function options(args: string[]): { positional: string[]; named: Map<string, string> } {
    const positional: string[] = [];
    const named = new Map<string, string>();
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const eq = arg.indexOf('=');
        if (eq >= 0) {
            named.set(arg.slice(2, eq), arg.slice(eq + 1));
        } else {
            if (i + 1 >= args.length) throw `option ${arg} needs a value`;
            named.set(arg.slice(2), args[++i]);
        }
    }
    return { positional, named };
}

async function hook(args: string[], cli: CliProcess, env: SessionEnvironment): Promise<number> {
    const { positional, named } = options(args);
    const [name] = positional;
    const harness = named.get('harness') ?? 'agent';
    let payload: unknown = {};
    try {
        const input = new TextDecoder().decode(await cli.readStdin());
        if (input.trim().length > 0) payload = JSON.parse(input);
    } catch {
        // A hook without a payload still tells the event
    }
    const event = sessionEventOf(name ?? '', harness, payload);
    if (event == null) return EXIT_OK;
    const session = (payload as { session_id?: unknown })?.session_id;
    const id = typeof session === 'string' && session.length > 0 ? session : 'default';
    let file = readSessionFile(env.servers, id);
    if (file == null || !(await alive(file))) {
        if (event.event === 'SessionEnd') return EXIT_OK;
        env.startServer(['--session', id, '--harness', harness, '--folder', event.folder || cli.cwd]);
        file = null;
        for (let i = 0; i < 100 && file == null; ++i) {
            await new Promise(resolve => setTimeout(resolve, 50));
            const written = readSessionFile(env.servers, id);
            if (written != null && await alive(written)) file = written;
        }
        if (file == null) {
            cli.stderr('dashql: the server of the session did not start\n');
            return EXIT_OK;
        }
    }
    try {
        await fetch(`http://127.0.0.1:${file.port}/v1/events`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${file.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(event),
            signal: AbortSignal.timeout(2000),
        });
    } catch (error) {
        cli.stderr(`dashql: the session did not take the event: ${String(error)}\n`);
    }
    if (event.event === 'SessionStart') cli.stdout(`DashQL shows this session at ${sessionLink(env.appUrl, file)}\n`);
    return EXIT_OK;
}

async function serve(args: string[], cli: CliProcess, env: SessionEnvironment): Promise<number> {
    const { named } = options(args);
    const id = named.get('session') ?? 'default';
    const server = await startSessionServer({
        harness: named.get('harness') ?? 'agent',
        folder: named.get('folder') ?? cli.cwd,
        home: env.home,
        port: Number(named.get('port') ?? 0),
        onEnd: () => setTimeout(() => void stop(), 100),
    });
    mkdirSync(env.servers, { recursive: true });
    const target = path.join(env.servers, sessionFileName(id));
    const file: SessionFile = { session: id, port: server.port, token: server.token, pid: process.pid };
    // Written at once, a hook never reads half of it
    writeFileSync(`${target}.tmp`, JSON.stringify(file), { mode: 0o600 });
    renameSync(`${target}.tmp`, target);
    cli.stdout(`${sessionLink(env.appUrl, file)}\n`);
    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        rmSync(target, { force: true });
        await server.close();
        process.exit(EXIT_OK);
    };
    process.on('SIGINT', () => void stop());
    process.on('SIGTERM', () => void stop());
    return await new Promise<number>(() => { });
}

function link(args: string[], cli: CliProcess, env: SessionEnvironment): number {
    const { named } = options(args);
    let id = named.get('session');
    if (id == null) {
        // The latest session
        let names: string[];
        try {
            names = readdirSync(env.servers).filter(name => name.endsWith('.json'));
        } catch {
            names = [];
        }
        names.sort((a, b) => statSync(path.join(env.servers, b)).mtimeMs - statSync(path.join(env.servers, a)).mtimeMs);
        id = names[0]?.slice(0, -'.json'.length);
    }
    const file = id == null ? null : readSessionFile(env.servers, id);
    if (file == null) {
        cli.stderr('dashql: no session runs\n');
        return EXIT_FAILED;
    }
    cli.stdout(`${sessionLink(env.appUrl, file)}\n`);
    return EXIT_OK;
}

/// Run `session` with the arguments after it, returns the exit code
export async function runSession(argv: string[], cli: CliProcess, env: SessionEnvironment = processSessionEnvironment()): Promise<number> {
    const [command, ...args] = argv;
    try {
        switch (command) {
            case 'hook':
                return await hook(args, cli, env);
            case 'serve':
                return await serve(args, cli, env);
            case 'link':
                return link(args, cli, env);
            case '-h':
            case '--help':
                cli.stdout(`${SESSION_USAGE}\n`);
                return EXIT_OK;
            default:
                cli.stderr(`${command == null ? '' : `error: unknown command session ${command}\n\n`}${SESSION_USAGE}\n`);
                return EXIT_USAGE;
        }
    } catch (error) {
        cli.stderr(`error: ${typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)}\n\n${SESSION_USAGE}\n`);
        // A hook never fails the harness
        return command === 'hook' ? EXIT_OK : EXIT_USAGE;
    }
}

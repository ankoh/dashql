import path from 'node:path';

import { fetchAgentSession } from '@akohn/dashql/platform/session/agent_session_protocol';
import type { AgentSessionEvent } from '@akohn/dashql/platform/session/agent_session_state';

import { EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { CONNECTED_AGENT_GUIDE, describeSession } from './describe_command.js';
import { sessionEventOf } from './session_hook.js';
import { readSession, sessionCopiesFolder } from './session_folder.js';

export const SESSION_USAGE = `Usage:
  dashql session hook <event> --harness <name> --workspace <dir>
      The hooks that dashql connect gives the harness. Called with the payload of the hook on stdin: SessionStart,
      UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Notification, Stop, StopFailure or SessionEnd.
      Sends the event to the server of the session that runs in --workspace (dashql-workspace.json).
      SessionStart prints how to work on the workbooks of the session. Never fails the harness.`;

/// A word of a POSIX shell command
export function shellWord(word: string): string {
    return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/// What a hook of `dashql connect` tells the agent at the start of the session, the harness puts it into the context:
/// the folder of the copies and the workspace that describe takes
export function connectedSessionStartText(workspace: string): string {
    const copies = shellWord(`${sessionCopiesFolder(workspace)}/`);
    const folder = shellWord(workspace);
    return `DashQL shows this session live in the browser tab that started it. The tab copies its workbook into
${copies}<id>/, work on that folder as the guide of DashQL says, for example: dashql run ${copies}<id>. Your workspace
is ${folder}, dashql describe --workspace ${folder} prints the guide again.`;
}

/// What the hook at the start of a session of `dashql connect` prints for a harness: the guide unless the harness has
/// it in its system prompt, then the session, the workbooks and the connections of the folder, relative to the folder
/// of the hook
export function connectedSessionStart(harness: string, workspace: string, cwd: string): string {
    const guide = harness === 'claude' ? '' : `${CONNECTED_AGENT_GUIDE}\n\n`;
    return `${guide}${connectedSessionStartText(workspace)}\n\n${describeSession(workspace, cwd)}`;
}

/// The server of a session that a hook sends to
export interface SessionTarget {
    /// The base URL, `http://127.0.0.1:<port>`
    endpoint: string;
    token: string;
}

/// The options of a command, `--name value` or `--name=value`, and the `flags` without a value.
/// The arguments after `--` are `rest`.
export function options(args: string[], flags: ReadonlySet<string> = new Set()): { positional: string[]; named: Map<string, string>; set: Set<string>; rest: string[] } {
    const positional: string[] = [];
    const named = new Map<string, string>();
    const set = new Set<string>();
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg === '--') return { positional, named, set, rest: args.slice(i + 1) };
        if (!arg.startsWith('--')) {
            positional.push(arg);
            continue;
        }
        const eq = arg.indexOf('=');
        if (eq >= 0) {
            named.set(arg.slice(2, eq), arg.slice(eq + 1));
        } else if (flags.has(arg.slice(2))) {
            set.add(arg.slice(2));
        } else {
            if (i + 1 >= args.length) throw `option ${arg} needs a value`;
            named.set(arg.slice(2), args[++i]);
        }
    }
    return { positional, named, set, rest: [] };
}

/// Send an event to the server of a session
async function postSessionEvent(target: SessionTarget, event: AgentSessionEvent): Promise<void> {
    await fetchAgentSession(`${target.endpoint}/v1/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2000),
    });
}

async function hook(args: string[], cli: CliProcess): Promise<number> {
    const { positional, named } = options(args);
    const [name] = positional;
    const harness = named.get('harness');
    const folder = named.get('workspace');
    if (harness == null) throw '--harness names the harness of the hook';
    if (folder == null) throw '--workspace names the workspace of the session of dashql connect';
    const workspace = path.resolve(cli.cwd, folder);
    let payload: unknown = {};
    try {
        const input = new TextDecoder().decode(await cli.readStdin());
        if (input.trim().length > 0) payload = JSON.parse(input);
    } catch {
        // A hook without a payload still tells the event
    }
    const event = sessionEventOf(name ?? '', payload);
    if (event == null) return EXIT_OK;
    const target = readSession(workspace);
    if (target == null) {
        cli.stderr(`dashql: no session of dashql connect runs in ${workspace}\n`);
        return EXIT_OK;
    }
    try {
        await postSessionEvent(target, event);
    } catch (error) {
        cli.stderr(`dashql: the session did not take the event: ${String(error)}\n`);
    }
    if (event.event === 'SessionStart') cli.stdout(connectedSessionStart(harness, workspace, cli.cwd));
    return EXIT_OK;
}

/// Run `session` with the arguments after it, returns the exit code
export async function runSession(argv: string[], cli: CliProcess): Promise<number> {
    const [command, ...args] = argv;
    try {
        switch (command) {
            case 'hook':
                return await hook(args, cli);
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

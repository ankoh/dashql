import { fetchAgentSession } from '@akohn/dashql/platform/session/agent_session_protocol';
import type { AgentSessionEvent } from '@akohn/dashql/platform/session/agent_session_state';

import { EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { CONNECTED_AGENT_GUIDE, describeWorkspace } from './describe_command.js';
import { sessionEventOf, workbookOnlyRefusal } from './session_hook.js';
import { readSessionServer } from './session_journal.js';

export const SESSION_USAGE = `Usage:
  dashql session hook <event> --harness <name> --workspace <dir> --session <id> [--workbook-only]
      The hooks that dashql connect gives the harness. Called with the payload of the hook on stdin: SessionStart,
      UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop or SessionEnd. Sends the event to the
      server of the session that --workspace and --session name. SessionStart prints how to work on the workbooks of
      the session. --workbook-only refuses the file tools outside the copies of the workbooks. Never fails the
      harness.`;

/// The exit code of a hook that refuses a tool, Claude Code and Codex show its stderr to the agent
const EXIT_REFUSED = 2;

/// A word of a POSIX shell command
export function shellWord(word: string): string {
    return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/// The arguments that name the session of `dashql connect` to a command, as the agent passes them
export function sessionArgs(workspace: string, session: string): string {
    return `--workspace ${shellWord(workspace)} --session ${session}`;
}

/// What a hook of `dashql connect` tells the agent at the start of the session, the harness puts it into the context:
/// the copies and the session that the commands take
export function connectedSessionStartText(workspace: string, session: string): string {
    const args = sessionArgs(workspace, session);
    return `DashQL shows this session live in the browser tab that started it. The tab copies its workbook into
.dashql/workbooks/<id>/ of this folder, work on that folder as the guide of DashQL says. Pass this session to dashql
catalog, describe, run and vis, they fail without it on a copy of the tab: ${args}
For example: dashql run ${args} ${shellWord(`${workspace}/.dashql/workbooks/`)}<id>`;
}

/// What the hook at the start of a session of `dashql connect` prints for a harness: the guide unless the harness has
/// it in its system prompt, then the session, the workbooks and the connections of the folder
export function connectedSessionStart(harness: string, workspace: string, session: string): string {
    const guide = harness === 'claude' ? '' : `${CONNECTED_AGENT_GUIDE}\n\n`;
    return `${guide}${connectedSessionStartText(workspace, session)}\n\n${describeWorkspace(workspace, session)}`;
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
export async function postSessionEvent(target: SessionTarget, event: AgentSessionEvent): Promise<void> {
    await fetchAgentSession(`${target.endpoint}/v1/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(2000),
    });
}

async function hook(args: string[], cli: CliProcess): Promise<number> {
    const { positional, named, set } = options(args, new Set(['workbook-only']));
    const [name] = positional;
    const harness = named.get('harness') ?? 'agent';
    const workspace = named.get('workspace');
    const session = named.get('session');
    if (workspace == null || session == null) throw '--workspace and --session name the session of dashql connect';
    let payload: unknown = {};
    try {
        const input = new TextDecoder().decode(await cli.readStdin());
        if (input.trim().length > 0) payload = JSON.parse(input);
    } catch {
        // A hook without a payload still tells the event
    }
    const event = sessionEventOf(name ?? '', harness, payload);
    if (event == null) return EXIT_OK;
    // A harness that may write only into the workbooks: the hook refuses the tool, the agent reads why. Relative paths
    // are relative to the directory of the agent, the `cwd` of the payload.
    const refusal = set.has('workbook-only') && event.event === 'PreToolUse' ? workbookOnlyRefusal(payload, workspace, event.folder || cli.cwd) : null;
    if (refusal != null) {
        cli.stderr(`${refusal}\n`);
        return EXIT_REFUSED;
    }
    const target = readSessionServer(workspace, session);
    if (target == null) {
        cli.stderr(`dashql: the session ${session} does not run in ${workspace}\n`);
        return EXIT_OK;
    }
    try {
        await postSessionEvent(target, event);
    } catch (error) {
        cli.stderr(`dashql: the session did not take the event: ${String(error)}\n`);
    }
    if (event.event === 'SessionStart') cli.stdout(connectedSessionStart(harness, workspace, session));
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

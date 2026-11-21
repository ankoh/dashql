// `dashql move`: move a script of a workbook folder in the feed, the order of the scripts of its dashql-workbook.json.
// An agent moves scripts with it instead of editing the list of the workbook file.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@akohn/dashql/platform/storage/storage_backend';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { scriptFileName } from './vis_command.js';

export const MOVE_USAGE = `Usage: dashql move <workbook-dir> <script> (--before <script> | --after <script> | --first | --last)

Moves a script of a workbook folder in the feed: the order of the scripts in dashql-workbook.json, which the feed of
DashQL shows. A script is named like orders, orders.sql or scripts/orders.sql. A script of the folder that the workbook
file doesn't list yet goes in with the connection of the script before it. Prints the new order. The tab of a session
of dashql connect takes the order of a workbook that it copied.

A new script that the tab takes goes after the scripts that it reads and before the ones that read it, move a script
only to put it elsewhere.`;

/// Where a script goes
type Target = { kind: 'before' | 'after'; script: string } | { kind: 'first' | 'last' };

/// An entry of the script list of a workbook file, with the fields that this command keeps as they are
interface ScriptEntry {
    name: string;
    connectionId?: string;
    [field: string]: unknown;
}

/// Parse the arguments, an error message if they are invalid
function parseMoveArgs(args: string[]): { workbook: string; script: string; target: Target } | string {
    const positional: string[] = [];
    const targets: Target[] = [];
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg === '--before' || arg === '--after') {
            const value = args[++i];
            if (value == null || value.startsWith('-')) return `${arg} takes a script`;
            targets.push({ kind: arg === '--before' ? 'before' : 'after', script: value });
        } else if (arg === '--first' || arg === '--last') {
            targets.push({ kind: arg === '--first' ? 'first' : 'last' });
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            positional.push(arg);
        }
    }
    if (positional.length !== 2) return positional.length < 2 ? 'missing the workbook folder or the script' : `unexpected argument ${positional[2]}`;
    if (targets.length !== 1) return 'name one place: --before <script>, --after <script>, --first or --last';
    return { workbook: positional[0], script: positional[1], target: targets[0] };
}

/// Run `move` with the arguments after it, returns the exit code
export function runMove(args: string[], cli: CliProcess): number {
    if (args.includes('-h') || args.includes('--help')) {
        cli.stdout(`${MOVE_USAGE}\n`);
        return EXIT_OK;
    }
    const parsed = parseMoveArgs(args);
    if (typeof parsed === 'string') {
        cli.stderr(`error: ${parsed}\n\n${MOVE_USAGE}\n`);
        return EXIT_USAGE;
    }
    const dir = path.resolve(cli.cwd, parsed.workbook);
    const file = path.join(dir, STORAGE_WORKBOOK_FILE);
    let workbook: { scripts?: unknown; [field: string]: unknown };
    try {
        workbook = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        cli.stderr(`error: ${parsed.workbook} is no workbook folder, it has no readable ${STORAGE_WORKBOOK_FILE}\n`);
        return EXIT_USAGE;
    }
    const entries: ScriptEntry[] = (Array.isArray(workbook.scripts) ? workbook.scripts : [])
        .filter((entry): entry is ScriptEntry => typeof entry?.name === 'string');
    const name = scriptFileName(parsed.script);
    const listed = entries.findIndex(entry => entry.name === name);
    if (listed < 0 && !existsSync(path.join(dir, STORAGE_SCRIPTS_FOLDER, name))) {
        cli.stderr(`error: the workbook has no script ${STORAGE_SCRIPTS_FOLDER}/${name}\n`);
        return EXIT_USAGE;
    }
    const others = entries.filter((_, index) => index !== listed);
    let at: number;
    switch (parsed.target.kind) {
        case 'first':
            at = 0;
            break;
        case 'last':
            at = others.length;
            break;
        default: {
            const anchor = scriptFileName(parsed.target.script);
            const index = others.findIndex(entry => entry.name === anchor);
            if (index < 0) {
                cli.stderr(anchor === name
                    ? `error: ${name} can't go ${parsed.target.kind} itself\n`
                    : `error: ${STORAGE_WORKBOOK_FILE} lists no script ${anchor}, its scripts are ${others.map(entry => entry.name).join(', ') || 'none'}\n`);
                return EXIT_USAGE;
            }
            at = parsed.target.kind === 'before' ? index : index + 1;
        }
    }
    // A script that the list doesn't name yet runs on the connection of its neighbor, like in the tab
    const neighbor = others[at - 1] ?? others[at];
    const entry: ScriptEntry = listed >= 0
        ? entries[listed]
        : { name, ...(neighbor?.connectionId != null ? { connectionId: neighbor.connectionId } : {}) };
    const scripts = [...others.slice(0, at), entry, ...others.slice(at)];
    try {
        writeFileSync(file, `${JSON.stringify({ ...workbook, scripts }, null, 2)}\n`);
    } catch (error) {
        cli.stderr(`error: cannot write ${STORAGE_WORKBOOK_FILE}: ${String(error)}\n`);
        return EXIT_FAILED;
    }
    cli.stdout(`${scripts.map(script => script.name).join('\n')}\n`);
    return EXIT_OK;
}

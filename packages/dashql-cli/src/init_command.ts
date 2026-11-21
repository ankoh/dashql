// `dashql init`: set up a folder as a workspace of DashQL. With `dashql connect` the only command that sets one up, the
// others take a workspace that is set up and fail on another folder.
import path from 'node:path';

import { DASHQL_FOLDER } from '@akohn/dashql/platform/session/session_folder';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { initWorkspace, isWorkspace } from './session_folder.js';

export const INIT_USAGE = `Usage: dashql init [<dir>]

Sets up a folder as a workspace of DashQL, this one by default: its .dashql/, which ignores itself. catalog, describe,
run and vis take the workspace that you work in with --workspace and fail on a folder that is no workspace. dashql
connect sets up the folder of its session itself.`;

/// Run `init` with the arguments after it, returns the exit code
export function runInit(args: string[], cli: CliProcess): number {
    if (args.includes('-h') || args.includes('--help')) {
        cli.stdout(`${INIT_USAGE}\n`);
        return EXIT_OK;
    }
    const unexpected = args.find(arg => arg.startsWith('-')) ?? args[1];
    if (unexpected != null) {
        cli.stderr(`error: unexpected argument ${unexpected}\n\n${INIT_USAGE}\n`);
        return EXIT_USAGE;
    }
    const folder = path.resolve(cli.cwd, args[0] ?? '.');
    const shown = path.join(args[0] ?? '.', DASHQL_FOLDER);
    if (isWorkspace(folder)) {
        cli.stdout(`${shown}/ is already set up\n`);
        return EXIT_OK;
    }
    try {
        initWorkspace(folder);
    } catch (error) {
        cli.stderr(`error: cannot set up ${shown}/: ${String(error)}\n`);
        return EXIT_FAILED;
    }
    cli.stdout(`Set up the workspace ${shown}/\n`);
    return EXIT_OK;
}

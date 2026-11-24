// `dashql init`: set up a folder as a workspace of DashQL, `.dashql/` by default. With `dashql connect` the only
// command that sets one up, the others take a workspace that is set up and fail on another folder.
import path from 'node:path';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { canInitWorkspace, DEFAULT_WORKSPACE, initWorkspace, isWorkspace } from './session_folder.js';

export const INIT_USAGE = `Usage: dashql init [<dir>]

Sets up a folder as a workspace of DashQL, the folder of its files with its dashql-workspace.json, which ignores
itself: .dashql/ of this folder by default, else a new or empty folder. describe, run and vis take the workspace with
--workspace, .dashql/ by default, and fail on a folder that is no workspace. dashql connect sets up the .dashql/ of its
folder itself.`;

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
    const shown = path.normalize(args[0] ?? DEFAULT_WORKSPACE);
    const folder = path.resolve(cli.cwd, shown);
    if (isWorkspace(folder)) {
        cli.stdout(`${shown}/ is already set up\n`);
        return EXIT_OK;
    }
    if (!canInitWorkspace(folder)) {
        cli.stderr(`error: ${shown}/ has files and is no workspace, a workspace is a new or empty folder\n`);
        return EXIT_USAGE;
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

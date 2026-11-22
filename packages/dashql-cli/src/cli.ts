// The commands of dashql, see README.md
import { EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { runConnect } from './connect_command.js';
import { runCatalog } from './catalog_command.js';
import { runDescribe } from './describe_command.js';
import { runFormat } from './format_command.js';
import { runInit } from './init_command.js';
import { runLint } from './lint_command.js';
import { runMove } from './move_command.js';
import { runRun } from './run_command.js';
import { runSession } from './session_command.js';
import { runVis } from './vis_command.js';

export const USAGE = `Usage: dashql <command> [options]

Commands:
  connect --launch <claude|codex> --port <port> --secret <secret>
                                      Launch Claude Code or Codex and show its session live in DashQL, see dashql connect --help
  catalog <workbook-dir> [<connection>...]
                                      The tables of the connections of a workbook as CREATE TABLE statements
  describe [-w <dir>]                 How an agent works on the workbooks of DashQL, and the workbooks of the session
  format <file.sql|dir|->...          Pretty print SQL files on disk with dashql-core, see dashql format --help
  init [<dir>]                        Set up a folder as a workspace of DashQL
  lint <file.sql|dir|->...            Lint SQL files on disk with dashql-core, see dashql lint --help
  move <workbook-dir> <script> --after <script>
                                      Move a script in the feed, see dashql move --help
  run [-w <dir>] <workbook-dir> [<script>...]
                                      Run the scripts of a workbook folder on their connections, see dashql run --help
  session hook <event>                The hooks that dashql connect gives the harness, see dashql session --help
  vis [-w <dir>] <workbook-dir> <script>
                                      Check the chart of a script with its result and render it as PNG, see dashql vis --help

--workspace (-w) is the folder of the files of DashQL, .dashql/ of the invoking directory by default, a workspace that
dashql init or dashql connect set up: while a session of dashql connect runs there, run and vis run only the copies
of the workbooks of its tab, in the tab. A copy, workbooks/<workbook id> of a workspace, takes the workspace that
holds it.`;

/// Run dashql with its arguments, returns the exit code
export async function runDashQL(argv: string[], process: CliProcess): Promise<number> {
    const [command, ...args] = argv;
    switch (command) {
        case 'lint':
            return await runLint(args, process);
        case 'move':
            return runMove(args, process);
        case 'format':
            return await runFormat(args, process);
        case 'init':
            return runInit(args, process);
        case 'run':
            return await runRun(args, process);
        case 'session':
            return await runSession(args, process);
        case 'connect':
            return await runConnect(args, process);
        case 'describe':
            return runDescribe(args, process);
        case 'catalog':
            return runCatalog(args, process);
        case 'vis':
            return await runVis(args, process);
        case '-h':
        case '--help':
            process.stdout(`${USAGE}\n`);
            return EXIT_OK;
        case undefined:
            process.stderr(`${USAGE}\n`);
            return EXIT_USAGE;
        default:
            process.stderr(`error: unknown command ${command}\n\n${USAGE}\n`);
            return EXIT_USAGE;
    }
}

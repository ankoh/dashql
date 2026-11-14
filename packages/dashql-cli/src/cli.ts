// The commands of dashql, see README.md
import { EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { runFormat } from './format_command.js';
import { runLint } from './lint_command.js';
import { runRun } from './run_command.js';
import { runSession } from './session_command.js';

export const USAGE = `Usage: dashql <command> [options]

Commands:
  format <file.sql|dir|->...          Pretty print SQL files on disk with dashql-core, see dashql format --help
  lint <file.sql|dir|->...            Lint SQL files on disk with dashql-core, see dashql lint --help
  run <workbook-dir> [<script>...]    Run the scripts of a workbook folder on their connections, see dashql run --help
  session <command>                   Show the session of an agent harness in DashQL, see dashql session --help`;

/// Run dashql with its arguments, returns the exit code
export async function runDashQL(argv: string[], process: CliProcess): Promise<number> {
    const [command, ...args] = argv;
    switch (command) {
        case 'lint':
            return await runLint(args, process);
        case 'format':
            return await runFormat(args, process);
        case 'run':
            return await runRun(args, process);
        case 'session':
            return await runSession(args, process);
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

// dashql, the command line tool of DashQL on @akohn/dashql: `lint` and `format` check and pretty print SQL files
// on disk with the core of DashQL, `run` runs the scripts of a workbook folder. See README.md.
import { createDashQLCoreSetup } from '@akohn/dashql/platform/node/node_core';

import { runDashQL } from './cli.js';
import { EXIT_INTERRUPTED, readProcessStdin, stdoutStyle } from './cli_process.js';
import { workingDirectory } from './inputs.js';
import { ANSI, stdoutTerminal } from './term.js';

const argv = process.argv.slice(2);
// The commands that stop and clean up when the user interrupts them, e.g. cancel their queries. The first interrupt
// asks them to, the second one ends the process. The other commands end on the first one.
const INTERRUPTIBLE = new Set(['run', 'vis']);
const interrupt = new AbortController();
if (INTERRUPTIBLE.has(argv[0])) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
        process.on(signal, () => {
            if (interrupt.signal.aborted) process.exit(EXIT_INTERRUPTED);
            interrupt.abort();
        });
    }
}

// The live view of a command hides the cursor while it draws, it comes back however the process ends
const terminal = stdoutTerminal();
if (terminal != null) process.on('exit', () => { process.stdout.write(ANSI.showCursor); });

const setupCore = createDashQLCoreSetup();
process.exitCode = await runDashQL(argv, {
    cwd: workingDirectory(),
    readStdin: readProcessStdin,
    stdout: text => { process.stdout.write(text); },
    stderr: text => { process.stderr.write(text); },
    style: stdoutStyle(),
    setupCore: () => setupCore('dashql'),
    interrupt: interrupt.signal,
    terminal,
});

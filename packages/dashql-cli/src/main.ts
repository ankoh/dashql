// dashql, the command line tool of DashQL on @ankoh/dashql-runtime: `lint` and `format` check and pretty print SQL files
// on disk with the core of DashQL, `run` runs the scripts of a workbook folder. See README.md.
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';

import { createDashQLCoreSetup } from '@ankoh/dashql-runtime/node/node_core';

import { runDashQL } from './cli.js';
import { readProcessStdin, stdoutStyle } from './cli_process.js';
import { workingDirectory } from './inputs.js';

/// The descriptor that a command writes its output to when it runs without stdout, see below
const OUTPUT_FD_VARIABLE = 'DASHQL_OUTPUT_FD';
/// The commands that start the embedded Hyper
const HYPER_COMMANDS = new Set(['run']);

const argv = process.argv.slice(2);
const outputFd = process.env[OUTPUT_FD_VARIABLE] == null ? null : Number(process.env[OUTPUT_FD_VARIABLE]);

if (outputFd == null && HYPER_COMMANDS.has(argv[0])) {
    // Stdout is the output of the command, an agent reads it. The worker of the embedded Hyper writes a LogFile line
    // to the descriptor 1 of the process on every start, no code in the process can filter it. So the command runs
    // again in a child whose descriptor 1 goes nowhere, it writes its output to descriptor 3, which goes to stdout.
    const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...argv], {
        stdio: ['inherit', 'ignore', 'inherit', 'pipe'],
        env: { ...process.env, [OUTPUT_FD_VARIABLE]: '3' },
    });
    child.stdio[3]!.pipe(process.stdout);
    const forward = (signal: NodeJS.Signals) => () => { child.kill(signal); };
    process.on('SIGINT', forward('SIGINT'));
    process.on('SIGTERM', forward('SIGTERM'));
    process.exitCode = await new Promise<number>(resolve => child.on('close', (code, signal) => resolve(code ?? (signal != null ? 1 : 0))));
} else {
    const setupCore = createDashQLCoreSetup();
    process.exitCode = await runDashQL(argv, {
        cwd: workingDirectory(),
        readStdin: readProcessStdin,
        stdout: outputFd == null ? text => { process.stdout.write(text); } : text => { writeSync(outputFd, text); },
        stderr: text => { process.stderr.write(text); },
        style: stdoutStyle(),
        setupCore: () => setupCore('dashql'),
    });
}

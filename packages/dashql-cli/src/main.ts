// dashql, the command line tool of DashQL on @ankoh/dashql-sdk: `lint` and `format` check and pretty print SQL files
// on disk with the core of DashQL. See README.md.
import { createDashQLCoreSetup } from '@ankoh/dashql-sdk/node/node_core';

import { runDashQL } from './cli.js';
import { readProcessStdin, stdoutStyle } from './cli_process.js';
import { workingDirectory } from './inputs.js';

const setupCore = createDashQLCoreSetup();
process.exitCode = await runDashQL(process.argv.slice(2), {
    cwd: workingDirectory(),
    readStdin: readProcessStdin,
    stdout: text => { process.stdout.write(text); },
    stderr: text => { process.stderr.write(text); },
    style: stdoutStyle(),
    setupCore: () => setupCore('dashql'),
});

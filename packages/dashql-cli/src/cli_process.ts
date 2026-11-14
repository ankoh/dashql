import type * as core from '@ankoh/dashql-core';

import { ReportStyle } from '@ankoh/dashql-runtime/sql/sql_report';

/// What a command takes from the process, the tests pass their own
export interface CliProcess {
    /// The directory the user invoked the command from
    cwd: string;
    /// Read all of stdin
    readStdin: () => Promise<Uint8Array>;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    /// The style of the diagnostics
    style: ReportStyle;
    /// The core, instantiated once
    setupCore: () => Promise<core.DashQL>;
    /// Aborted when the user interrupts the command, e.g. with Ctrl-C
    interrupt?: AbortSignal;
}

/// The exit codes of the commands
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
/// The exit code of a command that the user interrupted, like a shell reports SIGINT
export const EXIT_INTERRUPTED = 130;

/// Colors when stdout is a terminal. `FORCE_COLOR` (other than `0`) forces them, `NO_COLOR` turns them off.
export function stdoutStyle(): ReportStyle {
    const force = process.env.FORCE_COLOR;
    if (force != null && force.length > 0) return new ReportStyle(force !== '0');
    const noColor = process.env.NO_COLOR;
    return new ReportStyle(!(noColor != null && noColor.length > 0) && process.stdout.isTTY === true);
}

/// Read all of stdin of the process
export async function readProcessStdin(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
    return new Uint8Array(Buffer.concat(chunks));
}

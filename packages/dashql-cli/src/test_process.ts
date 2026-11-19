import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDashQLCoreSetup } from '@akohn/dashql/platform/node/node_core';
import { ReportStyle } from './sql_report.js';

import type { CliProcess } from './cli_process.js';

const setupCore = createDashQLCoreSetup();

/// The output of a command run
export interface TestOutput {
    code: number;
    stdout: string;
    stderr: string;
}

/// A directory with files, a file without text holds its own name
export function testFiles(files: Array<string | [string, string | Uint8Array]>): string {
    const root = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-cli-'));
    for (const file of files) {
        const [name, text] = typeof file === 'string' ? [file, file] : file;
        const target = path.join(root, name);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, text);
    }
    return root;
}

/// Run a command with the process of a test, without colors
export async function runWith(
    run: (args: string[], process: CliProcess) => Promise<number>,
    cwd: string,
    args: string[],
    stdin: string | (() => Promise<Uint8Array>) = '',
): Promise<TestOutput> {
    let stdout = '';
    let stderr = '';
    const code = await run(args, {
        cwd,
        readStdin: typeof stdin === 'string' ? () => Promise.resolve(new TextEncoder().encode(stdin)) : stdin,
        stdout: text => { stdout += text; },
        stderr: text => { stderr += text; },
        style: new ReportStyle(false),
        setupCore: () => setupCore('test'),
    });
    return { code, stdout, stderr };
}

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as core from '@akohn/dashql';

import { formatSqlScript } from './sql_format.js';

import { readInputs, STDIN, STDIN_ID } from './inputs.js';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';

export const FORMAT_USAGE = `Usage:
  dashql format [options] <file.sql|dir|->...
      Pretty prints the scripts with dashql-core, to stdout by default.
      --write                  Rewrite the files in place
      --check                  Print the files that are not formatted, change nothing
      --dialect <name>         The dialect of the scripts: hyper (default) or trino

Directories are searched recursively for *.sql files, - reads a script from stdin.
A script with errors, or with a statement the formatter doesn't know, is reported and stays as it is.
Exits with 0 if all scripts could be formatted (with --check: are formatted), 1 otherwise and 2 on usage or I/O errors.`;

/// What happens to the formatted scripts
export type FormatOutput = 'print' | 'write' | 'check';

/// The arguments of `format`
export interface FormatArgs {
    /// The files, directories or `-` to format
    paths: string[];
    output: FormatOutput;
    dialect: core.buffers.formatting.FormattingDialect;
    /// Print the usage
    help: boolean;
}

function parseDialect(name: string): core.buffers.formatting.FormattingDialect {
    switch (name) {
        case 'hyper': return core.buffers.formatting.FormattingDialect.HYPER;
        case 'trino': return core.buffers.formatting.FormattingDialect.TRINO;
        default: throw `unknown dialect ${name}`;
    }
}

/// Parse the arguments after `format`, throws the message of an error
export function parseFormatArgs(args: string[]): FormatArgs {
    const out: FormatArgs = { paths: [], output: 'print', dialect: core.buffers.formatting.FormattingDialect.HYPER, help: false };
    let output: FormatOutput | null = null;
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        let selected: FormatOutput;
        if (arg === '--write') {
            selected = 'write';
        } else if (arg === '--check') {
            selected = 'check';
        } else {
            if (arg === '-h' || arg === '--help') {
                out.help = true;
            } else if (arg === '--dialect') {
                if (i + 1 >= args.length) throw 'option --dialect needs a name';
                out.dialect = parseDialect(args[++i]);
            } else if (arg.startsWith('--dialect=')) {
                out.dialect = parseDialect(arg.slice('--dialect='.length));
            } else if (arg === '--') {
                out.paths.push(...args.slice(i + 1));
                break;
            } else if (arg.startsWith('-') && arg !== STDIN) {
                throw `unknown option ${arg}`;
            } else {
                out.paths.push(arg);
            }
            continue;
        }
        if (output != null && output !== selected) throw 'options --write and --check exclude each other';
        output = selected;
    }
    out.output = output ?? 'print';
    return out;
}

async function format(args: FormatArgs, process: CliProcess): Promise<number> {
    const inputs = await readInputs(args.paths, process.cwd, process.readStdin);
    const dql = await process.setupCore();
    let failed = 0;
    let changed = 0;
    for (const input of inputs) {
        const result = formatSqlScript(dql, input.text, args.dialect);
        if ('error' in result) {
            failed += 1;
            process.stderr(`${input.id}: ${result.error}\n`);
            continue;
        }
        if (args.output === 'print') {
            process.stdout(result.formatted);
            continue;
        }
        if (result.formatted === input.text) continue;
        // Stdin has no file to write to
        if (args.output === 'write' && input.id !== STDIN_ID) {
            const file = path.resolve(process.cwd, input.id);
            try {
                await writeFile(file, result.formatted);
            } catch (error) {
                throw `${file}: ${(error as { code?: string }).code ?? String(error)}`;
            }
        }
        changed += 1;
        process.stdout(`${input.id}\n`);
    }
    const files = inputs.length === 1 ? 'file' : 'files';
    if (args.output === 'write') process.stdout(`${inputs.length} ${files}, ${changed} rewritten, ${failed} failed\n`);
    if (args.output === 'check') process.stdout(`${inputs.length} ${files}, ${changed} not formatted, ${failed} failed\n`);
    const unformatted = args.output === 'check' && changed > 0;
    return failed > 0 || unformatted ? EXIT_FAILED : EXIT_OK;
}

/// Run `format` with the arguments after it, returns the exit code
export async function runFormat(argv: string[], process: CliProcess): Promise<number> {
    let args: FormatArgs;
    try {
        args = parseFormatArgs(argv);
    } catch (error) {
        process.stderr(`error: ${String(error)}\n\n${FORMAT_USAGE}\n`);
        return EXIT_USAGE;
    }
    if (args.help) {
        process.stdout(`${FORMAT_USAGE}\n`);
        return EXIT_OK;
    }
    if (args.paths.length === 0) {
        process.stderr(`${FORMAT_USAGE}\n`);
        return EXIT_USAGE;
    }
    if (args.output === 'write' && args.paths.includes(STDIN)) {
        process.stderr(`error: --write needs files, not stdin\n\n${FORMAT_USAGE}\n`);
        return EXIT_USAGE;
    }
    try {
        return await format(args, process);
    } catch (error) {
        process.stderr(`error: ${typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_USAGE;
    }
}

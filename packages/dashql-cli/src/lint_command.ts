import { SqlLinter } from '@ankoh/dashql/platform/sql/sql_lint';
import { formatReportFile, formatReportSummary, formatReportTimings } from '@ankoh/dashql/platform/sql/sql_report';

import { readInputs, STDIN } from './inputs.js';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';

export const LINT_USAGE = `Usage:
  dashql lint [options] <file.sql|dir|->...
      Scans, parses and analyzes the scripts with dashql-core and prints the scripts with diagnostics.
      --schema <file.sql>      Schema script (CREATE TABLE ...) to resolve names against, can be repeated
      --debug                  Show where the time goes

Directories are searched recursively for *.sql files, - reads a script from stdin.
Exits with 0 without errors (warnings are fine), 1 with errors and 2 on usage or I/O errors.`;

/// The arguments of `lint`
export interface LintArgs {
    /// The schema scripts of `--schema`
    schemas: string[];
    /// The files, directories or `-` to lint
    paths: string[];
    /// Print timings
    debug: boolean;
    /// Print the usage
    help: boolean;
}

/// Parse the arguments after `lint`, throws the message of an error
export function parseLintArgs(args: string[]): LintArgs {
    const out: LintArgs = { schemas: [], paths: [], debug: false, help: false };
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        if (arg === '--schema') {
            if (i + 1 >= args.length) throw 'option --schema needs a file';
            out.schemas.push(args[++i]);
        } else if (arg === '--debug') {
            out.debug = true;
        } else if (arg === '-h' || arg === '--help') {
            out.help = true;
        } else if (arg === '--') {
            out.paths.push(...args.slice(i + 1));
            break;
        } else if (arg.startsWith('--schema=')) {
            out.schemas.push(arg.slice('--schema='.length));
        } else if (arg.startsWith('-') && arg !== STDIN) {
            throw `unknown option ${arg}`;
        } else {
            out.paths.push(arg);
        }
    }
    return out;
}

async function lint(args: LintArgs, process: CliProcess): Promise<number> {
    const { style } = process;
    const schemas = await readInputs(args.schemas, process.cwd, process.readStdin);
    const inputs = await readInputs(args.paths, process.cwd, process.readStdin);
    const start = performance.now();
    const linter = new SqlLinter(await process.setupCore());
    // Schemas come first, so that the scripts find their tables
    const diagnostics = [
        ...schemas.map(schema => linter.addSchema(schema)),
        ...inputs.map(input => linter.lint(input)),
    ];
    let errors = 0;
    let warnings = 0;
    [...schemas, ...inputs].forEach((input, i) => {
        if (diagnostics[i].length === 0) return;
        for (const diagnostic of diagnostics[i]) {
            if (diagnostic.severity === 'error') errors += 1;
            else warnings += 1;
        }
        process.stdout(`${formatReportFile(input.id, input.text, diagnostics[i], style)}\n\n`);
    });
    if (args.debug) process.stdout(`${formatReportTimings(performance.now() - start, style)}\n\n`);
    process.stdout(`${formatReportSummary(schemas.length + inputs.length, errors, warnings, style)}\n`);
    // Warnings alone do not fail
    return errors > 0 ? EXIT_FAILED : EXIT_OK;
}

/// Run `lint` with the arguments after it, returns the exit code
export async function runLint(argv: string[], process: CliProcess): Promise<number> {
    let args: LintArgs;
    try {
        args = parseLintArgs(argv);
    } catch (error) {
        process.stderr(`error: ${String(error)}\n\n${LINT_USAGE}\n`);
        return EXIT_USAGE;
    }
    if (args.help) {
        process.stdout(`${LINT_USAGE}\n`);
        return EXIT_OK;
    }
    if (args.paths.length === 0) {
        process.stderr(`${LINT_USAGE}\n`);
        return EXIT_USAGE;
    }
    try {
        return await lint(args, process);
    } catch (error) {
        process.stderr(`error: ${typeof error === 'string' ? error : error instanceof Error ? error.message : String(error)}\n`);
        return EXIT_USAGE;
    }
}

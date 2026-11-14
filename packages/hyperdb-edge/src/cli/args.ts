import { parseArgs } from 'node:util';

import type { HyperDBSettingValue } from 'hyperdb-wasm';

import type { OutputFormat } from '../format.js';

export const USAGE = `Usage:
  hyperdb-edge run [--db FILE] [OPTIONS] (-c SQL | -f FILE | -)
  hyperdb-edge describe [TOPIC]
  hyperdb-edge --help | --version

Commands:
  run                  run SQL statements on the embedded Hyper of hyperdb-wasm, in order, until one fails
  describe [TOPIC]     how to work with hyperdb-edge and the topics of Hyper SQL; 'all' prints every topic

Options of run:
  --db FILE            a .hyper file, created when missing and locked while open; without it no database is open
  -c, --command SQL    run the statements of SQL
  -f, --file FILE      run the statements of a file, - reads stdin
  -                    run the statements of stdin
  --format F           table (default), json or csv
  --max-rows N         the rows to print per statement, 20 by default, 0 prints all
  --setting K=V        an engine setting, repeatable

Exit codes: 0 ok, 1 a statement failed, 2 usage, an unsupported runtime or a database in use
`;

/// Wrong arguments, the command exits with 2
export class UsageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageError';
    }
}

export type SqlSource = { kind: 'command'; sql: string } | { kind: 'file'; path: string } | { kind: 'stdin' };

export interface RunArguments {
    readonly command: 'run';
    readonly database: string | null;
    readonly format: OutputFormat;
    readonly maxRows: number;
    readonly settings: Record<string, HyperDBSettingValue>;
    readonly source: SqlSource;
}

export type Arguments =
    | { readonly command: 'help' }
    | { readonly command: 'version' }
    | { readonly command: 'describe'; readonly topic: string | null }
    | RunArguments;

const FORMATS: readonly OutputFormat[] = ['table', 'json', 'csv'];

/// The value of an engine setting: a boolean, a whole number, or else a text
export function parseSettingValue(text: string): HyperDBSettingValue {
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (/^-?\d+$/.test(text)) return Number(text);
    return text;
}

/// Run a parse of node:util, its errors are usage errors
function usage<T>(parse: () => T): T {
    try {
        return parse();
    } catch (e) {
        throw new UsageError((e as Error).message);
    }
}

const RUN_OPTIONS = {
    db: { type: 'string' },
    command: { type: 'string', short: 'c' },
    file: { type: 'string', short: 'f' },
    format: { type: 'string' },
    'max-rows': { type: 'string' },
    setting: { type: 'string', multiple: true },
} as const;

export function parseArguments(argv: string[]): Arguments {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { command: 'help' };
    if (argv[0] === '--version') {
        if (argv.length > 1) throw new UsageError(`--version takes no arguments`);
        return { command: 'version' };
    }
    const [command, ...rest] = argv;
    switch (command) {
        case 'describe': {
            const { positionals } = usage(() => parseArgs({ args: rest, options: {}, allowPositionals: true, strict: true }));
            if (positionals.length > 1) throw new UsageError('describe takes one topic');
            return { command: 'describe', topic: positionals[0] ?? null };
        }
        case 'run':
            return parseRun(rest);
        default:
            throw new UsageError(`unknown command '${command}'`);
    }
}

function parseRun(args: string[]): RunArguments {
    const { values, positionals } = usage(() => parseArgs({ args, options: RUN_OPTIONS, allowPositionals: true, strict: true }));

    const stdinDash = positionals.filter(p => p === '-');
    const extra = positionals.filter(p => p !== '-');
    if (extra.length > 0) throw new UsageError(`run takes no argument '${extra[0]}', pass SQL with -c`);
    const sources: SqlSource[] = [];
    if (values.command !== undefined) sources.push({ kind: 'command', sql: values.command });
    if (values.file !== undefined) {
        sources.push(values.file === '-' ? { kind: 'stdin' } : { kind: 'file', path: values.file });
    }
    for (let i = 0; i < stdinDash.length; ++i) sources.push({ kind: 'stdin' });
    if (sources.length === 0) throw new UsageError('run needs SQL: pass it with -c, -f or -');
    if (sources.length > 1) throw new UsageError('run takes only one of -c, -f and -');

    const format = values.format ?? 'table';
    if (!FORMATS.includes(format as OutputFormat)) {
        throw new UsageError(`--format is table, json or csv, not '${format}'`);
    }

    let maxRows = 20;
    if (values['max-rows'] !== undefined) {
        const text = values['max-rows'];
        if (!/^\d+$/.test(text)) throw new UsageError(`--max-rows takes a whole number of 0 or more, not '${text}'`);
        maxRows = Number(text);
    }

    const settings: Record<string, HyperDBSettingValue> = {};
    for (const setting of values.setting ?? []) {
        const equals = setting.indexOf('=');
        if (equals <= 0) throw new UsageError(`--setting takes NAME=VALUE, not '${setting}'`);
        settings[setting.slice(0, equals)] = parseSettingValue(setting.slice(equals + 1));
    }

    return {
        command: 'run',
        database: values.db ?? null,
        format: format as OutputFormat,
        maxRows,
        settings,
        source: sources[0],
    };
}

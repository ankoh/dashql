#!/usr/bin/env node
// hyperdb-edge: runs SQL on the embedded Hyper of hyperdb-wasm. Builds on hyperdb-wasm, not part of it.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DatabaseInUseError } from '../node/database_lock.js';
import { readDescribe, UnknownTopicError } from '../node/describe.js';
import { DatabaseFolderMissingError } from '../node/open_engine.js';
import { checkWasmFeatures, WASM_FEATURE_MODULES } from '../node/runtime_check.js';
import { EdgeSession, EngineOpenError } from '../node/session.js';
import { splitStatements } from '../statements.js';
import { parseArguments, USAGE, UsageError, type RunArguments } from './args.js';

function write(stream: NodeJS.WriteStream, text: string) {
    stream.write(text);
}

function fail(text: string, code: number): number {
    write(process.stderr, `hyperdb-edge: ${text}\n`);
    return code;
}

function packageVersion(packageJson: URL): string {
    return JSON.parse(readFileSync(packageJson, 'utf8')).version;
}

function version(): number {
    write(process.stdout, `hyperdb-edge ${packageVersion(new URL('../../package.json', import.meta.url))}\n`);
    write(process.stdout, `hyperdb-wasm ${packageVersion(new URL('../package.json', import.meta.resolve('hyperdb-wasm')))}\n`);
    try {
        checkWasmFeatures();
    } catch (e) {
        return fail((e as Error).message, 2);
    }
    const features = Object.keys(WASM_FEATURE_MODULES).join(', ');
    write(process.stdout, `${process.execPath} (Node ${process.version}): WebAssembly ${features}\n`);
    return 0;
}

async function readStdin(): Promise<string> {
    let text = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) text += chunk;
    return text;
}

/// `run` is a session with one call
async function run(args: RunArguments): Promise<number> {
    const workDirectory = process.cwd();
    let sql: string;
    switch (args.source.kind) {
        case 'command':
            sql = args.source.sql;
            break;
        case 'file':
            try {
                sql = readFileSync(path.resolve(workDirectory, args.source.path), 'utf8');
            } catch (e) {
                return fail(`cannot read ${args.source.path}: ${(e as Error).message}`, 2);
            }
            break;
        case 'stdin':
            sql = await readStdin();
            break;
    }
    // Checked before the engine starts
    if (splitStatements(sql).length === 0) return fail('the SQL has no statement', 2);

    let session: EdgeSession;
    try {
        session = await EdgeSession.open({
            database: args.database,
            workDirectory,
            settings: args.settings,
            format: args.format,
            maxRows: args.maxRows,
        });
    } catch (e) {
        if (e instanceof DatabaseInUseError || e instanceof DatabaseFolderMissingError) return fail(e.message, 2);
        if (e instanceof EngineOpenError) return fail(e.message, e.usage ? 2 : 1);
        return fail((e as Error).message, 1);
    }

    const cancel = new AbortController();
    const onSignal = () => cancel.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    try {
        const result = await session.run(sql, {
            signal: cancel.signal,
            onOutput: (stream, text) => write(stream === 'stdout' ? process.stdout : process.stderr, text),
        });
        return result.failed != null || result.cancelled ? 1 : 0;
    } catch (e) {
        return fail((e as Error).message, 1);
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
        await session.close();
    }
}

async function main(argv: string[]): Promise<number> {
    let args;
    try {
        args = parseArguments(argv);
    } catch (e) {
        if (e instanceof UsageError) {
            write(process.stderr, `hyperdb-edge: ${e.message}\nRun hyperdb-edge --help for the usage.\n`);
            return 2;
        }
        throw e;
    }
    switch (args.command) {
        case 'help':
            write(process.stdout, USAGE);
            return 0;
        case 'version':
            return version();
        case 'describe':
            try {
                write(process.stdout, readDescribe(args.topic));
                return 0;
            } catch (e) {
                if (e instanceof UnknownTopicError) return fail(e.message, 2);
                throw e;
            }
        case 'run':
            return run(args);
    }
}

process.exitCode = await main(process.argv.slice(2));

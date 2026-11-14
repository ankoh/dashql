#!/usr/bin/env node
// hyperdb-edge: runs SQL on the embedded Hyper of hyperdb-wasm. Builds on hyperdb-wasm, not part of it.

import { fork } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { acquireDatabaseLock, DatabaseInUseError } from '../node/database_lock.js';
import { checkWasmFeatures, WASM_FEATURE_MODULES } from '../node/runtime_check.js';
import { splitStatements } from '../statements.js';
import { parseArguments, USAGE, UsageError, type RunArguments } from './args.js';
import { readDescribe, UnknownTopicError } from './describe.js';
import type { EngineMessage, EngineRequest } from './protocol.js';

const ENGINE_PROCESS = fileURLToPath(new URL('./engine_process.js', import.meta.url));

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

function isDirectory(folder: string): boolean {
    try {
        return statSync(folder).isDirectory();
    } catch {
        return false;
    }
}

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
    const statements = splitStatements(sql);
    if (statements.length === 0) return fail('the SQL has no statement', 2);

    let database: string | null = null;
    let release = () => {};
    if (args.database != null) {
        database = path.resolve(workDirectory, args.database);
        if (!isDirectory(path.dirname(database))) {
            return fail(`the folder ${path.dirname(database)} of the database does not exist`, 2);
        }
        try {
            release = acquireDatabaseLock(database);
        } catch (e) {
            if (e instanceof DatabaseInUseError) return fail(e.message, 2);
            throw e;
        }
    }

    try {
        return await runEngine({
            type: 'run',
            database,
            workDirectory,
            settings: args.settings,
            statements,
            format: args.format,
            maxRows: args.maxRows,
        });
    } finally {
        release();
    }
}

/// A warning of Node that the worker of the engine causes when it closes its files, now and then. Harnesses show
/// stderr to the model, so it would read as a problem of the command.
const ENGINE_FD_WARNING = /^\(node:\d+\) Warning: File descriptor \d+ closed but not opened in unmanaged mode$/;
const TRACE_WARNINGS_HINT = /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/;

/// Pass on the stderr of the engine process without the warning above and the hint that Node prints after it
function forwardEngineStderr(stream: NodeJS.ReadableStream) {
    let pending = '';
    let droppedWarning = false;
    const forward = (line: string) => {
        if (ENGINE_FD_WARNING.test(line)) {
            droppedWarning = true;
            return;
        }
        if (droppedWarning && TRACE_WARNINGS_HINT.test(line)) {
            droppedWarning = false;
            return;
        }
        droppedWarning = false;
        write(process.stderr, `${line}\n`);
    };
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
        pending += chunk;
        const lines = pending.split('\n');
        pending = lines.pop()!;
        lines.forEach(forward);
    });
    stream.on('end', () => {
        if (pending.length > 0) forward(pending);
    });
}

/// Run the statements in the engine process and pass on its output
function runEngine(request: EngineRequest): Promise<number> {
    return new Promise(resolve => {
        const child = fork(ENGINE_PROCESS, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
        forwardEngineStderr(child.stderr!);
        let code: number | null = null;
        const forward = (signal: NodeJS.Signals) => child.kill(signal);
        process.on('SIGINT', forward);
        process.on('SIGTERM', forward);
        child.on('message', (message: EngineMessage) => {
            switch (message.type) {
                case 'stdout':
                    write(process.stdout, message.text);
                    break;
                case 'stderr':
                    write(process.stderr, message.text);
                    break;
                case 'done':
                    code = message.code;
                    break;
            }
        });
        // After the stderr of the child ended, so no line of it comes after the command returned
        child.on('close', (exitCode, signal) => {
            process.off('SIGINT', forward);
            process.off('SIGTERM', forward);
            if (code == null) {
                code = fail(`the engine process ended ${signal != null ? `with ${signal}` : `with code ${exitCode}`}`, 1);
            }
            resolve(code);
        });
        child.send(request);
    });
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

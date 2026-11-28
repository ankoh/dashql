import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { HyperDBSettingValue } from 'hyperdb-wasm';

import type { OutputFormat } from '../format.js';
import { splitStatements } from '../statements.js';
import { acquireDatabaseLock } from './database_lock.js';
import type { EngineMessage, EngineRequest, FailedStatement } from './engine_protocol.js';
import { resolveDatabaseFile } from './open_engine.js';

export interface EdgeSessionOptions {
    /// A .hyper file, created when missing and locked while the session is open; relative to the working folder
    readonly database?: string | null;
    /// The host folder that SQL reads and writes at /mnt/external/work
    readonly workDirectory: string;
    readonly settings?: Record<string, HyperDBSettingValue>;
    /// The format of the output, the table format by default
    readonly format?: OutputFormat;
    /// The rows to print per statement, 20 by default, 0 prints all
    readonly maxRows?: number;
    /// Where lines of the stderr of the engine go, the stderr of this process by default
    readonly engineStderr?: (line: string) => void;
    /// The compiled engine process, found next to this module or in dist/ of the package by default
    readonly engineEntry?: string;
}

export interface EdgeRunOptions {
    /// Cancels the running statement and skips the rest, or the call while it waits
    readonly signal?: AbortSignal;
    readonly maxRows?: number;
    /// Gets the output while the statements run, e.g. to print it
    readonly onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}

export interface EdgeRunResult {
    /// What `hyperdb-edge run` prints on stdout: the results of the statements that ran
    readonly stdout: string;
    /// What it prints on stderr: the error of the failed statement, notes on cut rows, a cancel
    readonly stderr: string;
    readonly failed: FailedStatement | null;
    readonly cancelled: boolean;
}

/// The SQL has no statement
export class NoStatementError extends Error {
    constructor() {
        super('the SQL has no statement');
        this.name = 'NoStatementError';
    }
}

/// The engine did not open
export class EngineOpenError extends Error {
    constructor(
        message: string,
        /// The error is the caller's: an engine setting or the runtime
        readonly usage: boolean,
    ) {
        super(message);
        this.name = 'EngineOpenError';
    }
}

/// The engine process ended before the session closed
export class EngineEndedError extends Error {
    constructor(detail: string) {
        super(`the engine process ended ${detail}`);
        this.name = 'EngineEndedError';
    }
}

/// The session is closed
export class SessionClosedError extends Error {
    constructor() {
        super('the session is closed');
        this.name = 'SessionClosedError';
    }
}

/// A warning of Node that the worker of the engine causes when it closes its files, now and then. Agents read stderr,
/// so it would read as a problem of the command.
const ENGINE_FD_WARNING = /^\(node:\d+\) Warning: File descriptor \d+ closed but not opened in unmanaged mode$/;
const TRACE_WARNINGS_HINT = /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/;

/// Pass on the lines of the stderr of the engine process without the warning above and the hint after it
function forwardEngineStderr(stream: NodeJS.ReadableStream, sink: (line: string) => void) {
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
        sink(line);
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

/// The engine process next to this module, or in dist/ when this module runs from the sources
function defaultEngineEntry(): string {
    const beside = fileURLToPath(new URL('./engine_process.js', import.meta.url));
    if (existsSync(beside)) return beside;
    return fileURLToPath(new URL('../../dist/node/engine_process.js', import.meta.url));
}

/// The sessions that are open, closed hard when the process exits
const OPEN_SESSIONS = new Set<EdgeSession>();
let exitHookInstalled = false;

function installExitHook() {
    if (exitHookInstalled) return;
    exitHookInstalled = true;
    process.on('exit', () => {
        for (const session of OPEN_SESSIONS) session.closeNow();
    });
}

interface PendingRun {
    readonly resolve: (result: EdgeRunResult) => void;
    readonly reject: (error: Error) => void;
    readonly onOutput?: EdgeRunOptions['onOutput'];
    stdout: string;
    stderr: string;
}

/// A session of the embedded Hyper: one engine for many calls, which run one after another.
/// The engine runs in a child process (src/node/engine_process.ts), which keeps its memory and a crash out of this
/// process. The session holds the lock of its database from open to close.
export class EdgeSession {
    private nextId = 1;
    private readonly pending = new Map<number, PendingRun>();
    /// The calls run one after another, in the order they came
    private queue: Promise<unknown> = Promise.resolve();
    private ended: Error | null = null;
    private closing: Promise<void> | null = null;
    private released = false;

    private constructor(
        private readonly child: ChildProcess,
        private readonly releaseLock: () => void,
        /// The name the database is attached under, or null without a database
        readonly databaseName: string | null,
        private readonly format: OutputFormat,
        private readonly maxRows: number,
    ) {}

    /// The rows a call prints per statement unless it says otherwise
    get defaultMaxRows(): number {
        return this.maxRows;
    }

    /// The id of the engine process, for tests
    get enginePid(): number | undefined {
        return this.child.pid;
    }

    static async open(options: EdgeSessionOptions): Promise<EdgeSession> {
        let database: string | null = null;
        let databaseName: string | null = null;
        let releaseLock = () => {};
        if (options.database != null) {
            const file = resolveDatabaseFile(options.workDirectory, options.database);
            database = file.path;
            databaseName = file.name;
            releaseLock = acquireDatabaseLock(database);
        }

        let child: ChildProcess;
        try {
            child = fork(options.engineEntry ?? defaultEngineEntry(), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [] });
        } catch (e) {
            releaseLock();
            throw e;
        }
        const engineStderr = options.engineStderr ?? (line => process.stderr.write(`${line}\n`));
        forwardEngineStderr(child.stderr!, engineStderr);

        const session = new EdgeSession(child, releaseLock, databaseName, options.format ?? 'table', options.maxRows ?? 20);
        const opened = new Promise<void>((resolve, reject) => {
            const onMessage = (message: EngineMessage) => {
                if (message.type === 'opened') {
                    child.off('exit', onExit);
                    resolve();
                } else if (message.type === 'open-failed') {
                    child.off('exit', onExit);
                    reject(new EngineOpenError(message.message, message.usage));
                }
            };
            const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
                reject(new EngineEndedError(signal != null ? `with ${signal}` : `with code ${code}`));
            child.once('exit', onExit);
            child.on('message', onMessage);
        });
        child.on('message', (message: EngineMessage) => session.onMessage(message));
        child.on('exit', (code, signal) => session.onExit(code, signal));
        child.send({ type: 'open', database, workDirectory: options.workDirectory, settings: options.settings ?? {} } satisfies EngineRequest);
        try {
            await opened;
        } catch (e) {
            await session.close();
            throw e;
        }
        OPEN_SESSIONS.add(session);
        installExitHook();
        return session;
    }

    private onMessage(message: EngineMessage) {
        switch (message.type) {
            case 'stdout':
            case 'stderr': {
                const run = this.pending.get(message.id);
                if (run == null) return;
                run[message.type] += message.text;
                run.onOutput?.(message.type, message.text);
                break;
            }
            case 'done': {
                const run = this.pending.get(message.id);
                if (run == null) return;
                this.pending.delete(message.id);
                run.resolve({ stdout: run.stdout, stderr: run.stderr, failed: message.failed, cancelled: message.cancelled });
                break;
            }
        }
    }

    private onExit(code: number | null, signal: NodeJS.Signals | null) {
        if (this.ended == null) this.ended = new EngineEndedError(signal != null ? `with ${signal}` : `with code ${code}`);
        for (const run of this.pending.values()) run.reject(this.ended);
        this.pending.clear();
        this.release();
    }

    private release() {
        if (this.released) return;
        this.released = true;
        OPEN_SESSIONS.delete(this);
        this.releaseLock();
    }

    /// Run the statements of a SQL text in order until one fails.
    /// Rejects with NoStatementError for SQL without statements, and when the session closed or its engine ended.
    run(sql: string, options: EdgeRunOptions = {}): Promise<EdgeRunResult> {
        const statements = splitStatements(sql);
        if (statements.length === 0) return Promise.reject(new NoStatementError());
        const result = this.queue.then(() => this.execute(statements, options));
        this.queue = result.catch(() => {});
        return result;
    }

    private execute(statements: ReturnType<typeof splitStatements>, options: EdgeRunOptions): Promise<EdgeRunResult> {
        if (this.closing != null) return Promise.reject(new SessionClosedError());
        if (this.ended != null) return Promise.reject(this.ended);
        if (options.signal?.aborted) {
            return Promise.resolve({ stdout: '', stderr: 'hyperdb-edge: cancelled\n', failed: null, cancelled: true });
        }
        const id = this.nextId++;
        return new Promise<EdgeRunResult>((resolve, reject) => {
            const cancel = () => this.child.send({ type: 'cancel', id } satisfies EngineRequest);
            options.signal?.addEventListener('abort', cancel, { once: true });
            const done = () => options.signal?.removeEventListener('abort', cancel);
            this.pending.set(id, {
                resolve: result => {
                    done();
                    resolve(result);
                },
                reject: error => {
                    done();
                    reject(error);
                },
                onOutput: options.onOutput,
                stdout: '',
                stderr: '',
            });
            this.child.send({
                type: 'run',
                id,
                statements,
                format: this.format,
                maxRows: options.maxRows ?? this.maxRows,
            } satisfies EngineRequest);
        });
    }

    /// Close the engine and release the database. A running call is cancelled, waiting calls fail.
    close(): Promise<void> {
        if (this.closing != null) return this.closing;
        this.closing = new Promise<void>(resolve => {
            const child = this.child;
            if (child.exitCode != null || child.signalCode != null) {
                this.release();
                resolve();
                return;
            }
            // An engine that doesn't close within 10 seconds is killed
            const kill = setTimeout(() => child.kill('SIGKILL'), 10_000);
            child.once('exit', () => {
                clearTimeout(kill);
                this.release();
                resolve();
            });
            for (const id of this.pending.keys()) child.send({ type: 'cancel', id } satisfies EngineRequest);
            child.send({ type: 'close' } satisfies EngineRequest, error => {
                if (error != null) child.kill('SIGKILL');
            });
        });
        return this.closing;
    }

    /// Kill the engine and release the database at once, when the process exits
    closeNow(): void {
        this.child.kill('SIGKILL');
        this.release();
    }
}

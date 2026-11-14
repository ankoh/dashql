// The process that runs the engine of a session (src/node/session.ts), also of `hyperdb-edge run`.
// The engine prints a LogFile line with fs.writeSync(1) from its worker on every start, which no code in the process
// can filter. So the session starts this process with its stdout going nowhere and talks to it over IPC. The process
// opens the engine once and runs one request at a time until the session closes or goes away.

import { HyperDBError } from 'hyperdb-wasm';

import { formatStatementResult } from '../format.js';
import { runStatement } from '../run_statement.js';
import type { EngineMessage, EngineRequest } from './engine_protocol.js';
import { DatabaseFolderMissingError, EngineSettingsError, openEngine, type OpenEngine } from './open_engine.js';
import { UnsupportedRuntimeError } from './runtime_check.js';

function send(message: EngineMessage): Promise<void> {
    return new Promise((resolve, reject) => process.send!(message, (error: Error | null) => (error ? reject(error) : resolve())));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/// The error of a statement with what Hyper tells about it
export function statementErrorText(error: unknown, statement: number, count: number, line: number): string {
    const lines = [`hyperdb-edge: statement ${statement} of ${count} (line ${line}) failed: ${errorMessage(error)}`];
    if (error instanceof HyperDBError) {
        if (error.sqlState) lines.push(`  SQLSTATE ${error.sqlState}`);
        if (error.detail) lines.push(`  DETAIL ${error.detail}`);
        if (error.hint) lines.push(`  HINT ${error.hint}`);
    }
    return `${lines.join('\n')}\n`;
}

let engine: OpenEngine | null = null;
/// The cancel of the request that runs
const running = new Map<number, AbortController>();
/// Requests run one after another in the order they came
let queue: Promise<void> = Promise.resolve();

async function open(request: Extract<EngineRequest, { type: 'open' }>): Promise<void> {
    try {
        engine = await openEngine({ database: request.database, workDirectory: request.workDirectory, settings: request.settings });
        await send({ type: 'opened' });
    } catch (e) {
        const usage = e instanceof UnsupportedRuntimeError || e instanceof EngineSettingsError || e instanceof DatabaseFolderMissingError;
        await send({ type: 'open-failed', message: errorMessage(e), usage });
        process.exit(0);
    }
}

async function run(request: Extract<EngineRequest, { type: 'run' }>): Promise<void> {
    const cancel = running.get(request.id)!;
    const count = request.statements.length;
    let failed: { statement: number; line: number; sqlState: string | null } | null = null;
    let printed = false;
    for (let i = 0; i < count && !cancel.signal.aborted; ++i) {
        const statement = request.statements[i];
        let output;
        try {
            const result = await runStatement(engine!.connection, statement.text, { signal: cancel.signal });
            output = formatStatementResult(result, i + 1, { format: request.format, maxRows: request.maxRows });
        } catch (e) {
            if (!cancel.signal.aborted) {
                await send({ type: 'stderr', id: request.id, text: statementErrorText(e, i + 1, count, statement.line) });
                failed = { statement: i + 1, line: statement.line, sqlState: e instanceof HyperDBError ? e.sqlState || null : null };
            }
            break;
        }
        if (output.stdout.length > 0) {
            // The results of a table or a csv are separated by an empty line, json has one line per statement
            const separator = printed && request.format !== 'json' ? '\n' : '';
            await send({ type: 'stdout', id: request.id, text: separator + output.stdout });
            printed = true;
        }
        if (output.stderr) await send({ type: 'stderr', id: request.id, text: output.stderr });
    }
    const cancelled = cancel.signal.aborted;
    if (cancelled) await send({ type: 'stderr', id: request.id, text: 'hyperdb-edge: cancelled\n' });
    running.delete(request.id);
    await send({ type: 'done', id: request.id, failed, cancelled });
}

async function close(): Promise<void> {
    for (const cancel of running.values()) cancel.abort();
    await queue.catch(() => {});
    await engine?.close().catch(() => {});
    engine = null;
    await send({ type: 'closed' }).catch(() => {});
    process.exit(0);
}

// The session went away without closing, e.g. its process was killed
process.on('disconnect', () => {
    void (async () => {
        for (const cancel of running.values()) cancel.abort();
        await engine?.close().catch(() => {});
        process.exit(0);
    })();
});

process.on('message', (request: EngineRequest) => {
    switch (request.type) {
        case 'open':
            queue = queue.then(() => open(request));
            break;
        case 'run':
            // Registered when the request arrives, so a cancel reaches a request that waits
            running.set(request.id, new AbortController());
            queue = queue.then(() => run(request)).catch(async e => {
                running.delete(request.id);
                await send({ type: 'stderr', id: request.id, text: `hyperdb-edge: ${errorMessage(e)}\n` });
                await send({ type: 'done', id: request.id, failed: { statement: 0, line: 0, sqlState: null }, cancelled: false });
            });
            break;
        case 'cancel':
            running.get(request.id)?.abort();
            break;
        case 'close':
            void close();
            break;
    }
});

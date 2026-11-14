// The process that runs the engine for `hyperdb-edge run`.
// The engine prints a LogFile line with fs.writeSync(1) from its worker on every start, which no code in the process
// can filter. So the command starts this process with its stdout going nowhere and gets the output over IPC.

import { HyperDBError } from 'hyperdb-wasm';

import { formatStatementResult } from '../format.js';
import { DatabaseFolderMissingError, EngineSettingsError, openEngine, type OpenEngine } from '../node/open_engine.js';
import { UnsupportedRuntimeError } from '../node/runtime_check.js';
import { runStatement } from '../run_statement.js';
import type { EngineMessage, EngineRequest } from './protocol.js';

function send(message: EngineMessage): Promise<void> {
    return new Promise((resolve, reject) => process.send!(message, (error: Error | null) => (error ? reject(error) : resolve())));
}

/// The error of a statement with what Hyper tells about it
export function statementErrorText(error: unknown, statement: number, count: number, line: number): string {
    const lines = [`hyperdb-edge: statement ${statement} of ${count} (line ${line}) failed: ${error instanceof Error ? error.message : String(error)}`];
    if (error instanceof HyperDBError) {
        if (error.sqlState) lines.push(`  SQLSTATE ${error.sqlState}`);
        if (error.detail) lines.push(`  DETAIL ${error.detail}`);
        if (error.hint) lines.push(`  HINT ${error.hint}`);
    }
    return `${lines.join('\n')}\n`;
}

/// Run the statements and return the exit code
async function run(request: EngineRequest): Promise<number> {
    let engine: OpenEngine;
    try {
        engine = await openEngine({ database: request.database, workDirectory: request.workDirectory, settings: request.settings });
    } catch (e) {
        await send({ type: 'stderr', text: `hyperdb-edge: ${e instanceof Error ? e.message : String(e)}\n` });
        const usage = e instanceof UnsupportedRuntimeError || e instanceof EngineSettingsError || e instanceof DatabaseFolderMissingError;
        return usage ? 2 : 1;
    }

    let code = 0;
    let printed = false;
    try {
        const count = request.statements.length;
        for (let i = 0; i < count; ++i) {
            const statement = request.statements[i];
            let output;
            try {
                const result = await runStatement(engine.connection, statement.text);
                output = formatStatementResult(result, i + 1, { format: request.format, maxRows: request.maxRows });
            } catch (e) {
                await send({ type: 'stderr', text: statementErrorText(e, i + 1, count, statement.line) });
                code = 1;
                break;
            }
            if (output.stdout.length > 0) {
                // The results of a table or a csv are separated by an empty line, json has one line per statement
                const separator = printed && request.format !== 'json' ? '\n' : '';
                await send({ type: 'stdout', text: separator + output.stdout });
                printed = true;
            }
            if (output.stderr) await send({ type: 'stderr', text: output.stderr });
        }
    } finally {
        await engine.close();
    }
    return code;
}

process.on('disconnect', () => process.exit(1));
process.once('message', (request: EngineRequest) => {
    run(request)
        .catch(async e => {
            await send({ type: 'stderr', text: `hyperdb-edge: ${e instanceof Error ? e.message : String(e)}\n` });
            return 1;
        })
        .then(async code => {
            await send({ type: 'done', code });
            process.exit(0);
        });
});

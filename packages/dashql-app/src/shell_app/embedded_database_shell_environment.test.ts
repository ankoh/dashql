// @vitest-environment node
import type * as arrow from 'apache-arrow';

import type { QueryExecutionArgs, QueryExecutor } from '@ankoh/dashql/platform/connections/query_execution_args';
import { createEmbeddedDatabaseShellEnvironment } from './embedded_database_shell_environment.js';
import { tableFromArrays } from '@ankoh/dashql/platform/testing/arrow_fixtures';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}

/// An executor of the runtime that answers every query with the results of a function, the ids count up
function executor(result: (args: QueryExecutionArgs) => Promise<arrow.Table | null>) {
    let next = 0;
    const calls: Array<[string, QueryExecutionArgs]> = [];
    const execute: QueryExecutor = (connectionId, args) => {
        calls.push([connectionId, args]);
        return [++next, result(args)];
    };
    return { execute, calls };
}

describe('embedded database shell environment', () => {
    it('runs a statement with the query executor on the connection of the shell', async () => {
        const { execute, calls } = executor(async () => tableFromArrays({ value: [42] }));
        const environment = createEmbeddedDatabaseShellEnvironment(execute, 'shell');

        await environment.executeQuery('SELECT 42');
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe('shell');
        // The executor analyzes the result as the computation of the query and passes on its error
        expect(calls[0][1]).toMatchObject({ query: 'SELECT 42', analyzeResults: true, throwOnError: true, metadata: { userProvided: true } });
    });

    it('reports progress, the timings of the executor and the result by the id of its query', async () => {
        const { execute } = executor(async args => {
            args.onTiming?.('Results', 1);
            return tableFromArrays({ value: [2, 3] });
        });
        const environment = createEmbeddedDatabaseShellEnvironment(execute, 'shell');
        const onProgress = vi.fn();
        const onResult = vi.fn();
        const onTiming = vi.fn();

        await environment.executeQuery('SELECT value', undefined, onProgress, onResult, onTiming);

        expect(onProgress).toHaveBeenCalledWith('Executing query');
        expect(onTiming).toHaveBeenCalledWith('Results', 1);
        expect(onResult).toHaveBeenCalledWith(1, 2);
    });

    it('returns the prompt once the catalog followed the statement, also after a failure', async () => {
        const followed = deferred<void>();
        const afterStatement = vi.fn(() => followed.promise);
        const { execute } = executor(async args => {
            if (args.query.startsWith('SELEC ')) throw new Error('syntax error');
            return tableFromArrays({});
        });
        const environment = createEmbeddedDatabaseShellEnvironment(execute, 'shell', { afterStatement });
        const onResult = vi.fn();

        const execution = environment.executeQuery('CREATE TABLE foo(a INT)', undefined, undefined, onResult);
        await vi.waitFor(() => expect(afterStatement).toHaveBeenCalledWith('CREATE TABLE foo(a INT)'));
        let done = false;
        void execution.then(() => { done = true; });
        await Promise.resolve();
        expect(done).toBe(false);
        followed.resolve();
        await execution;
        // A statement without columns shows no result
        expect(onResult).not.toHaveBeenCalled();

        await expect(environment.executeQuery('SELEC 1')).rejects.toThrow('syntax error');
        expect(afterStatement).toHaveBeenCalledWith('SELEC 1');
    });

    it('rejects an already cancelled query before it reaches the executor', async () => {
        const { execute, calls } = executor(async () => null);
        const environment = createEmbeddedDatabaseShellEnvironment(execute, 'shell');
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(calls).toHaveLength(0);
    });

    it('hands the cancellation of the shell to the executor', async () => {
        const { execute, calls } = executor(args => new Promise((_resolve, reject) => {
            args.abortSignal?.addEventListener('abort', () => reject(args.abortSignal!.reason));
        }));
        const environment = createEmbeddedDatabaseShellEnvironment(execute, 'shell');
        const abort = new AbortController();

        const execution = environment.executeQuery('SELECT 42', abort.signal);
        abort.abort();
        await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
        expect(calls[0][1].abortSignal).toBe(abort.signal);
    });
});

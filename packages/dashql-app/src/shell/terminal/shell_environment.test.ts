// @vitest-environment node
import type * as arrow from 'apache-arrow';

import type { QueryExecutionArgs, QueryExecutor } from '@akohn/dashql/platform/connections/query_execution_args';
import { createShellEnvironment } from './shell_environment.js';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';

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

describe('shell environment', () => {
    it('runs a statement with the query executor on the connection of the shell', async () => {
        const { execute, calls } = executor(async () => tableFromArrays({ value: [42] }));
        const environment = createShellEnvironment(execute, 'shell');

        await environment.executeQuery('SELECT 42');
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toBe('shell');
        // The executor analyzes the result as the computation of the query and passes on its error
        expect(calls[0][1]).toMatchObject({ query: 'SELECT 42', analyzeResults: true, metadata: { userProvided: true } });
    });

    it('names the workbook of the shell', async () => {
        const { execute, calls } = executor(async () => tableFromArrays({ value: [42] }));
        const environment = createShellEnvironment(execute, 'shell', { workbookId: 'workbook' });

        await environment.executeQuery('SELECT 42');
        expect(calls[0][1]).toMatchObject({ metadata: { userProvided: true, workbookId: 'workbook' } });
    });

    it('reports the logs and timings of the executor and the result by the id of its query', async () => {
        const { execute } = executor(async args => {
            args.onLog?.('Executing query');
            args.onTiming?.(1);
            return tableFromArrays({ value: [2, 3] });
        });
        const environment = createShellEnvironment(execute, 'shell');
        const onProgress = vi.fn();
        const onResult = vi.fn();
        const onTiming = vi.fn();

        await environment.executeQuery('SELECT value', undefined, onProgress, onResult, onTiming);

        expect(onProgress).toHaveBeenCalledWith('Executing query');
        expect(onTiming).toHaveBeenCalledWith(1);
        expect(onResult).toHaveBeenCalledWith(1, 2);
    });

    it('returns the prompt once the catalog followed the statement, also after a failure', async () => {
        const followed = deferred<void>();
        const afterStatement = vi.fn(() => followed.promise);
        const { execute } = executor(async args => {
            if (args.query.startsWith('SELEC ')) throw new Error('syntax error');
            return tableFromArrays({});
        });
        const releaseResult = vi.fn();
        const environment = createShellEnvironment(execute, 'shell', { afterStatement, releaseResult });
        const onResult = vi.fn();

        const execution = environment.executeQuery('CREATE TABLE foo(a INT)', undefined, undefined, onResult);
        await vi.waitFor(() => expect(afterStatement).toHaveBeenCalledWith('CREATE TABLE foo(a INT)'));
        let done = false;
        void execution.then(() => { done = true; });
        await Promise.resolve();
        expect(done).toBe(false);
        followed.resolve();
        await execution;
        // A statement without columns shows no result, its computation goes
        expect(onResult).not.toHaveBeenCalled();
        expect(releaseResult).toHaveBeenCalledWith(1);

        await expect(environment.executeQuery('SELEC 1')).rejects.toThrow('syntax error');
        expect(afterStatement).toHaveBeenCalledWith('SELEC 1');
    });

    it('reports a result whose statement was cancelled while the catalog followed it, the shell releases it', async () => {
        const abort = new AbortController();
        const { execute } = executor(async () => tableFromArrays({ value: [42] }));
        const releaseResult = vi.fn();
        const environment = createShellEnvironment(execute, 'shell', {
            afterStatement: async () => abort.abort(),
            releaseResult,
        });
        const onResult = vi.fn();

        await expect(environment.executeQuery('SELECT 42', abort.signal, undefined, onResult)).rejects.toMatchObject({ name: 'AbortError' });
        expect(onResult).toHaveBeenCalledWith(1, 1);
        expect(environment.releaseResult).toBe(releaseResult);
    });

    it('rejects an already cancelled query before it reaches the executor', async () => {
        const { execute, calls } = executor(async () => null);
        const environment = createShellEnvironment(execute, 'shell');
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(calls).toHaveLength(0);
    });

    it('hands the cancellation of the shell to the executor', async () => {
        const { execute, calls } = executor(args => new Promise((_resolve, reject) => {
            args.abortSignal?.addEventListener('abort', () => reject(args.abortSignal!.reason));
        }));
        const environment = createShellEnvironment(execute, 'shell');
        const abort = new AbortController();

        const execution = environment.executeQuery('SELECT 42', abort.signal);
        abort.abort();
        await expect(execution).rejects.toMatchObject({ name: 'AbortError' });
        expect(calls[0][1].abortSignal).toBe(abort.signal);
    });
});

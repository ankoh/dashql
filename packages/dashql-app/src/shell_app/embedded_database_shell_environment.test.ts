// @vitest-environment node
import { QueryExecutionStatus } from '../query/query_execution_state.js';
import { createEmbeddedDatabaseShellEnvironment } from './embedded_database_shell_environment.js';
import { ShellQueryExecutionTracker } from '../shell/query_execution.js';
import { tableFromArrays } from '../tests/arrow_fixtures.js';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}

describe('embedded database shell environment', () => {
    it('executes against the provided connection', async () => {
        const query = vi.fn().mockResolvedValue(tableFromArrays({ value: [42] }));
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any);

        await environment.executeQuery('SELECT 42');
        expect(query).toHaveBeenCalledWith('SELECT 42', expect.any(AbortSignal));
    });

    it('executes repeated queries against the database instead of caching results', async () => {
        const query = vi.fn()
            .mockResolvedValueOnce(tableFromArrays({ value: [1] }))
            .mockResolvedValueOnce(tableFromArrays({ value: [2, 3] }));
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any);
        const onResult = vi.fn();

        await environment.executeQuery('SELECT value', undefined, undefined, onResult);
        await environment.executeQuery('SELECT value', undefined, undefined, onResult);

        expect(query).toHaveBeenCalledTimes(2);
        expect(onResult).toHaveBeenNthCalledWith(1, expect.any(Number), 1);
        expect(onResult).toHaveBeenNthCalledWith(2, expect.any(Number), 2);
    });

    it('reports progress while the database query is running', async () => {
        const query = vi.fn().mockResolvedValue(tableFromArrays({ value: [42] }));
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any);
        const onProgress = vi.fn();

        await environment.executeQuery('SELECT 42', undefined, onProgress);

        expect(onProgress).toHaveBeenCalledWith('Executing query');
    });

    it('prepares and reports a result', async () => {
        const table = tableFromArrays({ value: [42] });
        const query = vi.fn().mockResolvedValue(table);
        const prepareResult = vi.fn();
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any, undefined, { prepareResult });
        const onResult = vi.fn();

        await environment.executeQuery('SELECT 42', undefined, undefined, onResult);

        expect(prepareResult).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ numRows: 1 }));
        expect(onResult).toHaveBeenCalledWith(expect.any(Number), 1);
    });

    it('reports a result only after its preparation completes', async () => {
        const table = tableFromArrays({ value: [42] });
        const preparation = deferred<void>();
        const environment = createEmbeddedDatabaseShellEnvironment(
            { query: vi.fn().mockResolvedValue(table) } as any,
            undefined,
            { prepareResult: () => preparation.promise },
        );
        const onResult = vi.fn();
        const execution = environment.executeQuery('SELECT 42', undefined, undefined, onResult);

        await Promise.resolve();
        expect(onResult).not.toHaveBeenCalled();
        preparation.resolve();
        await execution;
        expect(onResult).toHaveBeenCalledWith(expect.any(Number), 1);
    });

    it('reports the preparation of a result as postprocessing', async () => {
        const table = tableFromArrays({ value: [42] });
        const events: string[] = [];
        const query = vi.fn().mockResolvedValue(table);
        const environment = createEmbeddedDatabaseShellEnvironment(
            { query } as any,
            undefined,
            { prepareResult: () => { events.push('prepare'); } },
        );

        await environment.executeQuery(
            'SELECT 42',
            undefined,
            undefined,
            vi.fn(),
            (label, elapsedMs) => {
                expect(elapsedMs).toBeGreaterThanOrEqual(0);
                events.push(label);
            },
        );

        expect(events).toEqual(['Results', 'prepare', 'Postprocess']);
    });

    it('reports no result for statements without columns', async () => {
        const query = vi.fn().mockResolvedValue(tableFromArrays({}));
        const prepareResult = vi.fn();
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any, undefined, { prepareResult });
        const onResult = vi.fn();

        await environment.executeQuery('CREATE TABLE foo(a INT)', undefined, undefined, onResult);

        expect(query).toHaveBeenCalledWith('CREATE TABLE foo(a INT)', expect.any(AbortSignal));
        expect(prepareResult).not.toHaveBeenCalled();
        expect(onResult).not.toHaveBeenCalled();
    });

    it('rejects an already cancelled query before reaching the database', async () => {
        const query = vi.fn();
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any);
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(query).not.toHaveBeenCalled();
    });

    it('tracks successful queries with their row count', async () => {
        const query = vi.fn().mockResolvedValue(tableFromArrays({ value: [1, 2, 3] }));
        const tracker = new ShellQueryExecutionTracker();
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any, tracker);

        await environment.executeQuery('SELECT * FROM values');

        expect(tracker.getSnapshot()).toMatchObject([{
            queryText: 'SELECT * FROM values',
            status: QueryExecutionStatus.SUCCEEDED,
            error: null,
        }]);
        expect(tracker.getSnapshot()[0].resultTable?.numRows).toBe(3);
        expect(tracker.getSnapshot()[0].metrics.querySucceededAt).toBeInstanceOf(Date);
        expect(tracker.getSnapshot()[0].metrics.queryDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks failed queries', async () => {
        const query = vi.fn().mockRejectedValue(new Error('syntax error'));
        const tracker = new ShellQueryExecutionTracker();
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any, tracker);

        await expect(environment.executeQuery('SELEC 1')).rejects.toThrow('syntax error');

        expect(tracker.getSnapshot()).toMatchObject([{
            status: QueryExecutionStatus.FAILED,
            resultTable: null,
        }]);
        expect(tracker.getSnapshot()[0].error?.message).toBe('syntax error');
        expect(tracker.getSnapshot()[0].metrics.queryDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks cancelled queries', async () => {
        const query = vi.fn();
        const tracker = new ShellQueryExecutionTracker();
        const environment = createEmbeddedDatabaseShellEnvironment({ query } as any, tracker);
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });

        expect(tracker.getSnapshot()).toMatchObject([{
            status: QueryExecutionStatus.CANCELLED,
            resultTable: null,
        }]);
        expect(tracker.getSnapshot()[0].metrics.queryDurationMs).toBeGreaterThanOrEqual(0);
        expect(query).not.toHaveBeenCalled();
    });
});

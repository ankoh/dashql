// @vitest-environment node
import * as arrow from 'apache-arrow';

import { QueryExecutionStatus } from '../app/notebook/connections/query_execution_state.js';
import { createEmbeddedDatabaseShellEnvironment } from './embedded_database_shell_environment.js';
import { ShellQueryExecutionTracker } from './query_execution.js';

describe('embedded database shell environment', () => {
    it('executes against the provided connection', async () => {
        const result = new Uint8Array([1, 2, 3]);
        const queryArrowIPC = vi.fn().mockResolvedValue(result);
        const environment = createEmbeddedDatabaseShellEnvironment({ queryArrowIPC } as any);

        await expect(environment.executeQuery('SELECT 42')).resolves.toBe(result);
        expect(queryArrowIPC).toHaveBeenCalledWith('SELECT 42');
    });

    it('rejects an already cancelled query before reaching the database', async () => {
        const queryArrowIPC = vi.fn();
        const environment = createEmbeddedDatabaseShellEnvironment({ queryArrowIPC } as any);
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(queryArrowIPC).not.toHaveBeenCalled();
    });

    it('tracks successful queries with their row count', async () => {
        const result = arrow.tableToIPC(arrow.tableFromArrays({ value: [1, 2, 3] }), 'file');
        const queryArrowIPC = vi.fn().mockResolvedValue(result);
        const tracker = new ShellQueryExecutionTracker();
        const environment = createEmbeddedDatabaseShellEnvironment({ queryArrowIPC } as any, tracker);

        await expect(environment.executeQuery('SELECT * FROM values')).resolves.toBe(result);

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
        const queryArrowIPC = vi.fn().mockRejectedValue(new Error('syntax error'));
        const tracker = new ShellQueryExecutionTracker();
        const environment = createEmbeddedDatabaseShellEnvironment({ queryArrowIPC } as any, tracker);

        await expect(environment.executeQuery('SELEC 1')).rejects.toThrow('syntax error');

        expect(tracker.getSnapshot()).toMatchObject([{
            status: QueryExecutionStatus.FAILED,
            resultTable: null,
        }]);
        expect(tracker.getSnapshot()[0].error?.message).toBe('syntax error');
        expect(tracker.getSnapshot()[0].metrics.queryDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks cancelled queries', async () => {
        const queryArrowIPC = vi.fn();
        const tracker = new ShellQueryExecutionTracker();
        const environment = createEmbeddedDatabaseShellEnvironment({ queryArrowIPC } as any, tracker);
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });

        expect(tracker.getSnapshot()).toMatchObject([{
            status: QueryExecutionStatus.CANCELLED,
            resultTable: null,
        }]);
        expect(tracker.getSnapshot()[0].metrics.queryDurationMs).toBeGreaterThanOrEqual(0);
        expect(queryArrowIPC).not.toHaveBeenCalled();
    });
});

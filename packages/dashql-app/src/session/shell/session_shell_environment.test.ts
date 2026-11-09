// @vitest-environment node
import * as arrow from 'apache-arrow';

import { QueryExecutor } from '../../connections/query_executor.js';
import {
    createSessionShellEnvironment,
} from './session_shell_environment.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

describe('session shell environment', () => {
    it('reports a result with its query and row count', async () => {
        const progress = vi.fn();
        const execute = vi.fn<QueryExecutor>((connectionId, args) => {
            expect(connectionId).toBe('connection-7');
            expect(args.query).toBe('SELECT 42');
            expect(args.analyzeResults).toBe(true);
            expect(args.cacheable).toBe(false);
            expect(args.throwOnError).toBe(true);
            args.onLog?.('Executing query');
            return [7, Promise.resolve(tableFromArrays({ value: [42, 43] }))];
        });
        const cancel = vi.fn();
        const release = vi.fn();
        const environment = createSessionShellEnvironment('session', 'connection-7', execute, cancel, release);

        const result = vi.fn();
        await environment.executeQuery('SELECT 42', undefined, progress, result);
        expect(progress).toHaveBeenCalledWith('Executing query');
        expect(result).toHaveBeenCalledWith(7, 2);
        // The overlay holds the result
        expect(release).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it('forwards labeled timings from the query executor', async () => {
        const execute = vi.fn<QueryExecutor>((_connectionId, args) => {
            args.onTiming?.('Results', 12.5);
            return [7, Promise.resolve(tableFromArrays({ value: [42] }))];
        });
        const environment = createSessionShellEnvironment('session', 'connection-7', execute, vi.fn());
        const onTiming = vi.fn();

        await environment.executeQuery('SELECT 42', undefined, undefined, undefined, onTiming);

        expect(onTiming).toHaveBeenCalledWith('Results', 12.5);
    });

    it('releases statements without columns instead of reporting a result', async () => {
        const execute = vi.fn<QueryExecutor>(() => [7, Promise.resolve(tableFromArrays({}))]);
        const release = vi.fn();
        const environment = createSessionShellEnvironment('session', 'session-1', execute, vi.fn(), release);
        const result = vi.fn();

        await environment.executeQuery('CREATE TABLE foo(a INT)', undefined, undefined, result);

        expect(result).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledWith(7);
    });

    it('propagates aborts to the connection query executor', async () => {
        let resolveExecution: ((table: arrow.Table | null) => void) | null = null;
        const execute = vi.fn<QueryExecutor>(() => [9, new Promise(resolve => {
            resolveExecution = resolve;
        })]);
        const cancel = vi.fn();
        const environment = createSessionShellEnvironment('session', 'connection-7', execute, cancel);
        const abort = new AbortController();
        const execution = environment.executeQuery('SELECT 42', abort.signal);

        abort.abort();
        expect(cancel).toHaveBeenCalledWith('connection-7', 9);
        resolveExecution!(tableFromArrays({ value: [42] }));
        await execution;
    });
});

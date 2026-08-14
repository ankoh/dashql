// @vitest-environment node
import * as arrow from 'apache-arrow';

import { QueryExecutor } from '../connection/query_executor.js';
import { createNotebookShellEnvironment } from './notebook_shell_environment.js';

describe('notebook shell environment', () => {
    it('executes against the current notebook and returns Arrow file IPC', async () => {
        const progress = vi.fn();
        const execute = vi.fn<QueryExecutor>((notebookId, args) => {
            expect(notebookId).toBe('notebook-1');
            expect(args.query).toBe('SELECT 42');
            expect(args.throwOnError).toBe(true);
            args.onLog?.('Executing query');
            return [7, Promise.resolve(arrow.tableFromArrays({ value: [42] }))];
        });
        const cancel = vi.fn();
        const environment = createNotebookShellEnvironment('notebook-1', execute, cancel);

        const bytes = await environment.executeQuery('SELECT 42', undefined, progress);
        expect(arrow.tableFromIPC(bytes).getChild('value')?.get(0)).toBe(42);
        expect(new TextDecoder().decode(bytes.subarray(0, 6))).toContain('ARROW1');
        expect(progress).toHaveBeenCalledWith('Executing query');
        expect(cancel).not.toHaveBeenCalled();
    });

    it('propagates aborts to the connection query executor', async () => {
        let resolveExecution: ((table: arrow.Table | null) => void) | null = null;
        const execute = vi.fn<QueryExecutor>(() => [9, new Promise(resolve => {
            resolveExecution = resolve;
        })]);
        const cancel = vi.fn();
        const environment = createNotebookShellEnvironment('notebook-1', execute, cancel);
        const abort = new AbortController();
        const execution = environment.executeQuery('SELECT 42', abort.signal);

        abort.abort();
        expect(cancel).toHaveBeenCalledWith('notebook-1', 9);
        resolveExecution!(arrow.tableFromArrays({ value: [42] }));
        await execution;
    });
});

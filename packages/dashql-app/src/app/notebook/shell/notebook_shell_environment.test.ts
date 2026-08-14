// @vitest-environment node
import * as arrow from 'apache-arrow';

import { QueryExecutor } from '../connections/query_executor.js';
import {
    createNotebookShellEnvironment,
    createNotebookShellResultCommand,
    estimateTerminalTableWidth,
    NOTEBOOK_SHELL_AUTO_OVERLAY_ROW_LIMIT,
    type NotebookShellResultMode,
} from './notebook_shell_environment.js';

describe('notebook shell environment', () => {
    it('renders small auto-mode results in the terminal', async () => {
        const progress = vi.fn();
        const execute = vi.fn<QueryExecutor>((notebookId, args) => {
            expect(notebookId).toBe('notebook-1');
            expect(args.query).toBe('SELECT 42');
            expect(args.analyzeResults).toBe(true);
            expect(args.throwOnError).toBe(true);
            args.onLog?.('Executing query');
            return [7, Promise.resolve(arrow.tableFromArrays({ value: [42] }))];
        });
        const cancel = vi.fn();
        const environment = createNotebookShellEnvironment('notebook-1', execute, cancel);

        const result = vi.fn();
        const bytes = await environment.executeQuery('SELECT 42', undefined, progress, result);
        expect(arrow.tableFromIPC(bytes).getChild('value')?.get(0)).toBe(42);
        expect(progress).toHaveBeenCalledWith('Executing query');
        expect(result).not.toHaveBeenCalled();
        expect(cancel).not.toHaveBeenCalled();
    });

    it('opens auto-mode results in the overlay above the row limit', async () => {
        const rowCount = NOTEBOOK_SHELL_AUTO_OVERLAY_ROW_LIMIT + 1;
        const execute = vi.fn<QueryExecutor>(() => [7, Promise.resolve(arrow.tableFromArrays({
            value: Array.from({ length: rowCount }, (_, index) => index),
        }))]);
        const environment = createNotebookShellEnvironment('notebook-1', execute, vi.fn());
        const result = vi.fn();

        const bytes = await environment.executeQuery('SELECT value', undefined, undefined, result);

        expect(arrow.tableFromIPC(bytes).numCols).toBe(0);
        expect(result).toHaveBeenCalledWith(7, rowCount);
    });

    it('opens auto-mode results in the overlay when their natural width exceeds the terminal', async () => {
        let terminalColumns = 20;
        const table = arrow.tableFromArrays({
            identifier: [1],
            description: ['a result value that does not fit'],
        });
        const execute = vi.fn<QueryExecutor>(() => [7, Promise.resolve(table)]);
        const environment = createNotebookShellEnvironment(
            'notebook-1',
            execute,
            vi.fn(),
            () => 'auto',
            () => terminalColumns,
        );
        const result = vi.fn();

        expect(estimateTerminalTableWidth(table)).toBeGreaterThan(terminalColumns);
        expect(arrow.tableFromIPC(await environment.executeQuery('SELECT wide', undefined, undefined, result)).numCols).toBe(0);
        expect(result).toHaveBeenCalledWith(7, 1);

        terminalColumns = estimateTerminalTableWidth(table);
        result.mockClear();
        expect(arrow.tableFromIPC(await environment.executeQuery('SELECT wide', undefined, undefined, result)).numCols).toBe(2);
        expect(result).not.toHaveBeenCalled();
    });

    it('honors forced overlay and terminal result modes', async () => {
        let mode: NotebookShellResultMode = 'overlay';
        const execute = vi.fn<QueryExecutor>(() => [7, Promise.resolve(arrow.tableFromArrays({ value: [42] }))]);
        const environment = createNotebookShellEnvironment('notebook-1', execute, vi.fn(), () => mode);
        const result = vi.fn();

        expect(arrow.tableFromIPC(await environment.executeQuery('SELECT 42', undefined, undefined, result)).numCols).toBe(0);
        expect(result).toHaveBeenCalledWith(7, 1);

        mode = 'term';
        result.mockClear();
        expect(arrow.tableFromIPC(await environment.executeQuery('SELECT 42', undefined, undefined, result))
            .getChild('value')?.get(0)).toBe(42);
        expect(result).not.toHaveBeenCalled();
    });

    it('configures and reports the result display mode', async () => {
        let mode: NotebookShellResultMode = 'auto';
        const command = createNotebookShellResultCommand(() => mode, next => { mode = next; });

        expect(await command[2]([], {})).toBe(
            `Result display: auto (overlay when results exceed ${NOTEBOOK_SHELL_AUTO_OVERLAY_ROW_LIMIT} rows or terminal width)`,
        );
        expect(await command[2](['overlay'], {})).toBe('Result display: overlay');
        expect(mode).toBe('overlay');
        expect(await command[2](['term'], {})).toBe('Result display: term');
        expect(() => command[2](['invalid'], {})).toThrow('usage: .result [auto|overlay|term]');
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

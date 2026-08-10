// @vitest-environment node
import { DashQLShell, DashQLShellError, DashQLShellPromptAction, DashQLShellPromptInput, DashQLShellStatus } from './api.js';
import { createDuckDBShellEnvironment } from './duckdb_shell_environment.js';
import { instantiateTestWebDB } from '../platform/duckdb/duckdb_test_worker.js';
import { DuckDB, DuckDBConnection } from '../platform/duckdb/duckdb_api.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from '../connection/catalog_update_state.js';

declare const DASHQL_SHELL_PRECOMPILED: Promise<Uint8Array>;
declare const WEBDB_PRECOMPILED: Promise<Uint8Array>;

describe('DashQL shell Wasm', () => {
    let shell: DashQLShell;
    let executeQuery: (query: string, signal?: AbortSignal) => Promise<Uint8Array>;

    beforeEach(async () => {
        executeQuery = async () => {
            throw new Error('test database is not configured');
        };
        shell = await DashQLShell.create({
            environment: {
                executeQuery: (query, signal) => executeQuery(query, signal),
            },
            terminalColumns: 80,
            wasmBinary: await DASHQL_SHELL_PRECOMPILED,
        });
    });

    afterEach(() => shell.destroy());

    it('rejects operations after destruction', () => {
        shell.destroy();
        expect(() => shell.resize(40)).toThrowError(DashQLShellError);
    });

    it('owns an independent catalog and completes from copied relation and function scripts', () => {
        shell.loadCatalogScript(
            'CREATE TABLE sales.orders (order_id BIGINT, amount DOUBLE);',
            CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK,
        );
        shell.loadCatalogScript(
            'CREATE FUNCTION sales.discount(DOUBLE) RETURNS DOUBLE;',
            CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK,
        );

        expect(shell.setPrompt('select * from sales.ord')).toMatchObject({
            text: 'select * from sales.ord',
            cursorByteOffset: 23,
        });
        const relations = shell.completePrompt(20);
        expect(relations.some(candidate => candidate.displayText.toLowerCase().includes('orders'))).toBe(true);

        expect(() => shell.setPrompt('select sales.discount(1.0);')).not.toThrow();
    });

    it('submits the prompt through the asynchronous effect interface', async () => {
        executeQuery = async query => {
            expect(query).toBe('SELECT 42;');
            throw new Error('backend unavailable');
        };
        shell.setPrompt('SELECT 42;');
        await expect(shell.submitPrompt()).resolves.toBe('backend unavailable');
    });

    it('renders terminal highlighting in Wasm', () => {
        expect(shell.openTerminal('db> ', false).data).toBe('\r\x1b[2Kdb> \r\x1b[4C');
        const output = shell.consumeTerminalData("SELECT '界' FROM t").data;
        expect(output).toContain('\x1b[1;38;2;255;122;178mSELECT\x1b[0m');
        expect(output).toContain("\x1b[38;2;255;129;112m'界'\x1b[0m");
        expect(output).toContain('\x1b[38;2;107;170;159mt\x1b[0m');
    });

    it('decodes terminal controls', () => {
        shell.openTerminal('db> ', false);
        expect(shell.consumeTerminalData('\x1b').action).toBe(DashQLShellPromptAction.EXIT);
    });

    it('navigates, accepts, and dismisses terminal completion overlays', () => {
        shell.openTerminal('db> ', false);
        const opened = shell.consumeTerminalData('sel');

        const candidates = shell.completePrompt(50);
        expect(candidates.length).toBeGreaterThan(1);
        const selectIndex = candidates.findIndex(candidate => candidate.completionText === 'select');
        expect(selectIndex).toBeGreaterThanOrEqual(0);

        expect(opened.action).toBe(DashQLShellPromptAction.NONE);
        expect(opened.data).toContain('\x1b[7m');
        expect(opened.data).toContain('\x1b[1B\x1b[4C\x1b[2K\x1b[90m╭');
        expect(opened.data).toContain('\x1b[90m╰');
        expect(opened.data).not.toContain('\x1b[2K> ');
        for (let i = 0; i < selectIndex; ++i) shell.consumeTerminalData('\x1b[B');
        expect(shell.consumeTerminalData('\r').action).toBe(DashQLShellPromptAction.NONE);
        expect(shell.movePromptRight().text).toBe('select');

        shell.consumeTerminalData('\x03');
        expect(shell.consumeTerminalData('sel').data).toContain('\x1b[7m');
        expect(shell.consumeTerminalData('\x1b').action).toBe(DashQLShellPromptAction.NONE);
        expect(shell.consumeTerminalData('\x1b').action).toBe(DashQLShellPromptAction.EXIT);
    });

    it('drives multiline input and history through the shell core', async () => {
        let prompt = shell.consumePromptInput(DashQLShellPromptInput.TEXT, 'SELECT 42');
        expect(prompt.text).toBe('SELECT 42');
        prompt = shell.consumePromptInput(DashQLShellPromptInput.ENTER);
        expect(prompt).toMatchObject({ text: 'SELECT 42\n', action: DashQLShellPromptAction.NONE });
        prompt = shell.consumePromptInput(DashQLShellPromptInput.TEXT, ';');
        prompt = shell.consumePromptInput(DashQLShellPromptInput.ENTER);
        expect(prompt.action).toBe(DashQLShellPromptAction.SUBMIT);

        executeQuery = async () => { throw new Error('expected'); };
        await shell.submitPrompt();
        shell.consumePromptInput(DashQLShellPromptInput.CANCEL);
        expect(shell.consumePromptInput(DashQLShellPromptInput.HISTORY_PREVIOUS).text).toBe('SELECT 42\n;');

        const history = shell.exportHistory();
        shell.destroy();
        shell = await DashQLShell.create({
            environment: { executeQuery: (query, signal) => executeQuery(query, signal) },
            terminalColumns: 80,
            wasmBinary: await DASHQL_SHELL_PRECOMPILED,
        });
        shell.importHistory(history);
        expect(shell.consumePromptInput(DashQLShellPromptInput.HISTORY_PREVIOUS).text).toBe('SELECT 42\n;');
    });

    it('runs the asynchronous query workflow through a C++ coroutine', async () => {
        let database: DuckDB | null = null;
        let connection: DuckDBConnection | null = null;
        try {
            database = await instantiateTestWebDB(await WEBDB_PRECOMPILED);
            await database.open({ maximumThreads: 1 });
            connection = await database.connect();
            executeQuery = createDuckDBShellEnvironment(connection).executeQuery;

            await expect(shell.executeQuery(
                "SELECT * FROM (VALUES (1, 'alpha'), (20, '界'), (300, NULL)) AS t(value, name)",
            )).resolves.toBe(
                '╭───────┬───────╮\n' +
                '│ value │ name  │\n' +
                '╞═══════╪═══════╡\n' +
                '│     1 ┆ alpha │\n' +
                '│    20 ┆ 界    │\n' +
                '│   300 ┆       │\n' +
                '╰───────┴───────╯',
            );
        } finally {
            if (connection) await connection.close();
            database?.terminate();
        }
    });

    it('cancels a suspended C++ coroutine', async () => {
        const abort = new AbortController();
        executeQuery = () => new Promise<Uint8Array>(() => {});
        const query = shell.executeQuery('SELECT 42', abort.signal);
        abort.abort();
        await expect(query).resolves.toBe('Cancelled');
    });

    it('rejects a late completion after destruction', async () => {
        const pending: { resolve?: (value: Uint8Array) => void } = {};
        executeQuery = () => new Promise<Uint8Array>(resolve => {
            pending.resolve = resolve;
        });
        const query = shell.executeQuery('SELECT 42');
        const rejection = expect(query).rejects.toMatchObject({ status: DashQLShellStatus.STALE_EFFECT });
        await Promise.resolve();
        shell.destroy();
        pending.resolve?.(new Uint8Array());
        await rejection;
    });
});

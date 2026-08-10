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
            expect(query).toBe('SELECT 42');
            throw new Error('backend unavailable');
        };
        shell.setPrompt('SELECT 42;');
        await expect(shell.submitPrompt()).resolves.toBe('backend unavailable');
    });

    it('strips only the trailing shell terminator before execution', async () => {
        executeQuery = async query => {
            expect(query).toBe("SELECT ';' AS value");
            throw new Error('expected');
        };
        const prompt = "SELECT ';' AS value;  \n";
        shell.setPrompt(prompt);
        await expect(shell.submitPrompt()).resolves.toBe('expected');
        expect(new TextDecoder().decode(shell.exportHistory()).endsWith(prompt)).toBe(true);
    });

    it('renders terminal highlighting in Wasm', () => {
        expect(shell.openTerminal('db> ', false).data).toBe('\r\x1b[2Kdb> \r\x1b[4C');
        const output = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, "SELECT '界' FROM t").data;
        expect(output).toContain('\x1b[1;38;2;255;122;178mSELECT\x1b[0m');
        expect(output).toContain("\x1b[38;2;255;129;112m'界'\x1b[0m");
        expect(output).toContain('\x1b[38;2;107;170;159mt\x1b[0m');
    });

    it('consumes semantic terminal controls', () => {
        shell.openTerminal('db> ', false);
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ESCAPE).action).toBe(DashQLShellPromptAction.EXIT);
    });

    it('navigates, accepts, and dismisses terminal completion overlays', () => {
        shell.openTerminal('db> ', false);
        const opened = shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel');

        const candidates = shell.completePrompt(50);
        expect(candidates.length).toBeGreaterThan(1);
        const selectIndex = candidates.findIndex(candidate => candidate.completionText === 'select');
        expect(selectIndex).toBeGreaterThanOrEqual(0);

        expect(opened.action).toBe(DashQLShellPromptAction.NONE);
        expect(opened.data).toContain('\x1b[7m');
        expect(opened.data).toContain('\x1b[1B\x1b[4C\x1b[2K\x1b[90m╭');
        expect(opened.data).toContain('\x1b[90m╰');
        expect(opened.data).not.toContain('\x1b[2K> ');
        let selected = opened;
        for (let i = 0; i < selectIndex; ++i) selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        expect(selected.data).toContain('\x1b[90mect');
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ENTER).action).toBe(DashQLShellPromptAction.NONE);
        expect(shell.movePromptRight().text).toBe('select');

        shell.consumeTerminalInput(DashQLShellPromptInput.CANCEL);
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel').data).toContain('\x1b[7m');
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ESCAPE).action).toBe(DashQLShellPromptAction.NONE);
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.ESCAPE).action).toBe(DashQLShellPromptAction.EXIT);
    });

    it('does not cycle completion candidates with Left and Right', () => {
        shell.openTerminal('db> ', false);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel');
        const candidates = shell.completePrompt(50);
        expect(candidates.length).toBeGreaterThan(1);

        shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT);
        shell.consumeTerminalInput(DashQLShellPromptInput.LEFT);
        shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT);
        shell.consumeTerminalInput(DashQLShellPromptInput.ENTER);
        expect(shell.movePromptRight().text).toBe(candidates[0].completionText);
    });

    it('accepts keyword completion and its inline continuation in steps', () => {
        shell.openTerminal('db> ', false);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'SELECT * FROM supplier gro');
        const candidates = shell.completePrompt(50);
        const groupIndex = candidates.findIndex(candidate => candidate.completionText === 'group');
        expect(groupIndex).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < groupIndex; ++i) shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);

        const firstStep = shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(firstStep.data).toContain('\x1b[90m by');
        expect(shell.movePromptRight().text).toBe('SELECT * FROM supplier group');

        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toBe('SELECT * FROM supplier group by');
    });

    it('anchors completion below an earlier cursor line', () => {
        shell.openTerminal('db> ', false);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT, 'sel\nFROM supplier');
        for (let i = 0; i < '\nFROM supplier'.length; ++i) shell.movePromptLeft();
        shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT);
        const output = shell.consumeTerminalInput(DashQLShellPromptInput.LEFT);
        expect(output.data).toContain('\x1b[1B\x1b[4C\x1b[2K\x1b[90m╭');
    });

    it('shows qualification inline before accepting the candidate', () => {
        shell.openTerminal('db> ', false);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT,
            'CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); ' +
            'SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE customer_id',
        );
        const candidates = shell.completePrompt(50);
        const candidateIndex = candidates.findIndex(candidate => candidate.completionText === 'customer_id');
        expect(candidateIndex).toBeGreaterThanOrEqual(0);
        let selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        if (candidateIndex === 0) {
            selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_PREVIOUS);
        } else {
            for (let i = 1; i < candidateIndex; ++i) selected = shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);
        }
        expect(selected.data).toContain('\x1b[');
        expect(selected.data).toContain('@');
        expect(selected.data).toContain('\x1b[90m');
    });

    it('cycles inline qualification hints with Left and Right', () => {
        shell.openTerminal('db> ', false);
        shell.consumeTerminalInput(DashQLShellPromptInput.TEXT,
            'CREATE TABLE orders(customer_id BIGINT); CREATE TABLE customers(customer_id BIGINT); ' +
            'SELECT customer_id FROM orders o JOIN customers c ON o.customer_id = c.customer_id WHERE customer_id',
        );
        const candidates = shell.completePrompt(50);
        const candidateIndex = candidates.findIndex(candidate => candidate.completionText === 'customer_id');
        expect(candidateIndex).toBeGreaterThanOrEqual(0);
        for (let i = 0; i < candidateIndex; ++i) shell.consumeTerminalInput(DashQLShellPromptInput.HISTORY_NEXT);

        expect(shell.consumeTerminalInput(DashQLShellPromptInput.RIGHT).data).toContain('c.');
        expect(shell.consumeTerminalInput(DashQLShellPromptInput.LEFT).data).toContain('o.');
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        shell.consumeTerminalInput(DashQLShellPromptInput.TAB);
        expect(shell.movePromptRight().text).toContain('o.customer_id');
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

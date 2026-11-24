import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as dashql from '@akohn/dashql';

import { newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runAgentCommand, scriptFileName, type AgentCall, type AgentCommandHost } from './agent_commands.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
let dql: dashql.DashQL;
let runtime: Runtime;
let host: AgentCommandHost & { onEdited: Mock<AgentCommandHost['onEdited']>; onFollow: Mock<AgentCommandHost['onFollow']> };
let workbookId: string;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
beforeEach(() => {
    runtime = testRuntime(dql);
    runtime.createConnection(newDefaultHyperWasmConnection(), 'embedded');
    workbookId = runtime.createWorkbook('embedded', 'Sales', false).workbookId;
    runtime.flush();
    host = {
        runtime,
        results: null,
        isConnectionAllowed: connectionId => connectionId === 'embedded',
        writeFile: async (_workbookId, kind, name) => `${kind === 'chart' ? 'charts' : 'results'}/${name}`,
        onEdited: vi.fn<AgentCommandHost['onEdited']>(),
        onFollow: vi.fn<AgentCommandHost['onFollow']>(),
        logger: new TestLogger(),
    };
});
afterEach(async () => {
    await runtime.destroy();
});

/// Run a command, the text that it printed and its exit code
async function call(command: string, args: Record<string, unknown> = {}, input: string | null = null): Promise<{ exit: number; out: string; err: string }> {
    let out = '';
    let err = '';
    const request: AgentCall = { workbookId, command, args, input };
    const exit = await runAgentCommand(host, request, { out: text => { out += text; }, err: text => { err += text; } }, new AbortController().signal);
    return { exit, out, err };
}

describe('the dashql commands of the agent', () => {
    it('names a script by its display name or its file', () => {
        expect(scriptFileName('orders')).toBe('orders.sql');
        expect(scriptFileName('orders.sql')).toBe('orders.sql');
        expect(scriptFileName('scripts/orders.sql')).toBe('orders.sql');
    });

    it('creates a script, reads it, changes it and lists it', async () => {
        const created = await call('edit', { script: 'orders' }, 'select 1 as one');
        expect(created.exit).toBe(EXIT_OK);
        expect(created.out).toContain('Created orders on embedded');
        expect(created.out).toContain('orders: no diagnostics');
        expect(host.onEdited).toHaveBeenCalledWith(workbookId, 'orders.sql');
        expect(host.onFollow).toHaveBeenCalledWith(workbookId, expect.any(Number), 'script');

        expect(await call('read', { script: 'orders.sql' })).toEqual({ exit: EXIT_OK, out: 'select 1 as one\n', err: '' });
        const changed = await call('edit', { script: 'orders' }, 'select 2 as two');
        expect(changed.out).toContain('Changed orders');
        expect((await call('read', { script: 'orders' })).out).toBe('select 2 as two\n');

        const listed = await call('scripts');
        expect(listed.exit).toBe(EXIT_OK);
        expect(listed.out).toContain('Workbook "Sales"');
        expect(listed.out).toContain('embedded');
        expect(listed.out).toMatch(/orders {2}1 line {2}on embedded/);
    });

    it('fails on scripts that the workbook lacks, connections that the agent may not use and missing text', async () => {
        const missing = await call('read', { script: 'nope' });
        expect(missing.exit).toBe(EXIT_FAILED);
        expect(missing.err).toContain('the workbook has no script nope');
        const connection = await call('edit', { script: 'x', connection: 'trino' }, 'select 1');
        expect(connection.exit).toBe(EXIT_FAILED);
        expect(connection.err).toContain('you may not use the connection trino');
        const noText = await call('edit', { script: 'x' });
        expect(noText.exit).toBe(EXIT_USAGE);
        expect(noText.err).toContain('--file');
        const unknown = await call('drop');
        expect(unknown.exit).toBe(EXIT_USAGE);
    });

    it('moves a script in the feed', async () => {
        await call('edit', { script: 'a' }, 'select 1');
        await call('edit', { script: 'b' }, 'select 2');
        await call('edit', { script: 'c' }, 'select 3');
        expect((await call('move', { script: 'c', first: true })).out).toBe('c, a, b\n');
        expect((await call('move', { script: 'a', after: 'b' })).out).toBe('c, b, a\n');
        expect((await call('move', { script: 'a', before: 'c' })).out).toBe('a, c, b\n');
        expect((await call('move', { script: 'a' })).exit).toBe(EXIT_USAGE);
    });

    it('lints and formats a script', async () => {
        await call('edit', { script: 'broken' }, 'select from where');
        const linted = await call('lint', { script: 'broken' });
        expect(linted.exit).toBe(EXIT_FAILED);
        expect(linted.out).toMatch(/broken: [1-9]\d* errors?/);
        expect(linted.out).toContain('│ select from where');

        await call('edit', { script: 'pretty' }, 'SELECT   1 AS one');
        const formatted = await call('format', { script: 'pretty' });
        expect(formatted.exit).toBe(EXIT_OK);
        expect((await call('read', { script: 'pretty' })).out).not.toBe('SELECT   1 AS one\n');
        expect((await call('format', { script: 'pretty' })).out).toContain('is formatted');
    });

    it('prints the catalog of the connections that the agent may use', async () => {
        const catalog = await call('catalog');
        expect(catalog.exit).toBe(EXIT_OK);
        expect(catalog.out).toContain('-- ');
        expect(catalog.out).toContain('(embedded)');
        expect((await call('catalog', { connection: 'trino' })).exit).toBe(EXIT_FAILED);
    });

    it('checks the chart of a script without one', async () => {
        await call('edit', { script: 'plain' }, 'select 1 as one');
        const vis = await call('vis', { script: 'plain' });
        expect(vis.exit).toBe(EXIT_FAILED);
        expect(vis.out).toContain('plain has no chart');
    });
});

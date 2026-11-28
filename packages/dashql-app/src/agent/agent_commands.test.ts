import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as dashql from '@akohn/dashql';

import { newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import type { Runtime } from '@akohn/dashql/runtime';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';

import { describeAgentCall, EXIT_FAILED, EXIT_OK, EXIT_USAGE, runAgentCommand, type AgentCall, type AgentCommandHost } from './agent_commands.js';

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
        isConnectionAllowed: (_workbook, connectionId) => connectionId === 'embedded',
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
    it('tells what a call does in one line', () => {
        expect(describeAgentCall({ command: 'scripts', args: {} })).toBe('List the scripts');
        expect(describeAgentCall({ command: 'edit', args: { script: 'scripts/orders.sql' } })).toBe('Write orders');
        expect(describeAgentCall({ command: 'read', args: {} })).toBe('Read a script');
        expect(describeAgentCall({ command: 'run', args: { scripts: [] } })).toBe('Run all scripts');
        expect(describeAgentCall({ command: 'run', args: { scripts: ['a', 'b.sql', 3] } })).toBe('Run a, b');
        expect(describeAgentCall({ command: 'catalog', args: { connection: 'hyper' } })).toBe('Look up the tables of hyper');
        expect(describeAgentCall({ command: 'catalog', args: {} })).toBe('Look up the tables');
        expect(describeAgentCall({ command: 'vis', args: { script: 'chart' } })).toBe('Check the chart of chart');
        expect(describeAgentCall({ command: 'teleport', args: {} })).toBe('dashql teleport');
    });

    it('names a script by its name or its file in any case', async () => {
        await call('edit', { script: 'orders' }, 'select 1');
        const changed = await call('edit', { script: 'scripts/Orders.SQL' }, 'select 2');
        expect([changed.exit, changed.out.split('\n')[0]]).toEqual([EXIT_OK, 'Changed orders on embedded']);
        expect((await call('read', { script: 'ORDERS' })).out).toBe('select 2\n');
        const spaced = await call('edit', { script: 'my report' }, 'select 3');
        expect(spaced.out).toContain('Created my report on embedded');
        expect((await call('read', { script: 'My Report.sql' })).out).toBe('select 3\n');
        expect((await call('scripts')).out).not.toContain('orders-2');
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
        // dashql only types the arguments, the page checks their ranges
        const rows = await call('run', { scripts: [], rows: 10001 });
        expect(rows.exit).toBe(EXIT_USAGE);
        expect(rows.err).toBe('error: --rows takes a number from 0 to 10000\n');
        await call('edit', { script: 'chart' }, 'select 1');
        const width = await call('vis', { script: 'chart', width: 0 });
        expect([width.exit, width.err]).toEqual([EXIT_USAGE, 'error: --width takes a number from 1 to 4096\n']);
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

    it('tells the problems of a @vis tag, e.g. a spec that is no JSON', async () => {
        await call('edit', { script: 'broken_chart' }, `/**
 * @vis vegalite
 * {"mark": "bar",
 */
select 1 as one`);
        const vis = await call('vis', { script: 'broken_chart' });
        expect(vis.exit).toBe(EXIT_FAILED);
        expect(vis.out).toContain('broken_chart has no chart');
        expect(vis.out).toMatch(/ {2}- invalid Vega-Lite JSON: /);
        // The chart of the analysis of the page
        await call('edit', { script: 'broken_chart' }, `/**
 * @vis vegalite
 * {"mark": "bar", "encoding": {"x": {"field": "one", "type": "nominal"}}, "width": 300}
 */
select 1 as one`);
        const fixed = await call('vis', { script: 'broken_chart' });
        expect(fixed.out).toContain('broken_chart: @vis vegalite');
        expect(fixed.out).toContain('leave the size to DashQL');
    });
});

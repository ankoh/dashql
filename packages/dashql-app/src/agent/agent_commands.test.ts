import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAgentCommand, findScript, type AgentCommandEnvironment } from './agent_commands.js';
import { AgentCommandError } from './agent_client.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR, TRINO_CONNECTOR } from '../connections/connector_info.js';
import { ConnectionHealth } from '../connections/connection_state.js';
import type { QueryExecutor } from '../connections/query_executor.js';
import {
    CREATE_SCRIPT, RENAME_SCRIPT, SET_SCRIPT_CONNECTION, SET_SCRIPT_TEXT, createEmptyScriptData, reduceSessionScripts, replaceScriptSessionText,
    type SessionScripts,
} from '../session/scripts/session_scripts.js';
import { createScriptRef } from '../session/scripts/script_types.js';
import { acquireSessionExecution, isSessionExecutionRunning, releaseSessionExecution } from '../session/scripts/session_execution.js';
import { SessionTestBackend } from '../storage/session_test_backend.js';
import { StorageWriter } from '../storage/storage_writer.js';
import { tableFromArrays } from '../tests/arrow_fixtures.js';

/// A script with a text and the diagnostics of its analysis
function script(scriptKey: number, fileName: string, text: string, diagnostics: unknown[] = []) {
    return {
        scriptKey,
        fileName,
        analysisOutdated: false,
        scriptSession: { getText: () => text, getTextVersion: () => 0n, getCatalogRevision: () => 0n },
        editorUpdate: { diagnostics, textVersion: 0n, catalogRevision: 0n },
        connection: { connectionId: 'db', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: {} },
        annotations: { tableDefs: [], visualizeQuery: null },
        latestQueryId: null,
        latestResultQueryId: null,
    } as any;
}

function session(scripts: any[]): SessionScripts {
    return {
        sessionId: 's1',
        name: 'Revenue',
        pendingConnection: scripts.length === 0 ? { connectionId: 'db', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: {} as any } : null,
        instance: {} as any,
        sessionMetadata: {} as any,
        scripts: Object.fromEntries(scripts.map(s => [s.scriptKey, s])),
        scriptRefs: Object.fromEntries(scripts.map(s => [s.fileName, { scriptId: s.scriptKey, fileName: s.fileName }])),
        scriptOrder: scripts.map(s => s.fileName),
        scriptFocus: { fileName: scripts[0]?.fileName ?? '' },
        semanticUserFocus: null,
    };
}

describe('agent commands', () => {
    let state: SessionScripts;
    let modify: ReturnType<typeof vi.fn>;
    let connections: Map<string, any>;
    let env: AgentCommandEnvironment;
    let edited: number[];

    beforeEach(() => {
        state = session([script(1, 'orders.sql', 'select 1'), script(2, 'Customers.sql', 'select 2\nfrom c')]);
        modify = vi.fn(async () => state);
        connections = new Map([['db', {
            connectionId: 'db',
            connectionHealth: ConnectionHealth.ONLINE,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
            details: { type: HYPER_CONNECTOR, value: { proto: {} } },
            catalogRelationScript: '',
            queriesActive: new Map(),
            queriesFinished: new Map(),
        }]]);
        edited = [];
        env = {
            sessionScripts: id => (id === 's1' ? state : null),
            modifySessionScripts: modify as any,
            connections: () => ({ connections, connectionsByType: [] }),
            executeQuery: vi.fn() as any,
            logger: new TestLogger(),
            onScriptEdited: (_session, scriptKey) => edited.push(scriptKey),
        };
    });

    const run = (command: string, args: Record<string, unknown> = {}, sessionId: string = 's1') =>
        runAgentCommand(env, { session: sessionId, command, args });

    it('finds scripts by name, with or without the extension', () => {
        expect(findScript(state, 'orders')?.scriptKey).toBe(1);
        expect(findScript(state, 'customers.sql')?.scriptKey).toBe(2);
        expect(findScript(state, 'missing')).toBeNull();
    });

    it('lists the scripts', async () => {
        const result = await run('scripts');
        expect(result.text).toBe([
            'Session "Revenue" (s1)',
            'Connections: db (embedded Hyper, read-write, online)',
            'Scripts:',
            '  orders  1 line  (focused)',
            '  Customers  2 lines',
        ].join('\n'));
    });

    /// A script on the Trino connection lake
    const onLake = (s: any) => ({ ...s, connection: { connectionId: 'lake', connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: {} } });
    /// Add the Trino connection lake with a script on it to the session
    const useLake = () => {
        state = session([...Object.values(state.scripts), onLake(script(3, 'events.sql', 'select 3'))]);
        connections.set('lake', {
            connectionId: 'lake',
            connectionHealth: ConnectionHealth.ONLINE,
            connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO],
            details: { type: TRINO_CONNECTOR },
            queriesActive: new Map(),
            queriesFinished: new Map(),
        });
    };
    const lakeConnection = { connectionId: 'lake', connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], catalog: undefined, params: undefined, local: false };

    it('marks read-only connections', async () => {
        useLake();
        const result = await run('scripts');
        expect(result.text).toContain('Connections: db (embedded Hyper, read-write, online), lake (Trino, read-only, online, caches results)');
        expect(result.text).toContain('  events  1 line  on lake');
        expect((result.data as any).connections).toEqual([
            { id: 'db', connector: 'Hyper', embedded: true, readOnly: false, online: true, cachesResults: false },
            { id: 'lake', connector: 'Trino', embedded: false, readOnly: true, online: true, cachesResults: true },
        ]);
    });

    it('marks the connections whose results are cached by the choice of the user', async () => {
        useLake();
        connections.set('lake', { ...connections.get('lake'), cacheQueryResults: false });
        const result = await run('scripts');
        expect(result.text).toContain('lake (Trino, read-only, online)');
        expect((result.data as any).connections[1]).toMatchObject({ id: 'lake', cachesResults: false });
    });

    it('offers the embedded Hyper to a session that does not use it', async () => {
        state = session([onLake(script(3, 'events.sql', 'select 3'))]);
        connections.set('lake', { connectionId: 'lake', connectionHealth: ConnectionHealth.ONLINE, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], details: { type: TRINO_CONNECTOR } });
        const result = await run('scripts');
        expect(result.text).toContain('Connections: lake (Trino, read-only, online, caches results), db (embedded Hyper, read-write, online)');
        expect((await run('catalog', { connection: 'db' })).data).toMatchObject({ connection: 'db' });
    });

    it('allocates the embedded Hyper for the agent when the app holds none', async () => {
        state = session([onLake(script(3, 'events.sql', 'select 3'))]);
        const db = connections.get('db');
        connections.delete('db');
        connections.set('lake', { connectionId: 'lake', connectionHealth: ConnectionHealth.ONLINE, connectorInfo: CONNECTOR_INFOS[ConnectorType.TRINO], details: { type: TRINO_CONNECTOR } });
        env.embeddedConnection = vi.fn(() => {
            connections.set('db', db);
            return db;
        });
        const result = await run('scripts');
        expect(env.embeddedConnection).toHaveBeenCalledWith(state.instance);
        expect(result.text).toContain('Connections: lake (Trino, read-only, online, caches results), db (embedded Hyper, read-write, online)');
    });

    it('lists the attachments of the session', async () => {
        state.attachments = [
            { fileName: 'sales.parquet', name: 'sales', sizeBytes: 2000, mtimeMs: 0, columns: ['region', 'amount'] },
            { fileName: 'events.parquet', name: 'events', sizeBytes: 12, mtimeMs: 0, columns: null },
        ];
        const result = await run('scripts');
        expect(result.text).toContain([
            'Attachments:',
            '  sales.parquet  2 kB  :sales (region, amount)',
            '  events.parquet  12 bytes  :events',
        ].join('\n'));
        expect((result.data as any).attachments[0]).toEqual({ fileName: 'sales.parquet', name: 'sales', sizeBytes: 2000, columns: ['region', 'amount'] });
        const catalog = await run('catalog', { connection: 'db' });
        expect(catalog.text).toContain('-- The attachments of the session, read them as table parameters\n-- :sales (region, amount)');
    });

    it('reads a script', async () => {
        expect((await run('read', { script: 'customers' })).text).toBe('select 2\nfrom c');
    });

    it('fails for unknown scripts and sessions', async () => {
        await expect(run('read', { script: 'nope' })).rejects.toThrow('No script named nope. Scripts: orders, Customers');
        await expect(run('read', {})).rejects.toBeInstanceOf(AgentCommandError);
        await expect(run('scripts', {}, 'gone')).rejects.toThrow('The session gone is not open in DashQL');
    });

    it('replaces the text of a script and reports its diagnostics', async () => {
        const after = session([
            script(1, 'orders.sql', 'select x', [{ severity: core.buffers.editor.EditorDiagnosticSeverity.ERROR, message: 'unknown column', textSpan: { offset: 7, length: 1 } }]),
            script(2, 'Customers.sql', 'select 2\nfrom c'),
        ]);
        modify.mockResolvedValueOnce(after);
        const result = await run('edit', { script: 'orders', text: 'select x' });
        expect(modify).toHaveBeenCalledExactlyOnceWith('s1', { type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: 'select x' } });
        expect(edited).toEqual([1]);
        expect(result.text).toMatch(/^Updated orders: sha256 [0-9a-f]{64}, 1 error, 0 warnings\norders:1:8: error: unknown column$/);
    });

    it('creates a script with the given name', async () => {
        const created = session([...Object.values(state.scripts), script(3, 'brave-otter.sql', 'select 3')]);
        created.scriptFocus = { fileName: 'brave-otter.sql' };
        const renamed = session([...Object.values(state.scripts), script(3, 'top.sql', 'select 3')]);
        modify.mockResolvedValueOnce(created).mockResolvedValueOnce(renamed);
        const result = await run('edit', { script: 'top.sql', text: 'select 3' });
        expect(modify.mock.calls).toEqual([
            ['s1', { type: CREATE_SCRIPT, value: { index: null, text: 'select 3' } }],
            ['s1', { type: RENAME_SCRIPT, value: { fileName: 'brave-otter.sql', newFileName: 'top' } }],
        ]);
        expect(result.text).toMatch(/^Created top: sha256 [0-9a-f]{64}, 0 errors, 0 warnings$/);
        expect(edited).toEqual([3]);
    });

    it('creates a script on another connection of the session', async () => {
        useLake();
        const created = session([...Object.values(state.scripts), onLake(script(4, 'brave-otter.sql', 'select 4'))]);
        created.scriptFocus = { fileName: 'brave-otter.sql' };
        const renamed = session([...Object.values(state.scripts), onLake(script(4, 'top.sql', 'select 4'))]);
        modify.mockResolvedValueOnce(created).mockResolvedValueOnce(renamed);
        const result = await run('edit', { script: 'top', text: 'select 4', connection: 'lake' });
        expect(modify.mock.calls[0]).toEqual(['s1', { type: CREATE_SCRIPT, value: { index: null, text: 'select 4', connection: lakeConnection } }]);
        expect(result.text).toMatch(/^Created top on lake: sha256 [0-9a-f]{64}, 0 errors, 0 warnings$/);
        expect((result.data as any).connection).toBe('lake');
    });

    it('moves a script to another connection of the session before it edits it', async () => {
        useLake();
        const moved = session(Object.values(state.scripts).map(s => (s.scriptKey === 1 ? onLake(s) : s)));
        const after = session(Object.values(moved.scripts).map(s => (s.scriptKey === 1 ? onLake(script(1, 'orders.sql', 'select 5')) : s)));
        modify.mockResolvedValueOnce(moved).mockResolvedValueOnce(after);
        const result = await run('edit', { script: 'orders', text: 'select 5', connection: 'lake' });
        expect(modify.mock.calls).toEqual([
            ['s1', { type: SET_SCRIPT_CONNECTION, value: { fileName: 'orders.sql', connection: lakeConnection } }],
            ['s1', { type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: 'select 5' } }],
        ]);
        expect(result.text).toMatch(/^Updated orders on lake: /);
    });

    it('edits a script on its connection without moving it', async () => {
        useLake();
        await run('edit', { script: 'events', text: 'select 6', connection: 'lake' });
        expect(modify).toHaveBeenCalledExactlyOnceWith('s1', { type: SET_SCRIPT_TEXT, value: { scriptKey: 3, text: 'select 6' } });
    });

    it('refuses connections that the session does not use', async () => {
        await expect(run('edit', { script: 'top', text: 'select 1', connection: 'lake' })).rejects.toThrow('The session does not use the connection lake. Connections: db');
        expect(modify).not.toHaveBeenCalled();
    });

    it('refuses invalid script names', async () => {
        await expect(run('edit', { script: '../x', text: '' })).rejects.toThrow('invalid script name');
        expect(modify).not.toHaveBeenCalled();
    });

    it('lints a script', async () => {
        expect((await run('lint', { script: 'orders' })).text).toBe('orders: no diagnostics');
    });

    it('refuses to run a script on an offline connection', async () => {
        connections.get('db').connectionHealth = ConnectionHealth.FAILED;
        await expect(run('run', { script: 'orders' })).rejects.toThrow('The connection db of orders is not online');
    });

    it('refuses to run a script that runs only on request unless forced', async () => {
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: null, manual: true };
        await expect(run('run', { script: 'orders' })).rejects.toThrow('orders runs only on request (@manual)');
        await expect(run('run', { script: 'orders', force: 'yes' })).rejects.toThrow('force must be a boolean');
        // Forced, the run goes on to the connection
        connections.get('db').connectionHealth = ConnectionHealth.FAILED;
        await expect(run('run', { script: 'orders', force: true })).rejects.toThrow('The connection db of orders is not online');
    });

    it('never runs a script that calls a client function that writes', async () => {
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: null, manual: false, writes: true };
        await expect(run('run', { script: 'orders' })).rejects.toThrow('orders calls a client function that writes, so only the user runs it');
        await expect(run('run', { script: 'orders', force: true })).rejects.toThrow('only the user runs it');
    });

    it('pages through the last result of a script', async () => {
        state.scripts[1].latestQueryId = 7;
        const table = tableFromArrays({ n: Int32Array.from({ length: 60 }, (_, i) => i) });
        connections.get('db').queriesFinished.set(7, { resultTable: table, error: null });
        const second = await run('result', { script: 'orders', page: 2 });
        expect(second.text).toContain('(rows 51-60 of 60)');
        await expect(run('result', { script: 'orders', page: 3 })).rejects.toThrow('orders has 60 rows, page 3 is empty');
        await expect(run('result', { script: 'customers' })).rejects.toThrow('Customers has no result');
    });

    it('reads the Vega-Lite spec of a script as written, without the $schema and data of the compiler', async () => {
        const vegaLiteSpec = { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', data: { $sql: 'select 1' }, mark: 'bar', encoding: { x: { field: 'n' } } } as any;
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec } };
        const result = await run('vis.read', { script: 'orders' });
        const spec = { mark: 'bar', encoding: { x: { field: 'n' } } };
        expect(result.text).toBe(JSON.stringify(spec, null, 2));
        expect(result.data).toEqual({ script: 'orders', renderer: 'vegalite', spec });
    });

    it('reads the renderer of scripts without a Vega-Lite spec', async () => {
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: { renderer: 'table', sql: 'select 1', statementId: 0 } };
        const result = await run('vis.read', { script: 'orders' });
        expect(result.text).toBe('orders shows a table @vis tag, no Vega-Lite spec');
        expect(result.data).toEqual({ script: 'orders', renderer: 'table', spec: null });
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: null };
        await expect(run('vis.read', { script: 'orders' })).rejects.toThrow('orders has no chart, add one with dashql agent vis edit orders');
    });

    it('renders the chart of a script with its last result as PNG', async () => {
        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'n', type: 'ordinal' }, y: { field: 'n', type: 'quantitative' } } } as any;
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec } };
        await expect(run('vis.image', { script: 'orders' })).rejects.toThrow('orders has no result');
        state.scripts[1].latestQueryId = 7;
        connections.get('db').queriesFinished.set(7, { resultTable: tableFromArrays({ n: Int32Array.from([1, 2, 3]) }), error: null });

        const result = await run('vis.image', { script: 'orders', width: 200, height: 100, scale: 1 });
        expect(result.text).toMatch(/^Rendered the chart of orders: 200x100 pixels, 3 rows, \d+ KiB$/);
        const data = result.data as { width: number; height: number; png: string };
        expect([data.width, data.height]).toEqual([200, 100]);
        const png = Uint8Array.from(atob(data.png), c => c.charCodeAt(0));
        expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('refuses images of scripts without a Vega-Lite chart and too large images', async () => {
        state.scripts[1].annotations = { tableDefs: [], visualizeQuery: null };
        await expect(run('vis.image', { script: 'orders' })).rejects.toThrow('orders has no Vega-Lite chart, add one with dashql agent vis edit orders');
        await expect(run('vis.image', { script: 'orders', width: 5000 })).rejects.toThrow('width and height must be at most 4000');
        await expect(run('vis.image', { script: 'orders', scale: 8 })).rejects.toThrow('scale must be at most 4');
    });
});

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('agent vis edit command', () => {
    let dql: core.DashQL;
    let catalog: core.DashQLCatalog;
    let modify: ReturnType<typeof vi.fn>;
    let env: AgentCommandEnvironment;

    beforeAll(async () => {
        dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });

    /// A session with one script whose text the agent visualizes
    const setup = (text: string) => {
        catalog = dql.createCatalog();
        const scriptOf = (t: string) => ({ ...script(1, 'orders.sql', t), connection: { connectionId: 'db', catalog } });
        const state = { ...session([scriptOf(text)]), instance: dql };
        modify = vi.fn(async (_session: string, action: any) => ({ ...state, scripts: { 1: scriptOf(action.value.text) } }));
        env = {
            sessionScripts: () => state,
            modifySessionScripts: modify as any,
            connections: () => ({ connections: new Map(), connectionsByType: [] }),
            executeQuery: vi.fn() as any,
            logger: new TestLogger(),
        };
    };

    afterEach(() => catalog.destroy());

    const visualize = (spec: unknown) =>
        runAgentCommand(env, { session: 's1', command: 'vis.edit', args: { script: 'orders', spec: typeof spec === 'string' ? spec : JSON.stringify(spec) } });

    it('writes a valid spec as the @vis vegalite tag of the last query', async () => {
        setup('/* @vis table */\nselect 1 as region, 2 as revenue');
        const result = await visualize({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } });
        expect(modify).toHaveBeenCalledExactlyOnceWith('s1', { type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: expect.any(String) } });
        expect(modify.mock.calls[0][1].value.text).toBe([
            '/**',
            ' * @vis vegalite',
            ' * {',
            ' *   "mark": "bar",',
            ' *   "encoding": {',
            ' *     "x": {"field": "region", "type": "nominal"},',
            ' *     "y": {"field": "revenue", "type": "quantitative"}',
            ' *   }',
            ' * }',
            ' */',
            'select 1 as region, 2 as revenue',
        ].join('\n'));
        expect(result.text).toMatch(/^Visualized orders: sha256 [0-9a-f]{64}, 0 errors, 0 warnings$/);
    });

    it('rejects fields that are no output columns of the query', async () => {
        setup('select 1 as region');
        await expect(visualize({ mark: 'bar', encoding: { x: { field: 'regoin' } } })).rejects.toThrow(
            'The Vega-Lite spec is invalid, orders is unchanged:\n  unknown field "regoin", the statement has the columns region',
        );
        expect(modify).not.toHaveBeenCalled();
    });

    it('rejects specs that Vega-Lite warns about or cannot compile', async () => {
        setup('select 1 as a');
        await expect(visualize({ mark: 'bar', encoding: { x: { field: 'a', aggregate: 'avgg' } } })).rejects.toThrow('Invalid aggregation operator "avgg"');
        await expect(visualize({ mark: 'bar', transform: [{ calculate: 'datum.a +', as: 'c' }] })).rejects.toThrow('is unchanged');
        await expect(visualize({ mark: 'bar', data: { values: [] } })).rejects.toThrow('data is ignored, the statement is the data of the chart');
        await expect(visualize('[1]')).rejects.toThrow('The Vega-Lite spec is no JSON object');
        await expect(visualize('{"mark":')).rejects.toThrow('The Vega-Lite spec is no valid JSON');
        expect(modify).not.toHaveBeenCalled();
    });

    it('needs a query as the last statement', async () => {
        setup('create table t (a int)');
        await expect(visualize({ mark: 'bar' })).rejects.toThrow('Cannot visualize orders: the last statement of the script is no query');
    });
});

describe('agent run command', () => {
    let dql: core.DashQL;

    beforeAll(async () => {
        dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    afterEach(() => dql.resetUnsafe());

    /// A session with one script on an online connection
    const setup = (text: string, executeQuery: QueryExecutor) => {
        const connection = { connectionId: 'db', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog() };
        const [scriptKey, scriptData] = createEmptyScriptData(dql, connection, 'orders.sql');
        replaceScriptSessionText(scriptData.scriptSession, text);
        let state: SessionScripts = {
            ...session([]), instance: dql, pendingConnection: null,
            scripts: { [scriptKey]: scriptData }, scriptRefs: { 'orders.sql': createScriptRef(scriptKey, 'orders.sql') },
            scriptOrder: ['orders.sql'], scriptFocus: { fileName: 'orders.sql' },
        };
        const logger = new TestLogger();
        const writer = new StorageWriter(logger, new SessionTestBackend());
        const env: AgentCommandEnvironment = {
            sessionScripts: () => state,
            modifySessionScripts: async (_sessionId, action) => (state = reduceSessionScripts(state, action, writer, logger)),
            connections: () => ({ connections: new Map([['db', { connectionId: 'db', connectionHealth: ConnectionHealth.ONLINE } as any]]), connectionsByType: [] }),
            executeQuery,
            logger,
        };
        const run = (args: Record<string, unknown>) => runAgentCommand(env, { session: 's1', command: 'run', args: { script: 'orders', ...args } });
        return Object.assign(run, { session: () => state });
    };

    it('waits for the run of another script of the session', async () => {
        const executeQuery = vi.fn<QueryExecutor>(() => [1, Promise.resolve(tableFromArrays({ n: Int32Array.from([1]) }))]);
        const run = setup('select 1 as n', executeQuery);
        // Another turn runs a script of the session
        expect(acquireSessionExecution(run.session())).toBe(true);
        const result = run({});
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(executeQuery).not.toHaveBeenCalled();
        releaseSessionExecution(run.session());
        expect((await result).data).toMatchObject({ script: 'orders', rowCount: 1 });
        expect(isSessionExecutionRunning(run.session())).toBe(false);
    });

    it('fails while the whole session runs', async () => {
        const executeQuery = vi.fn<QueryExecutor>(() => [1, Promise.resolve(null)]);
        const run = setup('select 1 as n', executeQuery);
        expect(acquireSessionExecution(run.session(), 'session')).toBe(true);
        try {
            await expect(run({})).rejects.toThrow('orders failed: The session is running');
            expect(executeQuery).not.toHaveBeenCalled();
        } finally {
            releaseSessionExecution(run.session());
        }
    });

    it('reports a failed query instead of a run without a result', async () => {
        // Like the query executor: a failed query resolves with null unless the caller asks for the error
        const failure = { message: 'Index support is disabled.' };
        const executeQuery = vi.fn<QueryExecutor>((_connectionId, args) => [24, args.throwOnError ? Promise.reject(failure) : Promise.resolve(null)]);
        const run = setup('create table t (a int primary key)', executeQuery);
        await expect(run({})).rejects.toThrow('orders failed: Index support is disabled.');
        expect(executeQuery).toHaveBeenCalledWith('db', expect.objectContaining({ query: 'create table t (a int primary key)', throwOnError: true }));
    });

    it('returns the last output of the script', async () => {
        let queryId = 0;
        const executeQuery = vi.fn<QueryExecutor>((_connectionId, args) =>
            [++queryId, Promise.resolve(args.query.startsWith('select') ? tableFromArrays({ n: Int32Array.from([1, 2]) }) : null)]);
        const run = setup('select 1 as n; create table t (a int)', executeQuery);
        const result = await run({});
        expect(executeQuery.mock.calls.map(([, args]) => args.query)).toEqual(['select 1 as n', 'create table t (a int)']);
        expect(result.data).toMatchObject({ script: 'orders', rowCount: 2 });
    });

    it('reports a script that holds no statement', async () => {
        const executeQuery = vi.fn<QueryExecutor>(() => [25, Promise.resolve(null)]);
        const run = setup('-- nothing', executeQuery);
        await expect(run({})).rejects.toThrow('orders failed: orders.sql holds no statement');
        // The script shows the error where its result would be
        expect(executeQuery).toHaveBeenCalledWith('db', expect.objectContaining({ failure: expect.objectContaining({ message: 'orders.sql holds no statement' }) }));
    });
});

import * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAgentCommand, findScript, type AgentCommandEnvironment } from './agent_commands.js';
import { AgentCommandError } from '../../platform/agent/agent_client.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import { ConnectionHealth } from '../connections/connection_state.js';
import type { QueryExecutor } from '../connections/query_executor.js';
import { CREATE_SCRIPT, RENAME_SCRIPT, SET_SCRIPT_TEXT, type SessionScripts } from '../session/scripts/session_scripts.js';

/// A script with a text and the diagnostics of its analysis
function script(scriptKey: number, fileName: string, text: string, diagnostics: unknown[] = []) {
    return {
        scriptKey,
        fileName,
        analysisOutdated: false,
        scriptSession: { getText: () => text },
        editorUpdate: { diagnostics },
        connection: { connectionId: 'db', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: {} },
        latestQueryId: null,
        latestResultQueryId: null,
    } as any;
}

function session(scripts: any[]): SessionScripts {
    return {
        sessionId: 's1',
        name: 'Revenue',
        connectionId: 'db',
        settings: { cacheQueryResults: false },
        instance: {} as any,
        sessionMetadata: {} as any,
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        connectionCatalog: {} as any,
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
            'Default connection: db (Hyper, online)',
            'Scripts:',
            '  orders  1 line  (focused)',
            '  Customers  2 lines',
        ].join('\n'));
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

    it('reports a failed query instead of a run without a result', async () => {
        const text = 'create table t (a int primary key)';
        state = session([{
            ...script(1, 'orders.sql', text),
            scriptSession: {
                getText: () => text,
                compileQuery: () => ({
                    read: () => ({ errorsLength: () => 0, sql: () => text, cacheSignature: () => '', cacheable: () => false }),
                    destroy: () => { },
                }),
                startExecution: () => ({}),
            },
            annotations: { visualizeQuery: null },
            editorUpdate: { diagnostics: [], textVersion: 1, stateRevision: 1, analysisAvailable: true },
        }]);
        // Like the query executor: a failed query resolves with null unless the caller asks for the error
        const failure = { message: 'Index support is disabled.' };
        env.executeQuery = vi.fn<QueryExecutor>((_connectionId, args) => [24, args.throwOnError ? Promise.reject(failure) : Promise.resolve(null)]);
        await expect(run('run', { script: 'orders' })).rejects.toThrow('orders failed: Index support is disabled.');
        expect(env.executeQuery).toHaveBeenCalledWith('db', expect.objectContaining({ throwOnError: true }));
    });

    it('pages through the last result of a script', async () => {
        state.scripts[1].latestQueryId = 7;
        const table = arrow.tableFromArrays({ n: Int32Array.from({ length: 60 }, (_, i) => i) });
        connections.get('db').queriesFinished.set(7, { resultTable: table, error: null });
        const second = await run('result', { script: 'orders', page: 2 });
        expect(second.text).toContain('(rows 51-60 of 60)');
        await expect(run('result', { script: 'orders', page: 3 })).rejects.toThrow('orders has 60 rows, page 3 is empty');
        await expect(run('result', { script: 'customers' })).rejects.toThrow('Customers has no result');
    });
});

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

describe('agent visualize command', () => {
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
        runAgentCommand(env, { session: 's1', command: 'visualize', args: { script: 'orders', spec: typeof spec === 'string' ? spec : JSON.stringify(spec) } });

    it('writes a valid spec as the @vis vegalite tag of the last query', async () => {
        setup('/* @vis table */\nselect 1 as region, 2 as revenue');
        const result = await visualize({ mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } });
        expect(modify).toHaveBeenCalledExactlyOnceWith('s1', { type: SET_SCRIPT_TEXT, value: { scriptKey: 1, text: expect.any(String) } });
        expect(modify.mock.calls[0][1].value.text).toBe([
            '/* @vis vegalite',
            '   {',
            '     "mark": "bar",',
            '     "encoding": {',
            '       "x": {',
            '         "field": "region",',
            '         "type": "nominal"',
            '       },',
            '       "y": {',
            '         "field": "revenue",',
            '         "type": "quantitative"',
            '       }',
            '     }',
            '   } */',
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

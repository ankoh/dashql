import * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runAgentCommand, findScript, type AgentCommandEnvironment } from './agent_commands.js';
import { AgentCommandError } from '../../platform/agent/agent_client.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import { ConnectionHealth } from '../connections/connection_state.js';
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

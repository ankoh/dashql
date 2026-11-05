import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry } from '../../connections/connection_registry.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { QueryExecutionStatus, type QueryExecutionState } from '../../query/query_execution_state.js';
import { createScriptRef } from '../../session/scripts/script_types.js';
import { createEmptyScriptData, replaceScriptSessionText, scriptResultOwner, type SessionScripts } from '../../session/scripts/session_scripts.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry } from '../../session/scripts/session_scripts_registry.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { StorageWriter } from '../../storage/storage_writer.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';
import { createTestRoot } from '../../tests/react_root.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

/// A session s1 with the script orders.sql of the text
function session(text: string): [SessionScripts, number] {
    const connection = { connectionId: 'db', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: core.createCatalog() };
    const [scriptKey, scriptData] = createEmptyScriptData(core, connection, 'orders.sql');
    replaceScriptSessionText(scriptData.scriptSession, text);
    const sessionScripts = {
        sessionId: 's1',
        name: 'Orders',
        pendingConnection: null,
        instance: core,
        sessionMetadata: {},
        scripts: { [scriptKey]: scriptData },
        scriptRefs: { 'orders.sql': createScriptRef(scriptKey, 'orders.sql') },
        scriptOrder: ['orders.sql'],
        scriptFocus: { fileName: 'orders.sql' },
        semanticUserFocus: null,
    } as unknown as SessionScripts;
    return [sessionScripts, scriptKey];
}

/// A query result of the columns, owned by the script of the session
function query(columns: Record<string, unknown[]>, owner: string | null, status = QueryExecutionStatus.SUCCEEDED): QueryExecutionState {
    return {
        queryId: 1,
        status,
        resultTable: status === QueryExecutionStatus.SUCCEEDED ? tableFromArrays(columns) : null,
        queryMetadata: { sessionId: owner == null ? null : 's1', resultOwner: owner },
    } as unknown as QueryExecutionState;
}

type Registry = ReturnType<typeof useSessionScriptsRegistry>[0];

describe('QueryResultActionMenu', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    let registry: Registry | null = null;
    beforeEach(() => {
        vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
    });
    afterEach(() => {
        root?.unmount();
        root = null;
        registry = null;
        vi.restoreAllMocks();
        core.resetUnsafe();
    });

    function Seed(props: { sessions: SessionScripts[]; children: React.ReactElement }) {
        const [current, setRegistry] = useSessionScriptsRegistry();
        const [ready, setReady] = React.useState(false);
        registry = current;
        React.useEffect(() => {
            setRegistry(r => ({ ...r, sessionScriptsMap: new Map(props.sessions.map(s => [s.sessionId, s])) }));
            setReady(true);
        }, [props.sessions, setRegistry]);
        return ready ? props.children : null;
    }

    async function render(result: QueryExecutionState, sessions: SessionScripts[]) {
        root = createTestRoot();
        await act(async () => {
            root!.render(
                <LoggerProvider>
                    <StorageProvider backend={new SessionTestBackend()}>
                        <ConnectionRegistry>
                            <SessionScriptsRegistryProvider>
                                <Seed sessions={sessions}>
                                    <div data-testid="menu-host"><QueryResultActionMenu query={result} /></div>
                                </Seed>
                            </SessionScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>
            );
        });
        await act(async () => {
            await vi.waitFor(() => expect(root!.container.querySelector('[data-testid="menu-host"]')).not.toBeNull());
        });
    }

    const trigger = () => root!.container.querySelector<HTMLButtonElement>('[data-testid="query-result-more-actions"]');
    const item = () => document.querySelector<HTMLButtonElement>('[data-testid="query-result-project-columns"]');
    async function open() {
        await act(async () => { trigger()!.click(); });
        await act(async () => { await vi.waitFor(() => expect(item()).not.toBeNull()); });
    }
    const scriptText = (scriptKey: number) => registry!.sessionScriptsMap.get('s1')!.scripts[scriptKey].scriptSession.getText();

    it('has no menu for results without a script', async () => {
        const [sessionScripts] = session('select 1 as a');
        await render(query({ a: [1] }, null), [sessionScripts]);
        expect(trigger()).toBeNull();
    });

    it('cannot open the menu without a result', async () => {
        const [sessionScripts, scriptKey] = session('select 1 as a');
        await render(query({}, scriptResultOwner('s1', scriptKey), QueryExecutionStatus.FAILED), [sessionScripts]);
        expect(trigger()!.disabled).toBe(true);
    });

    it('stages the projection of the result columns as a diff of the script', async () => {
        const [sessionScripts, scriptKey] = session('select 1 as a, 2 as b');
        await render(query({ a: [1], b: [2] }, scriptResultOwner('s1', scriptKey)), [sessionScripts]);
        await open();
        expect(item()!.disabled).toBe(false);
        expect(item()!.textContent).toBe('Project Columns');

        await act(async () => { item()!.click(); });
        // The menu closes and the script gets the rewrite, the diff keeps the prior text
        await act(async () => { await vi.waitFor(() => expect(scriptText(scriptKey)).toContain('from base')); });
        expect(item()).toBeNull();
        expect(scriptText(scriptKey)).toBe(`with base as (
    select 1 as a, 2 as b
)
select a, b
from base`);
        expect(registry!.sessionScriptsMap.get('s1')!.scripts[scriptKey].pendingDiff?.priorText).toBe('select 1 as a, 2 as b');
    });

    it('says why a script cannot get the projection', async () => {
        const [noQuery, noQueryKey] = session('select 1 as a; drop table t;');
        await render(query({ a: [1] }, scriptResultOwner('s1', noQueryKey)), [noQuery]);
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project ColumnsThe last statement is no query');
        // Clicking the disabled item keeps the script
        await act(async () => { item()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(scriptText(noQueryKey)).toBe('select 1 as a; drop table t;');
        root!.unmount();

        const [noColumns, noColumnsKey] = session('select');
        await render(query({}, scriptResultOwner('s1', noColumnsKey)), [noColumns]);
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project ColumnsThe result has no columns');
    });

    it('disables the projection of a result whose script is gone', async () => {
        const [sessionScripts] = session('select 1 as a');
        await render(query({ a: [1] }, scriptResultOwner('s1', 999)), [sessionScripts]);
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project Columns');

        // Clicking the disabled item does not change the script
        await act(async () => { item()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(scriptText(Number(Object.keys(sessionScripts.scripts)[0]))).toBe('select 1 as a');
    });
});

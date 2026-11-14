import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry } from '../../connections/connection_registry.js';
import { CONNECTOR_INFOS, ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { QueryExecutionStatus, type QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import { createScriptRef } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import { createEmptyScriptData, replaceScriptSessionText, scriptResultOwner, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { WorkbookScriptsRegistryProvider, useWorkbookScriptsRegistry } from '../../workbook/scripts/workbook_scripts_registry.js';
import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';
import { tableFromArrays } from '@ankoh/dashql-runtime/testing/arrow_fixtures';
import { createTestRoot } from '../../tests/react_root.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

/// A workbook s1 with the script orders.sql of the text
function workbook(text: string): [WorkbookScripts, number] {
    const connection = { connectionId: 'db', connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: core.createCatalog() };
    const [scriptKey, scriptData] = createEmptyScriptData(core, connection, 'orders.sql');
    replaceScriptSessionText(scriptData.scriptSession, text);
    const workbookScripts = {
        workbookId: 's1',
        name: 'Orders',
        pendingConnection: null,
        instance: core,
        workbookMetadata: {},
        scripts: { [scriptKey]: scriptData },
        scriptRefs: { 'orders.sql': createScriptRef(scriptKey, 'orders.sql') },
        scriptOrder: ['orders.sql'],
        scriptFocus: { fileName: 'orders.sql' },
        semanticUserFocus: null,
    } as unknown as WorkbookScripts;
    return [workbookScripts, scriptKey];
}

/// A query result of the columns, owned by the script of the workbook
function query(columns: Record<string, unknown[]>, owner: string | null, status = QueryExecutionStatus.SUCCEEDED): QueryExecutionState {
    return {
        queryId: 1,
        status,
        resultTable: status === QueryExecutionStatus.SUCCEEDED ? tableFromArrays(columns) : null,
        queryMetadata: { workbookId: owner == null ? null : 's1', resultOwner: owner },
    } as unknown as QueryExecutionState;
}

type Registry = ReturnType<typeof useWorkbookScriptsRegistry>[0];

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

    function Seed(props: { workbooks: WorkbookScripts[]; children: React.ReactElement }) {
        const [current, setRegistry] = useWorkbookScriptsRegistry();
        const [ready, setReady] = React.useState(false);
        registry = current;
        React.useEffect(() => {
            setRegistry(r => ({ ...r, workbookScriptsMap: new Map(props.workbooks.map(s => [s.workbookId, s])) }));
            setReady(true);
        }, [props.workbooks, setRegistry]);
        return ready ? props.children : null;
    }

    async function render(result: QueryExecutionState, workbooks: WorkbookScripts[]) {
        root = createTestRoot();
        await act(async () => {
            root!.render(
                <LoggerProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <ConnectionRegistry>
                            <WorkbookScriptsRegistryProvider>
                                <Seed workbooks={workbooks}>
                                    <div data-testid="menu-host"><QueryResultActionMenu query={result} /></div>
                                </Seed>
                            </WorkbookScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>
            );
        });
        await act(async () => {
            await vi.waitFor(() => expect(root!.container.querySelector('[data-testid="menu-host"]')).not.toBeNull());
        });
    }

    it('renders nothing for a result without a script, outside of any provider', async () => {
        // The standalone shell has no storage and no workbook scripts
        root = createTestRoot();
        await act(async () => { root!.render(<QueryResultActionMenu query={query({ a: [1] }, null)} />); });
        expect(root.container.childElementCount).toBe(0);
    });

    const trigger = () => root!.container.querySelector<HTMLButtonElement>('[data-testid="query-result-more-actions"]');
    const item = () => document.querySelector<HTMLButtonElement>('[data-testid="query-result-project-columns"]');
    async function open() {
        await act(async () => { trigger()!.click(); });
        await act(async () => { await vi.waitFor(() => expect(item()).not.toBeNull()); });
    }
    const scriptText = (scriptKey: number) => registry!.workbookScriptsMap.get('s1')!.scripts[scriptKey].scriptSession.getText();

    it('has no menu for results without a script', async () => {
        const [workbookScripts] = workbook('select 1 as a');
        await render(query({ a: [1] }, null), [workbookScripts]);
        expect(trigger()).toBeNull();
    });

    it('cannot open the menu without a result', async () => {
        const [workbookScripts, scriptKey] = workbook('select 1 as a');
        await render(query({}, scriptResultOwner('s1', scriptKey), QueryExecutionStatus.FAILED), [workbookScripts]);
        expect(trigger()!.disabled).toBe(true);
    });

    it('stages the projection of the result columns as a diff of the script', async () => {
        const [workbookScripts, scriptKey] = workbook('select 1 as a, 2 as b');
        await render(query({ a: [1], b: [2] }, scriptResultOwner('s1', scriptKey)), [workbookScripts]);
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
        expect(registry!.workbookScriptsMap.get('s1')!.scripts[scriptKey].pendingDiff?.priorText).toBe('select 1 as a, 2 as b');
    });

    it('says why a script cannot get the projection', async () => {
        const [noQuery, noQueryKey] = workbook('select 1 as a; drop table t;');
        await render(query({ a: [1] }, scriptResultOwner('s1', noQueryKey)), [noQuery]);
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project ColumnsThe last statement is no query');
        // Clicking the disabled item keeps the script
        await act(async () => { item()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(scriptText(noQueryKey)).toBe('select 1 as a; drop table t;');
        root!.unmount();

        const [noColumns, noColumnsKey] = workbook('select');
        await render(query({}, scriptResultOwner('s1', noColumnsKey)), [noColumns]);
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project ColumnsThe result has no columns');
    });

    it('disables the projection of a result whose script is gone', async () => {
        const [workbookScripts] = workbook('select 1 as a');
        await render(query({ a: [1] }, scriptResultOwner('s1', 999)), [workbookScripts]);
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project Columns');

        // Clicking the disabled item does not change the script
        await act(async () => { item()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(scriptText(Number(Object.keys(workbookScripts.scripts)[0]))).toBe('select 1 as a');
    });
});

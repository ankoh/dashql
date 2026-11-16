import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { QueryExecutionStatus, type QueryExecutionState } from '@ankoh/dashql-runtime/query/query_execution_state';
import { scriptResultOwner } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import { tableFromArrays } from '@ankoh/dashql-runtime/testing/arrow_fixtures';
import { createTestRoot } from '../../tests/react_root.js';
import { QueryResultActionMenu } from './query_result_action_menu.js';
import { TestRuntime } from '../../tests/test_runtime.js';
import { useRuntime } from '../../runtime/runtime_hooks.js';
import { resultTableOf, WithResultTables } from '../../tests/result_tables.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let core: dashql.DashQL;
beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

/// The params of the embedded Hyper of the tests
const EMBEDDED = { hyper: { endpoint: '', protocol: 'WASM' } } as ConnectionParams;

/// A query result of the columns, owned by the script of the workbook
function query(columns: Record<string, unknown[]>, owner: string | null, status = QueryExecutionStatus.SUCCEEDED): QueryExecutionState {
    return {
        queryId: 1,
        status,
        resultTable: status === QueryExecutionStatus.SUCCEEDED ? resultTableOf(tableFromArrays(columns)) : null,
        queryMetadata: { workbookId: owner == null ? null : 's1', resultOwner: owner },
    } as unknown as QueryExecutionState;
}

describe('QueryResultActionMenu', () => {
    let root: ReturnType<typeof createTestRoot> | null = null;
    /// The runtime of the test and the key of the script orders.sql of the workbook s1
    let runtime: Runtime | null = null;
    let scriptKey = 0;
    afterEach(() => {
        root?.unmount();
        root = null;
        runtime = null;
        vi.restoreAllMocks();
        core.resetUnsafe();
    });

    /// Create the workbook s1 with the script orders.sql of the text in the runtime of the test
    function Seed(props: { text: string; children: React.ReactElement }) {
        const seeded = useRuntime();
        const [ready, setReady] = React.useState(false);
        React.useEffect(() => {
            runtime = seeded;
            createTestConnection(seeded, { connectionId: 'db', params: EMBEDDED });
            seeded.createWorkbook('db', 'Orders', false, undefined, 's1');
            seeded.dispatch({ workbook: 's1' }, { kind: 'createScript', value: { text: props.text, base: 'orders' } });
            seeded.flush();
            scriptKey = seeded.store.get('workbook', 's1')!.scriptKeys[0];
            setReady(true);
        }, [seeded, props.text]);
        return ready ? props.children : null;
    }

    async function render(text: string, result: (scriptKey: number) => QueryExecutionState) {
        root = createTestRoot();
        await act(async () => {
            root!.render(
                <LoggerProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <TestRuntime core={core}>
                            <Seed text={text}>
                                <Menu result={result} />
                            </Seed>
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>
            );
        });
        await act(async () => {
            await vi.waitFor(() => expect(root!.container.querySelector('[data-testid="menu-host"]')).not.toBeNull());
        });
    }

    function Menu(props: { result: (scriptKey: number) => QueryExecutionState }) {
        return <div data-testid="menu-host"><WithResultTables><QueryResultActionMenu query={props.result(scriptKey)} /></WithResultTables></div>;
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
    const scriptOf = (key: number) => {
        runtime!.flush();
        return runtime!.store.get('script', key)!;
    };
    const scriptText = (key: number) => scriptOf(key).scriptSession.getText();

    it('has no menu for results without a script', async () => {
        await render('select 1 as a', () => query({ a: [1] }, null));
        expect(trigger()).toBeNull();
    });

    it('cannot open the menu without a result', async () => {
        await render('select 1 as a', key => query({}, scriptResultOwner('s1', key), QueryExecutionStatus.FAILED));
        expect(trigger()!.disabled).toBe(true);
    });

    it('stages the projection of the result columns as a diff of the script', async () => {
        await render('select 1 as a, 2 as b', key => query({ a: [1], b: [2] }, scriptResultOwner('s1', key)));
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
        expect(scriptOf(scriptKey).pendingDiff?.priorText).toBe('select 1 as a, 2 as b');
    });

    it('says why a script cannot get the projection', async () => {
        await render('select 1 as a; drop table t;', key => query({ a: [1] }, scriptResultOwner('s1', key)));
        const noQueryKey = scriptKey;
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project ColumnsThe last statement is no query');
        // Clicking the disabled item keeps the script
        await act(async () => { item()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(scriptText(noQueryKey)).toBe('select 1 as a; drop table t;');
        root!.unmount();

        await render('select', key => query({}, scriptResultOwner('s1', key)));
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project ColumnsThe result has no columns');
    });

    it('disables the projection of a result whose script is gone', async () => {
        await render('select 1 as a', () => query({ a: [1] }, scriptResultOwner('s1', 999)));
        await open();
        expect(item()!.disabled).toBe(true);
        expect(item()!.textContent).toBe('Project Columns');

        // Clicking the disabled item does not change the script
        await act(async () => { item()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
        expect(scriptText(scriptKey)).toBe('select 1 as a');
    });
});

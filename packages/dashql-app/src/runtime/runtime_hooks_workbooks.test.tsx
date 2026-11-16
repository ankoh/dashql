import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql-core';

import type * as dashql from '@ankoh/dashql-core';
import type { ConnectionParams } from '@ankoh/dashql-platform/connections/connection_params';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import { createTestConnection } from '@ankoh/dashql-runtime/testing/connection_fixtures';
import { WorkbookTestBackend } from '@ankoh/dashql-platform/testing/workbook_test_backend';

import type { WorkbookScripts } from '@ankoh/dashql-platform/workbook/scripts/workbook_scripts';
import { LoggerProvider } from '../platform/logger/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { useDispatch, useRuntime, useScript, useWorkbook } from './runtime_hooks.js';
import { TestRuntime } from '../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// The params of the embedded Hyper of the tests
const EMBEDDED = { hyper: { endpoint: '', protocol: 'WASM' } } as ConnectionParams;
/// The ids of the workbooks of the test, UUIDs that storage accepts
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/// Create the workbooks with the script `1.sql` in the runtime, their keys are the keys that the tests read
function Seed(props: { onRuntime: (runtime: Runtime, keys: number[]) => void; children: React.ReactNode }) {
    const runtime = useRuntime();
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        createTestConnection(runtime, { connectionId: 'database', params: EMBEDDED });
        const keys = [A, B].map(workbookId => {
            runtime.createWorkbook('database', null, false, undefined, workbookId);
            runtime.dispatch({ workbook: workbookId }, { kind: 'createScript', value: { text: 'select 1', base: '1' } });
            runtime.flush();
            return runtime.store.get('workbook', workbookId)!.scriptKeys[0];
        });
        props.onRuntime(runtime, keys);
        setReady(true);
    }, [runtime]);
    return ready ? props.children : null;
}

/// A workbook and the dispatch of its actions
type ScriptsHook = [WorkbookScripts | null, (action: dashql.RuntimeAction) => dashql.DispatchOutcome];

function Consumer(props: { workbookId: string; scriptKey: number; capture: (scripts: ScriptsHook, latestQueryId: number | null) => void }) {
    const scripts: ScriptsHook = [useWorkbook(props.workbookId), useDispatch({ workbook: props.workbookId })];
    const script = useScript(props.scriptKey);
    React.useLayoutEffect(() => props.capture(scripts, script?.latestQueryId ?? null));
    return null;
}

// The actions of the workbooks are tested in the runtime (`runtime_workbooks.test.ts` of `dashql-core-js`), these are the
// hooks of the app on it
describe('the dispatch of a workbook', () => {
    it('keeps retained and current modifiers bound to their workbooks when a reused route dispatches', async () => {
        const backend = new WorkbookTestBackend();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let runtime!: Runtime;
        let keys: number[] = [];
        let current!: ScriptsHook;
        let latestQueryId: number | null = null;
        const capture = (scripts: ScriptsHook, queryId: number | null) => {
            current = scripts;
            latestQueryId = queryId;
        };
        const render = async (workbookId: string, scriptKey: number) => {
            await act(async () => {
                root.render(<LoggerProvider>
                    <StorageProvider backend={backend}>
                        <TestRuntime core={dql}>
                            <Seed onRuntime={(rt, k) => { runtime = rt; keys = k; }}>
                                {/* No key: changing the route id must reuse the hook */}
                                <Consumer workbookId={workbookId} scriptKey={scriptKey} capture={capture} />
                            </Seed>
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>);
            });
            await vi.waitFor(() => expect(current?.[0]?.workbookId).toBe(workbookId));
        };

        try {
            await render(A, 0);
            await render(A, keys[0]);
            const modifyA = current[1];
            await render(B, keys[1]);
            const modifyB = current[1];
            expect(modifyB).not.toBe(modifyA);

            // Both actions apply at once to their workbooks, the views follow with the next flush
            act(() => {
                expect(modifyA({ kind: 'registerQuery', value: { scriptKey: keys[0], queryId: 101 } }).ok).toBe(true);
                expect(modifyB({ kind: 'registerQuery', value: { scriptKey: keys[1], queryId: 202 } }).ok).toBe(true);
            });
            await vi.waitFor(() => expect(latestQueryId).toBe(202));
            expect(runtime.store.get('script', keys[0])?.latestQueryId).toBe(101);

            // A rename is written into the workbook file of its workbook
            act(() => {
                modifyA({ kind: 'renameWorkbook', value: { name: 'Offline workbook' } });
            });
            await runtime.storage.flush();
            expect((await backend.loadWorkbook(A)).name).toBe('Offline workbook');
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    });
});

import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@akohn/dashql';

import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';

import { LoggerProvider, useLogger } from '../platform/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { useDispatch, useRuntime } from '@akohn/dashql-react/hooks';
import { TestRuntime } from '../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// Hand the runtime, the logger and a dispatch of the app to the test
function Probe(props: { capture: (runtime: Runtime, logger: Logger, dispatch: (action: core.WorkbookAction) => core.DispatchOutcome) => void }) {
    const runtime = useRuntime();
    const logger = useLogger();
    const dispatch = useDispatch({ workbook: 'unknown' });
    React.useLayoutEffect(() => props.capture(runtime, logger, dispatch));
    return null;
}

describe('the runtime of the app', () => {
    it('lives through StrictMode and goes with the component', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const runtimes = new Set<Runtime>();
        let current: Runtime | null = null;
        try {
            await act(async () => {
                root.render(<React.StrictMode>
                    <LoggerProvider>
                        <StorageProvider backend={new WorkbookTestBackend()}>
                            <TestRuntime core={dql}>
                                <Probe capture={runtime => { runtimes.add(runtime); current = runtime; }} />
                            </TestRuntime>
                        </StorageProvider>
                    </LoggerProvider>
                </React.StrictMode>);
            });
            // StrictMode runs the effects twice, the app keeps one runtime that lives
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(runtimes.size).toBe(1);
            expect(current!.destroyed).toBe(false);
            expect(current!.connection('none')).toBeNull();
        } finally {
            act(() => root.unmount());
            container.remove();
        }
        await vi.waitFor(() => expect(current!.destroyed).toBe(true));
    });

    it('logs an action that it refuses once', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let logger!: Logger;
        let dispatch!: (action: core.WorkbookAction) => core.DispatchOutcome;
        try {
            await act(async () => {
                root.render(<LoggerProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <TestRuntime core={dql}>
                            <Probe capture={(_runtime, l, d) => { logger = l; dispatch = d; }} />
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>);
            });
            const warn = vi.spyOn(logger, 'warn');
            const error = vi.spyOn(logger, 'error');
            expect(dispatch({ kind: 'renameWorkbook', value: { name: 'Refused' } }).ok).toBe(false);
            expect(warn.mock.calls.length + error.mock.calls.length).toBe(1);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    });
});

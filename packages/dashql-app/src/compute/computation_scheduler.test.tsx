import { vi } from 'vitest';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';

import type { ComputeQueryExecution } from '@ankoh/dashql-runtime/compute/compute_platform';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { ComputationScheduler } from './computation_scheduler.js';
import { CoreRuntimeProvider } from '../runtime/runtime_hooks.js';
import { ComputeQueryExecutionProvider } from './compute_query_execution.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('ComputationScheduler', () => {
    let container: HTMLDivElement;
    let root: Root | null;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        if (root != null) act(() => root!.unmount());
        container.remove();
    });

    it('tracks the queries of the tasks with the query execution of the provider above', async () => {
        const executeQuery = vi.fn() as unknown as ComputeQueryExecution;
        const createExecution = vi.fn(() => executeQuery);
        const setQueryExecution = vi.fn();
        const computations = { setQueryExecution } as unknown as CoreRuntime;

        await act(async () => {
            root!.render(
                <CoreRuntimeProvider value={computations}>
                    <ComputeQueryExecutionProvider createExecution={createExecution}>
                        <ComputationScheduler />
                    </ComputeQueryExecutionProvider>
                </CoreRuntimeProvider>,
            );
        });
        expect(setQueryExecution).toHaveBeenLastCalledWith(createExecution);

        act(() => root!.unmount());
        root = null;
        expect(setQueryExecution).toHaveBeenLastCalledWith(null);
    });
});

import { vi } from 'vitest';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';

import type { ComputeQueryExecution } from '@ankoh/dashql-runtime/compute/computation_tasks';
import type { Computations } from '@ankoh/dashql-runtime/compute/computations';
import { ComputationScheduler } from './computation_scheduler.js';
import { ComputationsProvider } from './computation_registry.js';
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
        const computations = { setQueryExecution } as unknown as Computations;

        await act(async () => {
            root!.render(
                <ComputationsProvider value={computations}>
                    <ComputeQueryExecutionProvider createExecution={createExecution}>
                        <ComputationScheduler />
                    </ComputeQueryExecutionProvider>
                </ComputationsProvider>,
            );
        });
        expect(setQueryExecution).toHaveBeenLastCalledWith(createExecution);

        act(() => root!.unmount());
        root = null;
        expect(setQueryExecution).toHaveBeenLastCalledWith(null);
    });
});

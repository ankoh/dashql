import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { useDataflowModule, type DataflowModule } from './dataflow_module.js';

describe('useDataflowModule', () => {
    function renderHook() {
        const states: DataflowModule[] = [];
        const Probe = () => {
            states.push(useDataflowModule());
            return null;
        };
        const root = createRoot(document.createElement('div'));
        act(() => root.render(<Probe />));
        return { states, root };
    }

    // The module is loaded once for the page, other test files may have loaded it already
    it('loads the module', async () => {
        const { states, root } = renderHook();
        await act(async () => {
            await vi.waitFor(() => expect(states[states.length - 1].layout).not.toBeNull(), { timeout: 10_000 });
        });
        expect(states[states.length - 1].error).toBeNull();
        act(() => root.unmount());
    });

    it('ignores a load that completes after unmounting', async () => {
        const { states, root } = renderHook();
        act(() => root.unmount());
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(states).toEqual([{ layout: null, error: null }]);
    });
});

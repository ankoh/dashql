import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { fakeButtonModule, fakeSymbolIconModule } from '../../../test/view_mocks.js';

vi.mock('../../../ui/foundations/button.js', async () => fakeButtonModule(await import('react')));
vi.mock('../../../ui/foundations/symbol_icon.js', async () => fakeSymbolIconModule(await import('react')));
vi.mock('../compute/ui/query_result/query_result_details.js', async () => {
    const React = await import('react');
    return { QueryResultDetails: () => React.createElement('div', null, 'Query results') };
});

import { QueryExecutionStatus } from '../connections/query_execution_state.js';
import { ShellQueryResultOverlay } from './shell_query_result_overlay.js';

describe('ShellQueryResultOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    it('does not dismiss on outside mouse events when disabled', () => {
        const onClose = vi.fn();
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                onClose={onClose}
                dismissOnClickOutside={false}
            />,
        ));

        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onClose).not.toHaveBeenCalled();
        expect(document.querySelector('[aria-label="Shell query results"]')).not.toBeNull();
    });

    it('retains outside mouse dismissal by default', () => {
        const onClose = vi.fn();
        act(() => root.render(
            <ShellQueryResultOverlay
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                onClose={onClose}
            />,
        ));

        act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })));

        expect(onClose).toHaveBeenCalledOnce();
    });
});

import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { createResultSearchState } from '../../../../../compute/computation_types.js';
import { QueryResultSearchControls } from './query_result_search_controls.js';

describe('QueryResultSearchControls', () => {
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
    });

    const button = (kind: 'columns' | 'data') => container.querySelector<HTMLButtonElement>(`[data-testid="search-${kind}-button"]`);
    const input = (kind: 'columns' | 'data') => container.querySelector<HTMLInputElement>(`[data-testid="search-${kind}-input"]`);
    const closeButton = (kind: 'columns' | 'data') => container.querySelector<HTMLButtonElement>(`[data-testid="search-${kind}-close"]`);
    const status = (kind: 'columns' | 'data') => container.querySelector<HTMLElement>(`[data-testid="search-${kind}-status"]`);

    it('replaces each button with a search-icon input', () => {
        act(() => root.render(
            <QueryResultSearchControls
                columnSearch={createResultSearchState()}
                dataSearch={createResultSearchState()}
                onColumnPatternChange={() => {}}
                onDataPatternChange={() => {}}
                columnMatchCount={null}
                dataMatchCount={null}
            />,
        ));
        act(() => button('columns')!.click());
        expect(button('columns')).toBeNull();
        expect(input('columns')).not.toBeNull();
        expect(input('columns')?.getAttribute('aria-label')).toBeTruthy();
        expect(closeButton('columns')).not.toBeNull();

        act(() => button('data')!.click());
        expect(input('data')).not.toBeNull();
        expect(button('data')).toBeNull();
    });

    it('collapses an empty input when it loses focus', () => {
        act(() => root.render(
            <QueryResultSearchControls
                columnSearch={createResultSearchState()}
                dataSearch={createResultSearchState()}
                onColumnPatternChange={() => {}}
                onDataPatternChange={() => {}}
                columnMatchCount={null}
                dataMatchCount={null}
            />,
        ));
        act(() => button('columns')!.click());
        act(() => input('columns')!.blur());
        expect(input('columns')).toBeNull();
        expect(button('columns')).not.toBeNull();
    });

    it('keeps an active search visible when Escape is pressed', () => {
        const columnSearch = { ...createResultSearchState(), requestedPattern: 'customer' };
        act(() => root.render(
            <QueryResultSearchControls
                columnSearch={columnSearch}
                dataSearch={createResultSearchState()}
                onColumnPatternChange={() => {}}
                onDataPatternChange={() => {}}
                columnMatchCount={2}
                dataMatchCount={null}
            />,
        ));
        act(() => input('columns')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(input('columns')).not.toBeNull();
        expect(status('columns')?.textContent).toContain('2');
    });

    it('starts expanded when remounted with an active Data search', () => {
        const dataSearch = { ...createResultSearchState(), requestedPattern: 'customer' };

        act(() => root.render(
            <QueryResultSearchControls
                columnSearch={createResultSearchState()}
                dataSearch={dataSearch}
                onColumnPatternChange={() => {}}
                onDataPatternChange={() => {}}
                columnMatchCount={null}
                dataMatchCount={2}
            />,
        ));

        expect(input('data')?.value).toBe('customer');
        expect(button('data')).toBeNull();
    });

    it('clears and collapses an active search from its close button', () => {
        const onColumnPatternChange = vi.fn();
        const columnSearch = { ...createResultSearchState(), requestedPattern: 'customer' };
        act(() => root.render(
            <QueryResultSearchControls
                columnSearch={columnSearch}
                dataSearch={createResultSearchState()}
                onColumnPatternChange={onColumnPatternChange}
                onDataPatternChange={() => {}}
                columnMatchCount={2}
                dataMatchCount={null}
            />,
        ));
        act(() => closeButton('columns')!.click());

        expect(onColumnPatternChange).toHaveBeenCalledWith('');
        expect(input('columns')).toBeNull();
        expect(button('columns')).not.toBeNull();
    });
});

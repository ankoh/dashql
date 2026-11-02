import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import type { QueryExecutionState } from '../../query/query_execution_state.js';
import { TableColumnHeader } from '../../views/query_result/data_table_cell.js';
import { ResultTableOverlay, type ResultTableOverlayDependencies } from './result_table_overlay.js';

const detailsProps: any[] = [];
const dependencies: ResultTableOverlayDependencies = {
    QueryResultDetails: (props: any) => {
        detailsProps.push(props);
        return <div data-testid="mock-query-results">Query results</div>;
    },
};
const query = { queryId: 42 } as unknown as QueryExecutionState;

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-testid="result-table-overlay"]');
}

describe('ResultTableOverlay', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        detailsProps.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows the result table with its column plots under a header with the script name', () => {
        act(() => root.render(<ResultTableOverlay scriptName="01_alpha" query={query} onClose={vi.fn()} dependencies={dependencies} />));
        expect(dialog()?.getAttribute('role')).toBe('dialog');
        expect(dialog()?.getAttribute('aria-modal')).toBe('true');
        expect(dialog()?.querySelector('h2')?.textContent).toBe('01_alpha');
        expect(dialog()?.querySelector('[data-testid="mock-query-results"]')).not.toBeNull();
        const props = detailsProps[detailsProps.length - 1];
        expect(props.query).toBe(query);
        expect(props.columnHeader).toBe(TableColumnHeader.WithColumnPlots);
        expect(props.fitHeight).toBe(true);
    });

    it('enlarges the card to the window and restores it', () => {
        act(() => root.render(<ResultTableOverlay scriptName="01_alpha" query={query} onClose={vi.fn()} dependencies={dependencies} />));
        const resize = document.querySelector<HTMLButtonElement>('[data-testid="result-table-overlay-resize"]')!;
        expect(resize.getAttribute('aria-pressed')).toBe('false');
        expect(dialog()?.hasAttribute('data-expanded')).toBe(false);

        act(() => resize.click());
        expect(resize.getAttribute('aria-pressed')).toBe('true');
        expect(dialog()?.hasAttribute('data-expanded')).toBe(true);
        expect(dialog()?.parentElement?.getAttribute('data-expanded')).toBe('true');
        // The enlarged table fills the card instead of fitting its rows
        expect(detailsProps[detailsProps.length - 1].fitHeight).toBe(false);

        act(() => resize.click());
        expect(dialog()?.hasAttribute('data-expanded')).toBe(false);
        expect(detailsProps[detailsProps.length - 1].fitHeight).toBe(true);
    });

    it('closes with the close button and with Escape', () => {
        const onClose = vi.fn();
        act(() => root.render(<ResultTableOverlay scriptName="01_alpha" query={query} onClose={onClose} dependencies={dependencies} />));
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="result-table-overlay-close"]')!.click());
        expect(onClose).toHaveBeenCalledTimes(1);
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

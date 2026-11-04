import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { CellFocus, DataTableFocusStore, useCellFocus } from './data_table_focus.js';

describe('DataTableFocusStore', () => {
    it('focuses the hovered cell and its row', () => {
        const store = new DataTableFocusStore();
        expect(store.getFocus(0, 0)).toBe(CellFocus.None);
        store.setFocus(3, 1);
        expect(store.getFocus(3, 1)).toBe(CellFocus.Primary);
        expect(store.getFocus(3, 2)).toBe(CellFocus.Secondary);
        expect(store.getFocus(2, 1)).toBe(CellFocus.None);
        store.setFocus(null, null);
        expect(store.getFocus(3, 1)).toBe(CellFocus.None);
    });

    it('notifies only the previous and the next row', () => {
        const store = new DataTableFocusStore();
        const rows = [vi.fn(), vi.fn(), vi.fn()];
        rows.forEach((listener, row) => store.subscribe(row, listener));

        store.setFocus(0, 0);
        expect(rows.map(l => l.mock.calls.length)).toEqual([1, 0, 0]);
        // The same cell again changes nothing
        store.setFocus(0, 0);
        expect(rows.map(l => l.mock.calls.length)).toEqual([1, 0, 0]);
        // Another cell of the same row notifies the row once
        store.setFocus(0, 1);
        expect(rows.map(l => l.mock.calls.length)).toEqual([2, 0, 0]);
        store.setFocus(2, 1);
        expect(rows.map(l => l.mock.calls.length)).toEqual([3, 0, 1]);
        store.setFocus(null, null);
        expect(rows.map(l => l.mock.calls.length)).toEqual([3, 0, 2]);
    });

    it('stops notifying after unsubscribing', () => {
        const store = new DataTableFocusStore();
        const first = vi.fn();
        const second = vi.fn();
        const unsubscribeFirst = store.subscribe(1, first);
        const unsubscribeSecond = store.subscribe(1, second);
        unsubscribeFirst();
        store.setFocus(1, 0);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledOnce();
        unsubscribeSecond();
        unsubscribeSecond();
        store.setFocus(null, null);
        expect(second).toHaveBeenCalledOnce();
    });
});

describe('useCellFocus', () => {
    it('re-renders a cell when its focus changes', () => {
        const store = new DataTableFocusStore();
        const focus: CellFocus[] = [];
        const Cell = (props: { row: number; field: number }) => {
            focus.push(useCellFocus(store, props.row, props.field));
            return null;
        };
        const container = document.createElement('div');
        const root = createRoot(container);
        act(() => root.render(<Cell row={1} field={2} />));
        expect(focus).toEqual([CellFocus.None]);
        act(() => store.setFocus(1, 2));
        expect(focus[focus.length - 1]).toBe(CellFocus.Primary);
        act(() => store.setFocus(1, 0));
        expect(focus[focus.length - 1]).toBe(CellFocus.Secondary);
        const renders = focus.length;
        // Another row does not render the cell
        act(() => store.setFocus(4, 0));
        expect(focus[focus.length - 1]).toBe(CellFocus.None);
        act(() => store.setFocus(5, 0));
        expect(focus.length).toBe(renders + 1);
        act(() => root.unmount());
    });
});

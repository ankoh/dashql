import * as arrow from 'apache-arrow';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComputationColumnGroup } from '@akohn/dashql';
import { ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN } from '@akohn/dashql/platform/compute/computation_types';
import { tableFromArrays, vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';

import { LoggerContext } from '../../logger.js';
import { mockTableComputation, valueColumn } from '../../testing/computation_mocks.js';
import { fakeComputationModel } from '../../testing/fake_models.js';
import { act, waitForRender } from '../../testing/react_act.js';
import { createTestRoot } from '../../testing/react_root.js';
import { DataTable, TableColumnHeader, type CellDetailProps } from './data_table.js';

// The data table on its own: a model of a computation and nothing of a runtime or an app, the way another host shows it

/// A computation of the table 1 with a row number, an ordinal column `id` and a string column `name`
function nameTable() {
    const numbers = tableFromArrays({ rownum: Int32Array.from([0, 1, 2]), id: Int32Array.from([7, 8, 9]) });
    // Plain text, the fixtures would encode strings as a dictionary
    const table = new arrow.Table({
        rownum: numbers.getChild('rownum')!,
        id: numbers.getChild('id')!,
        name: vectorFromArray(['alpha', 'beta', 'gamma'], new arrow.Utf8()),
    });
    const columnGroups: ComputationColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        { type: ORDINAL_COLUMN, value: valueColumn('id', 'Int32', { inputFieldNullable: false }) },
        { type: STRING_COLUMN, value: valueColumn('name', 'Utf8') },
    ];
    const computation = mockTableComputation(columnGroups, { dataTableRows: 3 });
    return fakeComputationModel(computation, new Map([[1, table]]));
}

describe('DataTable', () => {
    let root: ReturnType<typeof createTestRoot>;
    beforeEach(() => {
        root = createTestRoot();
        root.container.style.width = '600px';
        root.container.style.height = '300px';
    });
    afterEach(() => root.unmount());

    function render(element: React.ReactElement) {
        return root.render(<LoggerContext.Provider value={new TestLogger()}>{element}</LoggerContext.Provider>);
    }

    it('shows the rows of the table of a model', async () => {
        const model = nameTable();
        await render(<DataTable model={model} debugMode={false} columnHeader={TableColumnHeader.OnlyColumnName} fillHeight />);
        // The grid renders its rows once it measured its host, the headers in portals after it
        await waitForRender(() => {
            const text = root.container.textContent ?? '';
            for (const value of ['id', 'name', 'alpha', 'beta', 'gamma', '9']) {
                expect(text).toContain(value);
            }
        });
    });

    it('asks the model to order by a column', async () => {
        const model = nameTable();
        await render(<DataTable model={model} debugMode={false} columnHeader={TableColumnHeader.OnlyColumnName} fillHeight />);
        await waitForRender(() => {
            expect(root.container.querySelector('button[aria-label^="Sort name"]')).not.toBeNull();
        });
        const sort = root.container.querySelector<HTMLButtonElement>('button[aria-label^="Sort name"]');
        act(() => sort!.click());
        expect(model.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'orderBy' }));
    });

    it('shows the rows that a preview leaves out in place, or opens the full table without a host that can', async () => {
        const model = nameTable();
        const onShowTable = vi.fn();
        const onShowMoreRows = vi.fn();
        const onShowFewerRows = vi.fn();
        const footerRow = (testId: string) => root.container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

        // The preview of the first row counts the two others, the row shows them in place
        await render(<DataTable model={model} debugMode={false} maxRows={1} onShowTable={onShowTable} onShowMoreRows={onShowMoreRows} onShowFewerRows={onShowFewerRows} />);
        expect(footerRow('data-table-more-rows')?.textContent).toBe('2 more rows');
        expect(footerRow('data-table-fewer-rows')).toBeNull();
        act(() => footerRow('data-table-more-rows')!.click());
        expect(onShowMoreRows).toHaveBeenCalledTimes(1);
        expect(onShowTable).not.toHaveBeenCalled();

        // Without a host that shows them in place, the row opens the full table
        await render(<DataTable model={model} debugMode={false} maxRows={1} onShowTable={onShowTable} />);
        act(() => footerRow('data-table-more-rows')!.click());
        expect(onShowTable).toHaveBeenCalledTimes(1);

        // All rows in place end with the row that shows fewer rows again
        await render(<DataTable model={model} debugMode={false} fitHeight maxHeight={200} onShowTable={onShowTable} onShowMoreRows={onShowMoreRows} onShowFewerRows={onShowFewerRows} />);
        expect(footerRow('data-table-more-rows')).toBeNull();
        act(() => footerRow('data-table-fewer-rows')!.click());
        expect(onShowFewerRows).toHaveBeenCalledTimes(1);
    });

    it('opens the detail of a cell in the slot of the host', async () => {
        const model = nameTable();
        const opened: CellDetailProps[] = [];
        const CellDetail = (props: CellDetailProps) => {
            if (props.isOpen) opened.push(props);
            return null;
        };
        await render(<DataTable model={model} debugMode={false} columnHeader={TableColumnHeader.OnlyColumnName} fillHeight cellDetail={CellDetail} />);
        await waitForRender(() => {
            expect(Array.from(root.container.querySelectorAll('[role="gridcell"]')).some(element => element.textContent === 'beta')).toBe(true);
        });
        const cell = Array.from(root.container.querySelectorAll<HTMLElement>('[role="gridcell"]'))
            .find(element => element.textContent === 'beta');
        expect(cell).toBeDefined();
        act(() => cell!.click());
        expect(opened.at(-1)?.formattedValue).toBe('beta');
        expect(opened.at(-1)?.columnName).toBe('name');
    });
});

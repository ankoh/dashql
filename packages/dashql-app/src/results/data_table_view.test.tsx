import * as arrow from 'apache-arrow';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComputationColumnGroup } from '@akohn/dashql';
import { ORDINAL_COLUMN, ROWNUMBER_COLUMN, STRING_COLUMN } from '@akohn/dashql/platform/compute/computation_types';
import { tableFromArrays, vectorFromArray } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { mockTableComputation, valueColumn } from '@akohn/dashql-react/testing/computation_mocks';
import { fakeComputationModel } from '@akohn/dashql-react/testing/fake_models';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';

import { AppConfigProvider, useAppConfig, useAppReconfigure, type AppConfig } from '../config/app_config.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { LoggerProvider } from '../host/logger_provider.js';
import { DataTableView } from './data_table_view.js';

/// A computation with a row number, an ordinal column `score` with its bins and a string column `name` with its value ids
function binnedTable() {
    const numbers = tableFromArrays({
        rownum: Int32Array.from([0, 1, 2]),
        score: Int32Array.from([7, 8, 9]),
        score_bin: Int32Array.from([0, 1, 1]),
        name_id: Int32Array.from([0, 1, 2]),
    });
    const table = new arrow.Table({
        rownum: numbers.getChild('rownum')!,
        score: numbers.getChild('score')!,
        score_bin: numbers.getChild('score_bin')!,
        name: vectorFromArray(['alpha', 'beta', 'gamma'], new arrow.Utf8()),
        name_id: numbers.getChild('name_id')!,
    });
    const columnGroups: ComputationColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        { type: ORDINAL_COLUMN, value: valueColumn('score', 'Int32', { inputFieldNullable: false, binFieldName: 'score_bin', binCount: 2 }) },
        { type: STRING_COLUMN, value: valueColumn('name', 'Utf8', { inputFieldNullable: false, valueIdFieldName: 'name_id' }) },
    ];
    const computation = mockTableComputation(columnGroups, { dataTableRows: 3 });
    return fakeComputationModel(computation, new Map([[1, table]]));
}

describe('DataTableView', () => {
    let root: ReturnType<typeof createTestRoot>;
    let config: AppConfig | null;
    let reconfigure: ReturnType<typeof useAppReconfigure>;

    function Capture() {
        config = useAppConfig();
        reconfigure = useAppReconfigure();
        return null;
    }

    beforeEach(() => {
        root = createTestRoot();
        root.container.style.width = '800px';
        root.container.style.height = '300px';
        config = null;
    });
    afterEach(() => root.unmount());

    async function render() {
        const model = binnedTable();
        await root.render(
            <LoggerProvider>
                <FlavorProvider requested={null}>
                    <AppConfigProvider>
                        <>
                            <Capture />
                            <DataTableView model={model} columnHeader={TableColumnHeader.OnlyColumnName} fillHeight />
                        </>
                    </AppConfigProvider>
                </FlavorProvider>
            </LoggerProvider>,
        );
        // The settings come from config.json
        await vi.waitFor(() => expect(config).not.toBeNull());
    }

    const headerText = () => root.container.textContent ?? '';

    it('shows the system columns in the table debug mode of the settings', async () => {
        await render();
        await waitForRender(() => expect(headerText()).toContain('alpha'));
        expect(headerText()).not.toContain('score_bin');
        expect(headerText()).not.toContain('name_id');

        act(() => reconfigure(c => c == null ? null : { ...c, settings: { ...c.settings, tableDebugMode: true } }));
        await waitForRender(() => {
            expect(headerText()).toContain('score_bin');
            expect(headerText()).toContain('name_id');
        });

        act(() => reconfigure(c => c == null ? null : { ...c, settings: { ...c.settings, tableDebugMode: false } }));
        await waitForRender(() => expect(headerText()).not.toContain('score_bin'));
    });
});

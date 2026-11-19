import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const mockState = {
    computationState: {
        tableComputations: {},
    } as any,
    dispatch: vi.fn(),
    download: vi.fn(),
    logError: vi.fn(),
};

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { QueryResultDetails, type QueryResultDetailsDependencies } from './query_result_details.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { resultTableOf, WithResultTables } from '../../tests/result_tables.js';

const dependencies = {
    QueryResultToolbar: () => null,
    QueryResultActionMenu: () => null,
    QueryResultView: () => <div data-testid="query-result-view" />,
    useComputation: ((tableId: number | null | undefined) => tableId == null ? null : mockState.computationState.tableComputations[tableId] ?? null) as never,
    useComputationDispatch: (() => mockState.dispatch) as never,
    useQueryResultRowCounts: () => ({ totalRows: 3, currentRows: 3, matchingRows: null }),
    QueryResultDownloadButton: props => <QueryResultDownloadButton {...props} dependencies={{
        useFileDownloader: () => ({ downloadBufferAsFile: mockState.download }),
        useLogger: () => ({ error: mockState.logError }),
        useComputeDatabase: () => null,
        exportArrowTableAsParquet: vi.fn(),
    }} />,
} as QueryResultDetailsDependencies;

function downloadButton(container: HTMLElement): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>('[data-testid="download-query-result"]')!;
}

function clearCrossFiltersButton(container: HTMLElement): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('[data-testid="clear-cross-filters"]');
}

function downloadFormatItem(format: 'arrow' | 'parquet'): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(`[data-testid="download-format-${format}"]`);
}

async function downloadArrow(button: HTMLButtonElement) {
    act(() => button.click());
    await act(async () => downloadFormatItem('arrow')!.click());
}

describe('QueryResultDetails', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        mockState.dispatch.mockReset();
        mockState.download.mockReset().mockResolvedValue(undefined);
        mockState.logError.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('clears all active cross-filters from the query results bar', () => {
        const crossFilters = [{ kind: 'mostFrequent', column: 1, valueId: 7 }];
        mockState.computationState = {
            tableComputations: {
                42: {
                    dataTable: { numRows: 3 },
                    crossFilters,
                },
            },
        };

        act(() => root.render(
            <WithResultTables><QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                debugMode={false}
                actions={<button type="button" data-testid="test-action">Close</button>}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        const clearButton = clearCrossFiltersButton(container);
        expect(clearButton).not.toBeNull();
        expect(clearButton!.disabled).toBe(false);
        expect(container.querySelector('[data-testid="test-action"]')).not.toBeNull();

        act(() => clearButton!.click());

        expect(mockState.dispatch).toHaveBeenCalledTimes(1);
        expect(mockState.dispatch.mock.calls[0][0]).toEqual({ kind: 'clearCrossFilters' });
    });

    it('disables the clear action when no cross-filters are active', () => {
        mockState.computationState = {
            tableComputations: {
                42: {
                    dataTable: { numRows: 3 },
                    crossFilters: [],
                },
            },
        };

        act(() => root.render(
            <WithResultTables><QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED } as any}
                debugMode={false}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        expect(clearCrossFiltersButton(container)?.disabled).toBe(true);
    });

    it('downloads the complete original result as an Arrow IPC file without computed columns', async () => {
        const resultTable = tableFromArrays({ value: [10, 20, 30] });
        mockState.computationState = {
            tableComputations: {
                42: {
                    dataTable: tableFromArrays({ _rownum: [1, 2, 3], value: [10, 20, 30], _1_bin: [0, 1, 2] }),
                    crossFilters: [],
                    filterTable: { dataTable: tableFromArrays({ _rownum: [2] }) },
                },
            },
        };
        act(() => root.render(
            <WithResultTables><QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED, resultTable: resultTableOf(resultTable) } as any}
                debugMode={false}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        const button = downloadButton(container);
        expect(button.disabled).toBe(false);
        await downloadArrow(button);

        expect(mockState.download).toHaveBeenCalledTimes(1);
        const [bytes, filename] = mockState.download.mock.calls[0];
        expect(filename).toBe('query-result-42.arrow');
        expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('ARROW1');
        const exported = arrow.tableFromIPC(bytes);
        expect(exported.schema.fields.map(field => field.name)).toEqual(['value']);
        expect(Array.from(exported.getChild('value')!)).toEqual([10, 20, 30]);
    });

    it('disables download until a successful result table exists', () => {
        mockState.computationState = { tableComputations: {} };
        const render = (status: QueryExecutionStatus, resultTable: arrow.Table | null) => act(() => root.render(
            <WithResultTables><QueryResultDetails
                query={{ queryId: 42, status, resultTable: resultTableOf(resultTable) } as any}
                debugMode={false}
                dependencies={dependencies}
            /></WithResultTables>,
        ));
        const button = () => downloadButton(container);

        render(QueryExecutionStatus.RUNNING, tableFromArrays({ value: [1] }));
        expect(button().disabled).toBe(true);
        render(QueryExecutionStatus.SUCCEEDED, null);
        expect(button().disabled).toBe(true);
        expect(mockState.download).not.toHaveBeenCalled();
    });

    it('disables the Parquet download without a compute database', () => {
        mockState.computationState = { tableComputations: {} };
        act(() => root.render(
            <WithResultTables><QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED, resultTable: resultTableOf(tableFromArrays({ value: [1] })) } as any}
                debugMode={false}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        act(() => downloadButton(container).click());
        expect(downloadFormatItem('arrow')?.disabled).toBe(false);
        expect(downloadFormatItem('parquet')?.disabled).toBe(true);
    });

    it('reports download failures and re-enables the action', async () => {
        mockState.computationState = { tableComputations: {} };
        mockState.download.mockRejectedValueOnce(new Error('Disk full'));
        act(() => root.render(
            <WithResultTables><QueryResultDetails
                query={{ queryId: 42, status: QueryExecutionStatus.SUCCEEDED, resultTable: resultTableOf(tableFromArrays({ value: [1] })) } as any}
                debugMode={false}
                dependencies={dependencies}
            /></WithResultTables>,
        ));

        const button = downloadButton(container);
        await downloadArrow(button);

        expect(mockState.logError).toHaveBeenCalledWith(expect.any(String), { format: 'arrow', error: 'Disk full' }, 'query_result_download');
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        await downloadArrow(button);
        expect(mockState.download).toHaveBeenCalledTimes(2);
    });
});

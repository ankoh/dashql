import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act } from '../../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionStatus, type QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { Logger } from '@akohn/dashql/platform/logger/logger';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { TableDetails } from './query_result_details.js';
import { QueryResultDownloadButton } from './query_result_download_button.js';
import { LoggerContext } from '../../logger.js';
import { HostProvider, type DownloadFile } from '../../host.js';
import { fakeComputationModel, fakeQueryModel } from '../../testing/fake_models.js';
import { mockTableComputation, recordingDispatch } from '../../testing/computation_mocks.js';
import type { QueryModel } from '../../models/query_model.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const download = vi.fn<DownloadFile>();
const logError = vi.fn();

/// The model of query 42 with a result and the computation of its table
function model(status: QueryExecutionStatus, result: arrow.Table | null, crossFilters: unknown[] = [], dispatch = recordingDispatch().dispatch): QueryModel {
    const computation = fakeComputationModel(mockTableComputation([], { crossFilters } as never), new Map(), { dispatch });
    return fakeQueryModel({ queryId: 42, status } as QueryExecutionState, { result, computation });
}

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

describe('TableDetails', () => {
    let container: HTMLDivElement;
    let root: Root;

    /// The details of a model with the download of its result, without a database that writes Parquet
    const render = (current: QueryModel, actions?: React.ReactNode) => act(() => root.render(
        <LoggerContext.Provider value={{ error: logError } as unknown as Logger}>
            <HostProvider value={{ setupCore: null, downloadFile: download }}>
                <TableDetails
                    title="Query Results"
                    computation={current.computation}
                    resultTable={current.result}
                    actions={<><QueryResultDownloadButton model={current} exportParquet={null} />{actions}</>}
                    table={() => <div data-testid="query-result-view" />}
                />
            </HostProvider>
        </LoggerContext.Provider>,
    ));

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        download.mockReset().mockResolvedValue(undefined);
        logError.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('clears all active cross-filters from the query results bar', () => {
        const { dispatch } = recordingDispatch();
        render(
            model(QueryExecutionStatus.SUCCEEDED, null, [{ kind: 'mostFrequent', column: 1, valueIds: [7] }], dispatch),
            <button type="button" data-testid="test-action">Close</button>,
        );

        const clearButton = clearCrossFiltersButton(container);
        expect(clearButton).not.toBeNull();
        expect(clearButton!.disabled).toBe(false);
        expect(container.querySelector('[data-testid="test-action"]')).not.toBeNull();

        act(() => clearButton!.click());

        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0][0]).toEqual({ kind: 'clearCrossFilters' });
    });

    it('disables the clear action when no cross-filters are active', () => {
        render(model(QueryExecutionStatus.SUCCEEDED, null));
        expect(clearCrossFiltersButton(container)?.disabled).toBe(true);
    });

    it('downloads the complete original result as an Arrow IPC file without computed columns', async () => {
        render(model(QueryExecutionStatus.SUCCEEDED, tableFromArrays({ value: [10, 20, 30] })));

        const button = downloadButton(container);
        expect(button.disabled).toBe(false);
        await downloadArrow(button);

        expect(download).toHaveBeenCalledTimes(1);
        const [bytes, filename] = download.mock.calls[0] as [Uint8Array, string];
        expect(filename).toBe('query-result-42.arrow');
        expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('ARROW1');
        const exported = arrow.tableFromIPC(bytes);
        expect(exported.schema.fields.map(field => field.name)).toEqual(['value']);
        expect(Array.from(exported.getChild('value')!)).toEqual([10, 20, 30]);
    });

    it('disables download until a successful result table exists', () => {
        const button = () => downloadButton(container);
        render(model(QueryExecutionStatus.RUNNING, tableFromArrays({ value: [1] })));
        expect(button().disabled).toBe(true);
        render(model(QueryExecutionStatus.SUCCEEDED, null));
        expect(button().disabled).toBe(true);
        expect(download).not.toHaveBeenCalled();
    });

    it('downloads the complete result as Parquet through the export of the host', async () => {
        const resultTable = tableFromArrays({ value: [10, 20, 30] });
        const parquet = new TextEncoder().encode('PAR1');
        const exportParquet = vi.fn(async () => parquet);
        const current = model(QueryExecutionStatus.SUCCEEDED, resultTable);
        act(() => root.render(
            <HostProvider value={{ setupCore: null, downloadFile: download }}>
                <QueryResultDownloadButton model={current} exportParquet={exportParquet} />
            </HostProvider>,
        ));
        act(() => downloadButton(container).click());
        await act(async () => downloadFormatItem('parquet')!.click());

        expect(exportParquet).toHaveBeenCalledWith(resultTable);
        expect(download).toHaveBeenCalledWith(parquet, 'query-result-42.parquet');
    });

    it('disables the Parquet download without a compute database', () => {
        render(model(QueryExecutionStatus.SUCCEEDED, tableFromArrays({ value: [1] })));
        act(() => downloadButton(container).click());
        expect(downloadFormatItem('arrow')?.disabled).toBe(false);
        expect(downloadFormatItem('parquet')?.disabled).toBe(true);
    });

    it('reports download failures and re-enables the action', async () => {
        download.mockRejectedValueOnce(new Error('Disk full'));
        render(model(QueryExecutionStatus.SUCCEEDED, tableFromArrays({ value: [1] })));

        const button = downloadButton(container);
        await downloadArrow(button);

        expect(logError).toHaveBeenCalledWith(expect.any(String), { format: 'arrow', error: 'Disk full' }, 'query_result_download');
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        await downloadArrow(button);
        expect(download).toHaveBeenCalledTimes(2);
    });
});

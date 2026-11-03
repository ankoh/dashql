import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import { ComputationRegistry } from '../../compute/computation_registry.js';
import { QueryResultDownloadButton } from '../../views/query_result/query_result_download_button.js';
import { ChartDownloadButton } from '../../views/visualization/chart_download_button.js';
import type { ResolvedVisualizeQuery } from '../scripts/script_types.js';
import { FeedEntryFooter, FeedEntryTabStrip, useFeedEntryTabs, type FeedEntryFooterDependencies } from './feed_entry_footer.js';
import type { QueryExecutionState } from '../../query/query_execution_state.js';
import { tableFromArrays } from '../../tests/arrow_fixtures.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const download = vi.fn();
const exportParquet = vi.fn();
const computeDatabase = { registerExternalDirectory: vi.fn(), removeExternalDirectory: vi.fn() };
const onShowTable = vi.fn();
const renderPng = vi.fn();
const dependencies = {
    useResultRowCount: () => ({ hasResult: true, totalRows: 3 }),
    useQueryResultRowCounts: () => ({ totalRows: 3, currentRows: 3, matchingRows: null }),
    QueryResultToolbar: () => null,
    QueryResultView: () => <div data-testid="feed-preview" />,
    QueryResultDownloadButton: props => <QueryResultDownloadButton {...props} dependencies={{
        useFileDownloader: () => ({ downloadBufferAsFile: download }),
        useLogger: () => ({ error: vi.fn() }),
        useComputeDatabase: () => computeDatabase as any,
        exportArrowTableAsParquet: exportParquet,
    }} />,
    ChartDownloadButton: props => <ChartDownloadButton {...props} dependencies={{
        useFileDownloader: () => ({ downloadBufferAsFile: download }),
        useLogger: () => ({ error: vi.fn() }),
        renderVegaLitePng: renderPng,
    }} />,
} as FeedEntryFooterDependencies;

/// The feed row owns the tab selection, the strip sits in the status bar and the panel below it
const FooterWithTabs: React.FC<{ queryState: QueryExecutionState; visualizeQuery: ResolvedVisualizeQuery | null }> = ({ queryState, visualizeQuery }) => {
    const tabs = useFeedEntryTabs(queryState, visualizeQuery, dependencies);
    return (
        <>
            <FeedEntryTabStrip tabs={tabs} />
            <FeedEntryFooter
                sessionId="session"
                queryState={queryState}
                visualizeQuery={visualizeQuery}
                selectedTab={tabs.selectedTab}
                onShowTable={onShowTable}
                dependencies={dependencies}
            />
        </>
    );
};

describe('FeedEntryFooter', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        download.mockReset().mockResolvedValue(undefined);
        exportParquet.mockReset();
        onShowTable.mockReset();
        renderPng.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderFooter(resultTable: arrow.Table, visualizeQuery: ResolvedVisualizeQuery | null = null) {
        // The chart of the visualization tab reads the computations of the results
        act(() => root.render(
            <ComputationRegistry>
                <FooterWithTabs
                    queryState={{ queryId: 42, traceId: 9, status: QueryExecutionStatus.SUCCEEDED, resultTable } as any}
                    visualizeQuery={visualizeQuery}
                />
            </ComputationRegistry>,
        ));
    }

    async function chooseDownloadFormat(format: 'arrow' | 'parquet') {
        const button = container.querySelector<HTMLButtonElement>('[data-testid="download-query-result"]')!;
        expect(button).not.toBeNull();
        expect(button.disabled).toBe(false);
        act(() => button.click());
        const item = document.querySelector<HTMLButtonElement>(`[data-testid="download-format-${format}"]`)!;
        expect(item).not.toBeNull();
        await act(async () => item.click());
    }

    it('downloads the full original result as Arrow from the feed header without opening Details', async () => {
        const resultTable = tableFromArrays({ value: [10, 20, 30] });
        renderFooter(resultTable);
        expect(container.querySelector('[data-testid="feed-preview"]')).not.toBeNull();

        await chooseDownloadFormat('arrow');

        expect(onShowTable).not.toHaveBeenCalled();
        expect(download).toHaveBeenCalledTimes(1);
        const [bytes, filename] = download.mock.calls[0];
        expect(filename).toBe('query-result-42.arrow');
        expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('ARROW1');
        const exported = arrow.tableFromIPC(bytes);
        expect(exported.schema.fields.map(field => field.name)).toEqual(['value']);
        expect(Array.from(exported.getChild('value')!)).toEqual([10, 20, 30]);
    });

    it('opens Details from the expand button beside the download button', () => {
        renderFooter(tableFromArrays({ value: [10, 20, 30] }));
        const download = container.querySelector('[data-testid="download-query-result"]')!;
        const expand = container.querySelector<HTMLButtonElement>('[data-testid="tab-header-expand"]')!;
        expect(expand).not.toBeNull();
        expect(download.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        act(() => expand.click());

        expect(onShowTable).toHaveBeenCalledTimes(1);
    });

    it('downloads the full original result as Parquet through the compute database', async () => {
        const resultTable = tableFromArrays({ value: [10, 20, 30] });
        const parquet = new TextEncoder().encode('PAR1');
        exportParquet.mockResolvedValue(parquet);
        renderFooter(resultTable);

        await chooseDownloadFormat('parquet');

        expect(exportParquet).toHaveBeenCalledWith(computeDatabase, resultTable);
        expect(download).toHaveBeenCalledWith(parquet, 'query-result-42.parquet');
    });

    it('downloads the chart as PNG from the visualization header', async () => {
        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as any;
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        renderPng.mockResolvedValue({ png, width: 1600, height: 1000 });
        renderFooter(tableFromArrays({ value: [10, 20, 30] }), { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec });
        expect(container.querySelector('[data-testid="download-query-result"]')).toBeNull();

        const button = container.querySelector<HTMLButtonElement>('[data-testid="download-chart-png"]')!;
        expect(button).not.toBeNull();
        await act(async () => button.click());

        expect(renderPng).toHaveBeenCalledWith(vegaLiteSpec, [{ value: 10 }, { value: 20 }, { value: 30 }]);
        expect(download).toHaveBeenCalledWith(png, 'chart-42.png');
    });

    it('shows a chart that the result gets after it is shown as table', async () => {
        const resultTable = tableFromArrays({ value: [10, 20, 30] });
        renderFooter(resultTable);
        expect(container.querySelector('[data-testid="download-query-result"]')).not.toBeNull();

        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as any;
        renderFooter(resultTable, { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec });

        // The tab switches in an effect
        await vi.waitFor(() => expect(container.querySelector('[data-testid="download-chart-png"]')).not.toBeNull());
        expect(container.querySelector('[data-testid="download-query-result"]')).toBeNull();
    });

    it('lists the usable tabs and switches the panel from the tab strip', () => {
        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as any;
        renderFooter(tableFromArrays({ value: [10, 20, 30] }), { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec });
        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual(['Execution log', 'Query results', 'Visualization']);
        expect(tabs[2].getAttribute('aria-selected')).toBe('true');

        act(() => tabs[1].click());

        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('[data-testid="download-query-result"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="download-chart-png"]')).toBeNull();
    });
});

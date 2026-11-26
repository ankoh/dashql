import * as arrow from 'apache-arrow';
import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';

import type { ResolvedVisualizeQuery } from '@akohn/dashql/platform/workbook/script_types';
import * as dashql from '@akohn/dashql';
import { FEED_PROFILE_HEIGHT, FeedEntryFooter, FeedEntryTab, FeedEntryTabStrip, useFeedEntryTabs } from './feed_entry_footer.js';
import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { RuntimeContextProvider } from '@akohn/dashql-react/hooks';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';
import { projectQueryProgress } from '@akohn/dashql/platform/query/query_progress';
import { HostProvider, type DownloadFile } from '@akohn/dashql-react/host';
import type { QueryModel } from '@akohn/dashql-react/models/query_model';
import { fakeComputationModel, fakeQueryModel } from '@akohn/dashql-react/testing/fake_models';
import { mockTableComputation, valueColumn } from '@akohn/dashql-react/testing/computation_mocks';
import { ORDINAL_COLUMN, ROWNUMBER_COLUMN } from '@akohn/dashql/platform/compute/computation_types';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const download = vi.fn<DownloadFile>();
const onShowTable = vi.fn();

/// The model of query 42 that succeeded with a result of a column `value`, analyzed by its computation: the data frame
/// with the row numbers that the result table shows
function succeeded(resultTable: arrow.Table): QueryModel {
    const query = { queryId: 42, traceId: 9, status: QueryExecutionStatus.SUCCEEDED, queryMetadata: {}, resultTable: { id: 1, rows: resultTable.numRows } } as unknown as QueryExecutionState;
    const rownum = tableFromArrays({ rownum: Int32Array.from({ length: resultTable.numRows }, (_, row) => row) }).getChild('rownum')!;
    const dataFrame = new arrow.Table({ rownum, value: resultTable.getChild('value')! });
    const columnGroups: dashql.ComputationColumnGroup[] = [
        { type: ROWNUMBER_COLUMN, value: { rowNumberFieldName: 'rownum' } },
        { type: ORDINAL_COLUMN, value: valueColumn('value', String(resultTable.schema.fields[0].type)) },
    ];
    const computation = fakeComputationModel(mockTableComputation(columnGroups, { dataTableRows: resultTable.numRows }), new Map([[1, dataFrame]]));
    return fakeQueryModel(query, { result: resultTable, computation });
}

/// The feed row owns the tab selection, the strip sits in the status bar and the panel below it
const FooterWithTabs: React.FC<{ model: QueryModel; visualizeQuery: ResolvedVisualizeQuery | null }> = ({ model, visualizeQuery }) => {
    const tabs = useFeedEntryTabs(model, visualizeQuery);
    return (
        <>
            <FeedEntryTabStrip tabs={tabs} />
            <FeedEntryFooter
                workbookId="workbook"
                model={model}
                visualizeQuery={visualizeQuery}
                selectedTab={tabs.selectedTab}
                onShowTable={onShowTable}
            />
        </>
    );
};

describe('FeedEntryFooter', () => {
    // The runtime of the footer is created with the core
    beforeAll(async () => { await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        download.mockReset().mockResolvedValue(undefined);
        onShowTable.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderFooter(resultTable: arrow.Table, visualizeQuery: ResolvedVisualizeQuery | null = null) {
        act(() => root.render(
            <StandaloneRuntime>
                <HostProvider value={{ setupCore: null, downloadFile: download }}>
                    <FooterWithTabs model={succeeded(resultTable)} visualizeQuery={visualizeQuery} />
                </HostProvider>
            </StandaloneRuntime>,
        ));
    }

    it('opens Details from the expand button beside the download button', () => {
        renderFooter(tableFromArrays({ value: [10, 20, 30] }));
        const download = container.querySelector('[data-testid="download-query-result"]')!;
        const expand = container.querySelector<HTMLButtonElement>('[data-testid="tab-header-expand"]')!;
        expect(expand).not.toBeNull();
        expect(download.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        act(() => expand.click());

        expect(onShowTable).toHaveBeenCalledTimes(1);
    });

    it('shows more rows in place with the column plots and shows the first rows again', async () => {
        const model = succeeded(tableFromArrays({ value: Array.from({ length: 10 }, (_, row) => row) }));
        const onShowMoreRows = vi.fn();
        const onShowFewerRows = vi.fn();
        const renderTable = (moreRows: boolean) => act(() => root.render(
            <StandaloneRuntime>
                <HostProvider value={{ setupCore: null, downloadFile: download }}>
                    <FeedEntryFooter
                        workbookId="workbook"
                        model={model}
                        visualizeQuery={null}
                        selectedTab={FeedEntryTab.Table}
                        onShowTable={onShowTable}
                        moreRows={moreRows}
                        onShowMoreRows={onShowMoreRows}
                        onShowFewerRows={onShowFewerRows}
                    />
                </HostProvider>
            </StandaloneRuntime>,
        ));
        const testId = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

        // The preview counts the rows that it leaves out, the row shows them in place instead of opening the full table
        renderTable(false);
        expect(container.textContent).toContain('6 of 10 rows');
        expect(testId('data-table-more-rows')?.textContent).toBe('4 more rows');
        act(() => testId('data-table-more-rows')!.click());
        expect(onShowMoreRows).toHaveBeenCalledTimes(1);
        expect(onShowTable).not.toHaveBeenCalled();

        // All rows scroll below the column plots and end with the row that shows the first rows again
        renderTable(true);
        expect(container.textContent).toContain('10 rows');
        expect(container.textContent).not.toContain('6 of 10 rows');
        expect(testId('data-table-more-rows')).toBeNull();
        await vi.waitFor(() => expect(container.querySelector('[aria-label="Hide column plots"], [aria-label="Show column plots"]')).not.toBeNull());
        act(() => testId('data-table-fewer-rows')!.click());
        expect(onShowFewerRows).toHaveBeenCalledTimes(1);

        // The header still opens the full table
        act(() => testId('tab-header-expand')!.click());
        expect(onShowTable).toHaveBeenCalledTimes(1);
    });

    it('offers the chart as PNG in the visualization header', () => {
        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as Extract<ResolvedVisualizeQuery, { renderer: 'vegalite' }>['vegaLiteSpec'];
        renderFooter(tableFromArrays({ value: [10, 20, 30] }), { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec });
        expect(container.querySelector('[data-testid="download-query-result"]')).toBeNull();
        expect(container.querySelector<HTMLButtonElement>('[data-testid="download-chart-png"]')?.disabled).toBe(false);
    });

    it('shows a chart that the result gets after it is shown as table', async () => {
        const resultTable = tableFromArrays({ value: [10, 20, 30] });
        renderFooter(resultTable);
        expect(container.querySelector('[data-testid="download-query-result"]')).not.toBeNull();

        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as Extract<ResolvedVisualizeQuery, { renderer: 'vegalite' }>['vegaLiteSpec'];
        renderFooter(resultTable, { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec });

        // The tab switches in an effect
        await vi.waitFor(() => expect(container.querySelector('[data-testid="download-chart-png"]')).not.toBeNull());
        expect(container.querySelector('[data-testid="download-query-result"]')).toBeNull();
    });

    it('lists the usable tabs and switches the panel from the tab strip', () => {
        const vegaLiteSpec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as Extract<ResolvedVisualizeQuery, { renderer: 'vegalite' }>['vegaLiteSpec'];
        renderFooter(tableFromArrays({ value: [10, 20, 30] }), { renderer: 'vegalite', sql: 'select 1', statementId: 0, vegaLiteSpec });
        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual(['Execution log', 'Query results', 'Visualization']);
        expect(tabs[2].getAttribute('aria-selected')).toBe('true');

        act(() => tabs[1].click());

        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('[data-testid="download-query-result"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="download-chart-png"]')).toBeNull();
    });

    it('selects the progress of a running query and places it right of the log', () => {
        // A query with a profile, without a runtime that reads it the plan is not known yet
        const queryState = {
            queryId: 43,
            traceId: 10,
            status: QueryExecutionStatus.RUNNING,
            metrics: { queryRequestedAt: Date.now() },
            latestProgressUpdate: { phase: 'RUNNING', profile: { structure: new Uint8Array(0), execution: null, revision: 1, structureVersion: 1 } },
        } as unknown as QueryExecutionState;
        const model = fakeQueryModel(queryState);
        const Footer = () => {
            const tabs = useFeedEntryTabs(model, null);
            return (
                <>
                    <FeedEntryTabStrip tabs={tabs} />
                    <FeedEntryFooter workbookId="workbook" model={model} visualizeQuery={null} selectedTab={tabs.selectedTab} />
                </>
            );
        };
        act(() => root.render(<Footer />));
        const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        expect(tabs.map(tab => tab.getAttribute('aria-label'))).toEqual(['Execution log', 'Query progress']);
        expect(tabs[1].getAttribute('aria-selected')).toBe('true');
        expect(container.querySelector('[data-testid="query-progress-panel"]')?.textContent).toContain('Running');
        // Without operators, the plan is not known yet and there is no tree
        expect(container.querySelector('[data-testid="query-progress-profile"]')).toBeNull();
    });

    it('shows the plan of a running query as a tree in the progress tab', async () => {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        const plan = { id: '1', name: 'Output', children: [{ id: '2', name: 'TableScan', descriptor: { table: 'tpch:sf1:lineitem' }, children: [] }] };
        const info = { queryId: 'q', stages: { stages: [{ stageId: 'q.0', plan: { jsonRepresentation: JSON.stringify(plan) } }] } };
        const recording = { version: 1, payloads: [{ elapsedMs: 0, payload: { kind: 'trino_query_info', info, receivedAt: 1 } }] };
        // The progress of the query as its view holds it, the runtime reads it with its core
        const profileView = core.replayQueryProgress(JSON.stringify(recording), Number.MAX_SAFE_INTEGER);
        const latestProgressUpdate = { phase: 'RUNNING', profile: profileView } as unknown as dashql.QueryLatestProgressView;
        const queryState = {
            queryId: 44,
            traceId: 11,
            status: QueryExecutionStatus.RUNNING,
            metrics: { queryRequestedAt: Date.now() },
            latestProgressUpdate,
            progress: projectQueryProgress(core, latestProgressUpdate, null, null),
        } as unknown as QueryExecutionState;
        act(() => root.render(
            <RuntimeContextProvider value={testRuntime(core)}>
                <FeedEntryFooter workbookId="workbook" model={fakeQueryModel(queryState)} visualizeQuery={null} selectedTab={FeedEntryTab.Progress} />
            </RuntimeContextProvider>,
        ));
        const profile = container.querySelector<HTMLElement>('[data-testid="query-progress-profile"]');
        expect(profile?.style.height).toEqual(`${FEED_PROFILE_HEIGHT}px`);
        expect(profile?.querySelector('[aria-label="Query execution plan with 2 operators"]')).not.toBeNull();
        act(() => root.unmount());
        root = createRoot(container);
        core.resetUnsafe();
    });
});

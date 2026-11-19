import * as React from 'react';
import { act } from '../../testing/react_act.js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopLevelSpec } from 'vega-lite';

import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { ChartDownloadButton } from './chart_download_button.js';
import { HostProvider, type DownloadFile } from '../../host.js';
import { fakeQueryModel } from '../../testing/fake_models.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('ChartDownloadButton', () => {
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

    it('downloads the chart of the result as PNG through the host', async () => {
        const spec = { mark: 'bar', encoding: { x: { field: 'value', type: 'ordinal' } } } as TopLevelSpec;
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        const renderVegaLitePng = vi.fn(async () => ({ png, width: 1600, height: 1000 }));
        const download = vi.fn<DownloadFile>().mockResolvedValue();
        const model = fakeQueryModel({ queryId: 42, status: QueryExecutionStatus.SUCCEEDED }, { result: tableFromArrays({ value: [10, 20, 30] }) });
        act(() => root.render(
            <HostProvider value={{ setupCore: null, downloadFile: download }}>
                <ChartDownloadButton model={model} spec={spec} dependencies={{ renderVegaLitePng }} />
            </HostProvider>,
        ));

        await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="download-chart-png"]')!.click());

        expect(renderVegaLitePng).toHaveBeenCalledWith(spec, [{ value: 10 }, { value: 20 }, { value: 30 }]);
        expect(download).toHaveBeenCalledWith(png, 'chart-42.png');
    });
});

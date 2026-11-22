import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CsvFormat, CsvSchema } from '@akohn/csv-sniffer';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { CsvFileCard, CsvTableCard, type CsvConversionState, type CsvSampleState, type CsvTableState } from './csv_file_card.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const FILE = { name: 'orders.csv', size: 4 * 1048576 };

const FORMAT: CsvFormat = {
    encoding: 'windows-1252',
    transcoded: true,
    bom: false,
    delimiter: '\t',
    quote: '"',
    hasHeader: true,
    preambleRows: 1,
    dataOffset: 12,
    columns: 2,
};

const SCHEMA: CsvSchema = {
    columns: [
        { name: 'id', type: 'BIGINT', datePattern: null, nullValues: ['NA', ''], nulls: 2, values: 1 },
        { name: 'day', type: 'DATE', datePattern: 'DD/MM/YYYY', nullValues: [], nulls: 0, values: 3 },
    ],
    rows: 3,
    dataEnd: 100,
    bytes: 100,
    preview: [['1', '31/01/2024'], [null, '01/02/2024']],
    problems: ['1 row of 3 has another number of fields than the 2 columns, the first is row 3. Hyper can\'t read these rows.'],
    sampled: true,
};

const SAMPLED: CsvSampleState = { status: 'sampled', format: FORMAT, schema: SCHEMA };
const CONVERTED: CsvConversionState = {
    status: 'converted',
    parts: [
        { rows: 1000, bytes: 2048, types: ['BIGINT', 'DATE'] },
        { rows: 1500, bytes: 4096, types: ['TEXT', 'DATE'] },
    ],
    milliseconds: 500,
};

describe('CsvFileCard', () => {
    let root: ReturnType<typeof createTestRoot>;
    beforeEach(() => { root = createTestRoot(); });
    afterEach(() => root.unmount());

    const render = (sample: CsvSampleState, conversion: CsvConversionState = { status: 'idle' }, table: CsvTableState = { status: 'idle' }, handlers = { onConvert: vi.fn(), onLoad: vi.fn() }) =>
        root.render(<CsvFileCard file={FILE} sample={sample} conversion={conversion} table={table} {...handlers} />);
    const button = (text: string) => [...root.container.querySelectorAll('button')].find(b => b.textContent?.includes(text));
    const texts = (selector: string) => [...root.container.querySelectorAll(selector)].map(element => element.textContent);

    it('shows why a file cannot be read', async () => {
        await render({ status: 'sampling' });
        expect(root.container.textContent).toContain('Sampling the file');
        await render({ status: 'failed', error: 'orders.csv can\'t be read as CSV: empty' });
        expect(root.container.querySelector('[role="alert"]')!.textContent).toContain('empty');
        expect(button('Convert')).toBeUndefined();
    });

    it('shows the format, the schema of the sample, the preview and the problems, and converts the file', async () => {
        const handlers = { onConvert: vi.fn(), onLoad: vi.fn() };
        await render(SAMPLED, { status: 'idle' }, { status: 'idle' }, handlers);
        expect(texts('ul[aria-label="Format"] li')).toEqual([
            'windows-1252, decoded to UTF-8', 'delimiter tab', 'quote "', 'header', '1 line skipped before the data',
        ]);
        expect(root.container.textContent).toContain('Schema of a sample');
        expect(texts('table[aria-label="Schema"] tbody tr')).toEqual(['idBIGINT2NULL: NA, ""', 'dayDATE0DD/MM/YYYY']);
        expect(texts('table[aria-label="Preview"] tbody td')).toEqual(['1', '31/01/2024', 'NULL', '01/02/2024']);
        expect(texts('[role="alert"]')).toEqual(SCHEMA.problems);
        await act(async () => button('Convert to Parquet')!.click());
        expect(handlers.onConvert).toHaveBeenCalledOnce();
    });

    it('shows the progress of the conversion and its parts, and loads them', async () => {
        await render(SAMPLED, { status: 'converting', bytesRead: 1048576, workers: 4 });
        expect(root.container.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('25');
        expect(root.container.textContent).toContain('Converting with 4 workers');
        expect(button('Convert')).toBeUndefined();

        const handlers = { onConvert: vi.fn(), onLoad: vi.fn() };
        await render(SAMPLED, CONVERTED, { status: 'idle' }, handlers);
        expect(root.container.textContent).toContain('2,500 rows');
        expect(root.container.querySelector('[role="status"]')!.textContent).toContain('2 files, 6.14 kB in 0.50 s (8 MiB/s of CSV)');
        // A part that widened a column names it
        expect(texts('table[aria-label="Parts"] tbody tr')).toEqual(['11,0002.05 kB', '21,5004.1 kBid TEXT']);
        await act(async () => button('Load into Hyper')!.click());
        expect(handlers.onLoad).toHaveBeenCalledOnce();

        await render(SAMPLED, CONVERTED, { status: 'loading' });
        expect(button('Loading into Hyper')!.disabled).toBe(true);
        await render(SAMPLED, CONVERTED, { status: 'failed', error: 'could not read from external source' });
        expect(texts('[role="alert"]')).toContain('could not read from external source');
        await render(SAMPLED, CONVERTED, { status: 'ready', tableId: 1, rows: 2500, columns: 2 });
        expect(button('Load into Hyper')).toBeUndefined();
    });

    it('shows a failed conversion and converts again', async () => {
        const handlers = { onConvert: vi.fn(), onLoad: vi.fn() };
        await render(SAMPLED, { status: 'failed', error: 'The conversion failed: no space' }, { status: 'idle' }, handlers);
        expect(texts('[role="alert"]')).toContain('The conversion failed: no space');
        await act(async () => button('Convert to Parquet')!.click());
        expect(handlers.onConvert).toHaveBeenCalledOnce();
    });
});

describe('CsvTableCard', () => {
    it('renders the table and opens the full table', async () => {
        const root = createTestRoot();
        const onShowTable = vi.fn();
        await root.render(
            <CsvTableCard
                fileName="orders.csv"
                table={{ tableId: 7, rows: 1200, columns: 2 }}
                onShowTable={onShowTable}
                renderTable={tableId => <div data-testid="table">table {tableId}</div>}
            />,
        );
        expect(root.container.textContent).toContain('1,200 rows, 2 columns');
        expect(root.container.querySelector('[data-testid="table"]')!.textContent).toBe('table 7');
        await act(async () => root.container.querySelector<HTMLButtonElement>('button[aria-label="Open the table of orders.csv"]')!.click());
        expect(onShowTable).toHaveBeenCalledOnce();
        root.unmount();
    });
});

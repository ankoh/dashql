import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { HyperDB } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { LoggerProvider } from '../../host/logger_provider.js';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { createTestHyperDB, withoutTermination } from '../../tests/hyperdb_test_client.js';
import { CsvImportPage } from './csv_import_page.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let database: HyperDB;
let disposeDatabase: (() => Promise<void>) | null = null;
beforeAll(async () => {
    ({ database, dispose: disposeDatabase } = await createTestHyperDB('dashql-csv-import'));
}, 60_000);
afterAll(async () => {
    await disposeDatabase?.();
});

/// A CSV file with a comment before its header, NULL words, dates with the day first and a blank line at its end
const ORDERS = [
    '# orders of the shop\n',
    'id;customer;amount;ordered\n',
    '1;Ann;12.5;31/01/2024\n',
    '2;Bob;NA;01/02/2024\n',
    '3;"Carl; Jr.";7.25;15/02/2024\n',
    '\n',
];

describe('CsvImportPage', () => {
    let root: ReturnType<typeof createTestRoot>;
    let runtime: Runtime | null;

    function Capture() {
        runtime = useRuntime();
        return null;
    }

    beforeEach(async () => {
        runtime = null;
        root = createTestRoot();
        root.container.style.width = '1000px';
        await root.render(
            <LoggerProvider>
                <EmbeddedDatabaseProvider setupDatabase={async () => withoutTermination(database)}>
                    <StandaloneRuntime>
                        <Capture />
                        <CsvImportPage />
                    </StandaloneRuntime>
                </EmbeddedDatabaseProvider>
            </LoggerProvider>,
        );
    });
    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    /// Drop a file on the page
    const drop = (file: File) => act(async () => {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        root.container.querySelector('main')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    const texts = (selector: string) => [...root.container.querySelectorAll(selector)].map(element => element.textContent);
    const button = (text: string) => [...root.container.querySelectorAll('button')].find(b => b.textContent?.includes(text));
    const tableCard = () => root.container.querySelector<HTMLElement>('section[aria-label="Table of orders.csv"]');
    const cells = () => [...tableCard()?.querySelectorAll('[role="gridcell"]') ?? []].map(cell => cell.textContent).join('|');
    const computations = () => runtime!.store.all('computation').size;

    it('samples a dropped file, converts it with workers and loads the Parquet files into Hyper', async () => {
        expect(root.container.textContent).toContain('Drop a CSV file');
        await drop(new File(ORDERS, 'orders.csv', { type: 'text/csv' }));
        await act(async () => {
            await vi.waitFor(() => expect(root.container.querySelector('table[aria-label="Schema"]')).not.toBeNull(), { timeout: 10_000 });
        });
        expect(texts('table[aria-label="Schema"] tbody td:nth-child(2)')).toEqual(['BIGINT', 'TEXT', 'DOUBLE PRECISION', 'DATE']);
        expect(texts('ul[aria-label="Format"] li')).toContain('delimiter ;');
        expect(texts('ul[aria-label="Format"] li')).toContain('1 line skipped before the data');
        expect(texts('table[aria-label="Preview"] tbody tr')).toHaveLength(3);
        expect(root.container.querySelector('[role="alert"]')).toBeNull();

        // A worker converts the small file into one Parquet file in the origin private file system
        await act(async () => button('Convert to Parquet')!.click());
        await act(async () => {
            await vi.waitFor(() => expect(root.container.querySelector('table[aria-label="Parts"]')).not.toBeNull(), { timeout: 20_000 });
        });
        expect(texts('table[aria-label="Parts"] tbody tr')).toHaveLength(1);
        expect(root.container.querySelector('[role="status"]')!.textContent).toContain('1 file');
        expect(computations()).toBe(0);

        await act(async () => button('Load into Hyper')!.click());
        await act(async () => {
            await vi.waitFor(() => expect(cells()).toContain('Carl; Jr.'), { timeout: 10_000 });
        });
        expect(tableCard()!.textContent).toContain('3 rows, 4 columns');
        expect(cells()).toContain('Ann');
        expect(button('Load into Hyper')).toBeUndefined();
        expect(computations()).toBe(1);

        // The button of the table card opens the full table over the page
        const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Table of orders.csv"]');
        await act(async () => tableCard()!.querySelector<HTMLButtonElement>('button[aria-label="Open the table of orders.csv"]')!.click());
        await act(async () => {
            await vi.waitFor(() => expect(dialog()?.textContent).toContain('Carl; Jr.'));
        });
        await act(async () => dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close table"]')!.click());
        expect(dialog()).toBeNull();

        // Another file replaces the entry and deletes its computation
        await drop(new File(['a,b\n1,2\n'], 'other.csv'));
        await act(async () => {
            await vi.waitFor(() => expect(computations()).toBe(0));
        });
        expect(tableCard()).toBeNull();
    }, 40_000);

    it('reports a file that is no CSV', async () => {
        await drop(new File([], 'empty.csv'));
        await act(async () => {
            await vi.waitFor(() => expect(root.container.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 10_000 });
        });
        expect(root.container.querySelector('[role="alert"]')!.textContent).toContain('empty.csv can\'t be read as CSV');
        expect(button('Load into Hyper')).toBeUndefined();
    });
});

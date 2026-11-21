import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { HyperDB } from '@akohn/dashql/platform/hyperdb/hyperdb_wasm';
import { exportArrowTableAsParquet } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_export';
import { tableFromArrays } from '@akohn/dashql/platform/testing/arrow_fixtures';
import { BlobWriter, TextReader, Uint8ArrayReader, ZipReader, ZipWriter } from '@akohn/dashql/platform/workbook/workbook_zip';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { LoggerProvider } from '../../host/logger_provider.js';
import { EmbeddedDatabaseProvider } from '../../host/embedded_database_provider.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { createTestHyperDB, withoutTermination } from '../../tests/hyperdb_test_client.js';
import { UnpackerPage } from './unpacker_page.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let database: HyperDB;
let disposeDatabase: (() => Promise<void>) | null = null;
beforeAll(async () => {
    ({ database, dispose: disposeDatabase } = await createTestHyperDB('dashql-unpacker'));
}, 60_000);
afterAll(async () => {
    await disposeDatabase?.();
});

/// A `.dashql` file with two workbook tables and a file that is no Parquet file
async function testArchive(): Promise<File> {
    const versions = await exportArrowTableAsParquet(database, tableFromArrays({
        workbook_id: ['0f6b7a3e'],
        version_id: ['5c1d9e20'],
        name: ['Orders'],
    }));
    const scripts = await exportArrowTableAsParquet(database, tableFromArrays({
        position: Int32Array.from([0, 1]),
        name: ['orders.sql', 'answer.sql'],
        text: ['select * from orders', 'select 42 as answer'],
    }));
    const zip = new ZipWriter(new BlobWriter('application/zip'));
    await zip.add('workbook_versions.parquet', new Uint8ArrayReader(versions));
    await zip.add('workbook_scripts.parquet', new Uint8ArrayReader(scripts), { level: 0 });
    await zip.add('notes.txt', new TextReader('not a table'));
    return new File([await zip.close()], 'orders.dashql');
}

describe('UnpackerPage', () => {
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
                        <UnpackerPage />
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
    const card = (fileName: string) => root.container.querySelector<HTMLElement>(`section[aria-label="${fileName}"]`);
    const toggle = (fileName: string) => act(async () => card(fileName)!.querySelector<HTMLButtonElement>('button')!.click());
    const cells = (fileName: string) => [...card(fileName)?.querySelectorAll('[role="gridcell"]') ?? []].map(cell => cell.textContent).join('|');
    const computations = () => runtime!.store.all('computation').size;

    it('shows a card for every Parquet file and its table when it opens', async () => {
        expect(root.container.textContent).toContain('Drop a .dashql file');
        await drop(await testArchive());
        await act(async () => {
            await vi.waitFor(() => expect(card('workbook_scripts.parquet')).not.toBeNull());
        });
        expect([...root.container.querySelectorAll('section')].map(section => section.getAttribute('aria-label')))
            .toEqual(['workbook_versions.parquet', 'workbook_scripts.parquet']);
        expect(root.container.textContent).toContain('orders.dashql');
        expect(root.container.textContent).toContain('2 Parquet files');
        // The other entries are listed without a table
        expect(root.container.textContent).toContain('Other entries');
        expect(root.container.textContent).toContain('notes.txt');
        // A card reads its file when it first opens
        expect(computations()).toBe(0);

        await toggle('workbook_scripts.parquet');
        expect(card('workbook_scripts.parquet')!.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
        await act(async () => {
            await vi.waitFor(() => expect(cells('workbook_scripts.parquet')).toContain('select 42 as answer'), { timeout: 10_000 });
        });
        expect(card('workbook_scripts.parquet')!.textContent).toContain('2 rows, 3 columns');
        expect(cells('workbook_scripts.parquet')).toContain('orders.sql');
        expect(computations()).toBe(1);

        // The button next to the header opens the full table over the page, its close button closes it
        const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Table of workbook_scripts.parquet"]');
        await act(async () => card('workbook_scripts.parquet')!
            .querySelector<HTMLButtonElement>('button[aria-label="Open the table of workbook_scripts.parquet"]')!.click());
        await act(async () => {
            await vi.waitFor(() => expect(dialog()?.textContent).toContain('select 42 as answer'));
        });
        expect(dialog()!.textContent).toContain('2 rows');
        await act(async () => dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Close table"]')!.click());
        expect(dialog()).toBeNull();
        expect(computations()).toBe(1);

        // A closed card keeps its table, it shows again at once
        await toggle('workbook_scripts.parquet');
        expect(cells('workbook_scripts.parquet')).toBe('');
        await toggle('workbook_scripts.parquet');
        expect(cells('workbook_scripts.parquet')).toContain('select 42 as answer');
        expect(computations()).toBe(1);

        // Another file replaces the cards and deletes their computations
        await drop(await testArchive());
        await act(async () => {
            await vi.waitFor(() => expect(computations()).toBe(0));
        });
        expect(card('workbook_scripts.parquet')!.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    }, 30_000);

    it('reports a stored file whose bytes differ from its checksum', async () => {
        // Flip a byte of the stored workbook_scripts.parquet, its CRC-32 in the archive stays
        const archive = new Uint8Array(await (await testArchive()).arrayBuffer());
        const reader = new ZipReader(new Uint8ArrayReader(archive));
        const entry = (await reader.getEntries()).find(entry => entry.filename === 'workbook_scripts.parquet')!;
        await reader.close();
        const header = new DataView(archive.buffer, entry.offset);
        const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        archive[start + Math.floor(entry.compressedSize / 2)] ^= 0xFF;

        await drop(new File([archive], 'orders.dashql'));
        await act(async () => {
            await vi.waitFor(() => expect(card('workbook_scripts.parquet')).not.toBeNull());
        });
        await toggle('workbook_scripts.parquet');
        await act(async () => {
            await vi.waitFor(() => expect(card('workbook_scripts.parquet')!.querySelector('[role="alert"]')).not.toBeNull(), { timeout: 10_000 });
        });
        expect(card('workbook_scripts.parquet')!.querySelector('[role="alert"]')!.textContent)
            .toContain('The checksum of workbook_scripts.parquet differs');
        expect(computations()).toBe(0);
    }, 30_000);

    it('reports a file that is no archive', async () => {
        await drop(new File(['select 1;'], 'script.sql'));
        await act(async () => {
            await vi.waitFor(() => expect(root.container.querySelector('[role="alert"]')).not.toBeNull());
        });
        expect(root.container.querySelector('[role="alert"]')!.textContent).toContain('script.sql is not a ZIP archive');
        expect(root.container.querySelector('section')).toBeNull();
    });
});

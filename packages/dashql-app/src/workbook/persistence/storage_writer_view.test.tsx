import * as React from 'react';
import * as core from '@ankoh/dashql';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { WorkbookTestBackend, TEST_WORKBOOK_ID } from '@ankoh/dashql/platform/testing/workbook_test_backend';
import { StorageWriter, type StorageKeyStatistics, type StorageWriterStatistics } from '@ankoh/dashql/runtime/storage/runtime_storage';
import { StorageWriterView } from './storage_writer_view.js';
import { TestRuntime } from '../../tests/test_runtime.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

type StorageWriteStatisticsMap = Map<string, StorageWriterStatistics>;

/// The statistics of a workbook as the module hands them out: its keys with the label within the workbook
function ofWorkbook(workbookId: string, statistics: StorageWriteStatisticsMap): StorageKeyStatistics[] {
    return [...statistics]
        .filter(([key]) => key.startsWith(`${workbookId}/`))
        .map(([key, stats]) => ({ key, label: key.slice(workbookId.length + 1), stats }));
}
import * as styles from './storage_writer_view.module.css';

const OTHER_WORKBOOK_ID = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';

function stats(lastWrite: number | null, writes = 1): StorageWriterStatistics {
    return {
        totalScheduledWrites: writes + 1,
        totalWrites: writes,
        totalWrittenBytes: writes * 1500,
        totalWriteTime: writes * 1250,
        lastWrite: lastWrite == null ? null : new Date(lastWrite),
    };
}

describe('StorageWriterView', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '600px';
        container.style.height = '600px';
        container.style.display = 'flex';
        document.body.appendChild(container);
        root = createRoot(container);
        onClose = vi.fn<() => void>();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    async function render(workbookId: string | null, initial: StorageWriteStatisticsMap) {
        vi.spyOn(StorageWriter.prototype, 'getStatistics').mockImplementation(workbookId => ofWorkbook(workbookId, initial));
        await act(async () => root.render(
            <LoggerProvider>
                <StorageProvider backend={new WorkbookTestBackend()}>
                    <TestRuntime>
                        <StorageWriterView workbookId={workbookId} onClose={onClose} />
                    </TestRuntime>
                </StorageProvider>
            </LoggerProvider>,
        ));
    }

    const rows = () => [...container.querySelectorAll<HTMLElement>('[title]')].map(cell => cell.parentElement!.parentElement!);
    const keys = () => [...container.querySelectorAll('[title]')].map(cell => [cell.getAttribute('title'), cell.textContent]);
    const selected = () => rows().findIndex(row => row.classList.contains(styles.stat_row_selected));
    const overlayButton = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    const key = (k: string) => act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });

    it('asks for a workbook without one', async () => {
        await render(null, new Map([[`${TEST_WORKBOOK_ID}/scripts`, stats(1)]]));
        expect(container.textContent).toContain('Select a workbook to see its storage writes');
        act(() => overlayButton('close-overlay')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows the writes of the workbook, the oldest write first', async () => {
        await render(TEST_WORKBOOK_ID, new Map<string, StorageWriterStatistics>([
            [`${TEST_WORKBOOK_ID}/scripts/02.sql`, stats(3000, 2)],
            [`${OTHER_WORKBOOK_ID}/scripts/01.sql`, stats(1000)],
            [`${TEST_WORKBOOK_ID}/dashql-workbook.json`, stats(2000)],
            [`${TEST_WORKBOOK_ID}/scripts/03.sql:delete`, stats(null, 0)],
            ['@manifest/connections/a', stats(4000)],
        ]));
        expect(keys()).toEqual([
            [`${TEST_WORKBOOK_ID}/scripts/03.sql:delete`, 'scripts/03.sql:delete'],
            [`${TEST_WORKBOOK_ID}/dashql-workbook.json`, 'dashql-workbook.json'],
            [`${TEST_WORKBOOK_ID}/scripts/02.sql`, 'scripts/02.sql'],
        ]);
        const cells = [...rows()[2].firstElementChild!.children].map(cell => cell.textContent);
        expect(cells).toEqual(['scripts/02.sql', '3', '2', '2.50 s', '3 kB']);
        expect([...rows()[0].firstElementChild!.children].map(cell => cell.textContent)).toEqual(['scripts/03.sql:delete', '1', '0', '0 ms', '0 bytes']);
    });

    it('follows the statistics of the writer', async () => {
        await render(TEST_WORKBOOK_ID, new Map());
        expect(container.textContent).toContain('Nothing to see here');
        vi.spyOn(StorageWriter.prototype, 'getStatistics').mockImplementation(workbookId => ofWorkbook(workbookId, new Map([[`${TEST_WORKBOOK_ID}/scripts/01.sql`, stats(1)]])));
        await vi.waitFor(() => expect(keys()).toEqual([[`${TEST_WORKBOOK_ID}/scripts/01.sql`, 'scripts/01.sql']]));
    });

    it('inspects an entry and steps through the entries', async () => {
        await render(TEST_WORKBOOK_ID, new Map<string, StorageWriterStatistics>([
            [`${TEST_WORKBOOK_ID}/scripts/01.sql`, stats(1000)],
            [`${TEST_WORKBOOK_ID}/scripts/02.sql`, stats(2000)],
            [`${TEST_WORKBOOK_ID}/scripts/03.sql`, stats(3000)],
        ]));
        act(() => rows()[1].click());
        expect(selected()).toBe(1);
        expect(document.body.textContent).toContain('1970-01-01T00:00:02.000Z');

        key('ArrowDown');
        expect(selected()).toBe(2);
        expect(overlayButton('Next entry')!.disabled).toBe(true);
        key('ArrowDown');
        expect(selected()).toBe(2);
        act(() => overlayButton('Previous entry')!.click());
        expect(selected()).toBe(1);
        key('ArrowUp');
        expect(selected()).toBe(0);
        expect(overlayButton('Previous entry')!.disabled).toBe(true);
        key('ArrowUp');
        expect(selected()).toBe(0);
        act(() => overlayButton('Next entry')!.click());
        expect(selected()).toBe(1);

        act(() => overlayButton('Close')!.click());
        expect(selected()).toBe(-1);
        expect(overlayButton('Next entry')).toBeNull();
        key('ArrowDown');
        expect(selected()).toBe(-1);
    });
});

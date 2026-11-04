import * as Immutable from 'immutable';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { SessionTestBackend, TEST_SESSION_ID } from '../../storage/session_test_backend.js';
import { StorageWriter, type StorageWriterStatistics, type StorageWriteStatisticsMap, type StorageWriteStatisticsSubscriber } from '../../storage/storage_writer.js';
import { StorageWriterView } from './storage_writer_view.js';
import * as styles from './storage_writer_view.module.css';

const OTHER_SESSION_ID = 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb';

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
    let listeners: Set<StorageWriteStatisticsSubscriber>;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '600px';
        container.style.height = '600px';
        container.style.display = 'flex';
        document.body.appendChild(container);
        root = createRoot(container);
        onClose = vi.fn<() => void>();
        listeners = new Set();
        vi.spyOn(StorageWriter.prototype, 'subscribeStatisticsListener').mockImplementation(listener => { listeners.add(listener); });
        vi.spyOn(StorageWriter.prototype, 'unsubscribeStatisticsListener').mockImplementation(listener => { listeners.delete(listener); });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    async function render(sessionId: string | null, initial: StorageWriteStatisticsMap) {
        vi.spyOn(StorageWriter.prototype, 'getStatistics').mockReturnValue(initial);
        await act(async () => root.render(
            <LoggerProvider>
                <StorageProvider backend={new SessionTestBackend()}>
                    <StorageWriterView sessionId={sessionId} onClose={onClose} />
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

    it('asks for a session without one', async () => {
        await render(null, Immutable.Map([[`${TEST_SESSION_ID}/scripts`, stats(1)]]));
        expect(container.textContent).toContain('Select a session to see its storage writes');
        act(() => overlayButton('close-overlay')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('shows the writes of the session, the oldest write first', async () => {
        await render(TEST_SESSION_ID, Immutable.Map<string, StorageWriterStatistics>([
            [`${TEST_SESSION_ID}/scripts/02.sql`, stats(3000, 2)],
            [`${OTHER_SESSION_ID}/scripts/01.sql`, stats(1000)],
            [`${TEST_SESSION_ID}/dashql-session.json`, stats(2000)],
            [`${TEST_SESSION_ID}/scripts/03.sql:delete`, stats(null, 0)],
            ['@manifest/connections/a', stats(4000)],
        ]));
        expect(keys()).toEqual([
            [`${TEST_SESSION_ID}/scripts/03.sql:delete`, 'scripts/03.sql:delete'],
            [`${TEST_SESSION_ID}/dashql-session.json`, 'dashql-session.json'],
            [`${TEST_SESSION_ID}/scripts/02.sql`, 'scripts/02.sql'],
        ]);
        const cells = [...rows()[2].firstElementChild!.children].map(cell => cell.textContent);
        expect(cells).toEqual(['scripts/02.sql', '3', '2', '2.50 s', '3 kB']);
        expect([...rows()[0].firstElementChild!.children].map(cell => cell.textContent)).toEqual(['scripts/03.sql:delete', '1', '0', '0 ms', '0 bytes']);
    });

    it('follows the statistics of the writer', async () => {
        await render(TEST_SESSION_ID, Immutable.Map());
        expect(container.textContent).toContain('Nothing to see here');
        expect(listeners.size).toBe(1);
        act(() => {
            for (const listener of listeners) listener(Immutable.Map([[`${TEST_SESSION_ID}/scripts/01.sql`, stats(1)]]));
        });
        expect(keys()).toEqual([[`${TEST_SESSION_ID}/scripts/01.sql`, 'scripts/01.sql']]);
        act(() => root.unmount());
        root = createRoot(container);
        expect(listeners.size).toBe(0);
    });

    it('inspects an entry and steps through the entries', async () => {
        await render(TEST_SESSION_ID, Immutable.Map<string, StorageWriterStatistics>([
            [`${TEST_SESSION_ID}/scripts/01.sql`, stats(1000)],
            [`${TEST_SESSION_ID}/scripts/02.sql`, stats(2000)],
            [`${TEST_SESSION_ID}/scripts/03.sql`, stats(3000)],
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

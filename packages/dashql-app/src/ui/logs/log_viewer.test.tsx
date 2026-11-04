import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { LogLevel } from '../../platform/logger/log_buffer.js';
import type { Logger } from '../../platform/logger/logger.js';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { testLogRecord } from '../../platform/logger/test_logger.js';
import { WebFileDownloader } from '../../platform/file/web_file_downloader.js';
import { LogViewer } from './log_viewer.js';
import * as styles from './log_viewer.module.css';

describe('LogViewer', () => {
    let container: HTMLDivElement;
    let root: Root;
    let logger: Logger;
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

    function CaptureLogger() {
        logger = useLogger();
        return null;
    }

    function log(message: string, traceId?: number, level = LogLevel.Info) {
        logger.push(testLogRecord({
            message,
            level,
            timestamp: Date.UTC(2026, 10, 4, 12, 30, 15),
            tracing: traceId === undefined ? null : { traceId, spanId: 1, parentSpanId: null },
        }));
    }

    function render(traceId?: number, before: () => void = () => { }) {
        act(() => root.render(
            <LoggerProvider>
                <CaptureLogger />
                <Setup before={before} />
                <LogViewer onClose={onClose} traceId={traceId} />
            </LoggerProvider>,
        ));
    }

    // Logs records before the viewer mounts
    function Setup(props: { before: () => void }) {
        const done = React.useRef(false);
        if (!done.current) {
            done.current = true;
            props.before();
        }
        return null;
    }

    const rowMessages = () => [...container.querySelectorAll('[title]')].map(element => element.getAttribute('title'));
    const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    const overlayButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]
        .find(element => !container.contains(element)) ?? null;
    const key = (k: string) => act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });

    it('shows the records of the buffer and polls for new ones', async () => {
        render(undefined, () => {
            log('first');
            log('second', undefined, LogLevel.Warn);
        });
        expect(container.textContent).toContain('Logs');
        expect(rowMessages()).toEqual(['first', 'second']);
        expect(container.textContent).toContain('12:30:15');
        expect(container.textContent).toContain('warn');

        log('third');
        await act(async () => {
            await vi.waitFor(() => expect(rowMessages()).toEqual(['first', 'second', 'third']));
        });

        act(() => button('Close')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('inspects a record and steps through the records with the keys and buttons', async () => {
        render(undefined, () => {
            log('first');
            log('second');
            log('third');
        });
        const rows = () => [...container.querySelectorAll<HTMLElement>('[title]')].map(element => element.parentElement!.parentElement!);
        act(() => rows()[1].click());
        expect(document.body.textContent).toContain('second');
        expect(overlayButton('Previous log')!.disabled).toBe(false);
        const selected = () => rows().findIndex(row => row.classList.contains(styles.log_row_selected));
        expect(selected()).toBe(1);

        key('ArrowDown');
        expect(selected()).toBe(2);
        expect(overlayButton('Next log')!.disabled).toBe(true);
        // The last record has no next one
        key('ArrowDown');
        expect(selected()).toBe(2);

        act(() => overlayButton('Previous log')!.click());
        expect(selected()).toBe(1);
        key('ArrowUp');
        expect(selected()).toBe(0);
        expect(overlayButton('Previous log')!.disabled).toBe(true);
        key('ArrowUp');
        expect(selected()).toBe(0);
        act(() => overlayButton('Next log')!.click());
        expect(selected()).toBe(1);

        act(() => overlayButton('Close')!.click());
        expect(selected()).toBe(-1);
        expect(overlayButton('Next log')).toBeNull();
        // Without an inspected record the keys do nothing
        key('ArrowDown');
        expect(selected()).toBe(-1);
    });

    it('downloads all records as JSON', async () => {
        const download = vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockResolvedValue();
        render(undefined, () => {
            log('first');
            log('second', 3);
        });
        await act(async () => button('Download Logs as JSON')!.click());
        expect(download).toHaveBeenCalledOnce();
        const [buffer, filename] = download.mock.calls[0];
        expect(filename).toMatch(/^dashql-logs-\d{4}-.*\.json$/);
        expect(JSON.parse(new TextDecoder().decode(buffer)).map((record: { message: string }) => record.message)).toEqual(['first', 'second']);
    });

    it('reports a failed download', async () => {
        const failure = new Error('no downloads');
        vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockRejectedValue(failure);
        const error = vi.spyOn(console, 'error').mockImplementation(() => { });
        render();
        await act(async () => button('Download Logs as JSON')!.click());
        expect(error).toHaveBeenCalledWith('Failed to download logs:', failure);
    });

    it('shows and downloads only the records of a trace', async () => {
        const download = vi.spyOn(WebFileDownloader.prototype, 'downloadBufferAsFile').mockResolvedValue();
        render(7, () => {
            log('before', 7);
            log('other', 8);
            log('untraced');
        });
        expect(container.textContent).toContain('Logs (Trace 7)');
        expect(rowMessages()).toEqual(['before']);

        // The viewer follows new records of the trace
        act(() => {
            log('after', 7);
            log('other again', 8);
        });
        expect(rowMessages()).toEqual(['before', 'after']);

        const rows = () => [...container.querySelectorAll<HTMLElement>('[title]')].map(element => element.parentElement!.parentElement!);
        act(() => rows()[0].click());
        key('ArrowDown');
        expect(rows().findIndex(row => row.classList.contains(styles.log_row_selected))).toBe(1);
        key('ArrowDown');
        expect(rows().findIndex(row => row.classList.contains(styles.log_row_selected))).toBe(1);

        await act(async () => button('Download Logs as JSON')!.click());
        const [buffer, filename] = download.mock.calls[0];
        expect(filename).toMatch(/^dashql-logs-trace-7-.*\.json$/);
        expect(JSON.parse(new TextDecoder().decode(buffer)).map((record: { message: string }) => record.message)).toEqual(['before', 'after']);
    });

    it('shows an empty buffer and a trace without records', () => {
        render();
        expect(rowMessages()).toEqual([]);
        act(() => root.unmount());
        root = createRoot(container);
        render(9);
        expect(container.textContent).toContain('Logs (Trace 9)');
        expect(rowMessages()).toEqual([]);
    });

    it('stops following a trace when unmounted', () => {
        render(9);
        const unsubscribe = vi.spyOn(logger.buffer, 'unsubscribeTrace');
        act(() => root.render(<LoggerProvider><CaptureLogger /></LoggerProvider>));
        expect(unsubscribe).toHaveBeenCalledWith(9, expect.any(Function));
    });
});

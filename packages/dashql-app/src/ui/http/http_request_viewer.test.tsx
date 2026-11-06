import * as React from 'react';
import { act, flushContinuousUpdates } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { HttpRequestLog, type HttpRequestEntry } from '../../platform/http/http_request_log.js';
import { getRequestStatusLabel, HttpRequestViewer } from './http_request_viewer.js';
import * as styles from './http_request_viewer.module.css';

const SENT_AT = new Date(Date.UTC(2026, 10, 4, 12, 0, 0));

function request(fields: Partial<Omit<HttpRequestEntry, 'requestId'>> = {}): Omit<HttpRequestEntry, 'requestId'> {
    return {
        method: 'GET',
        url: 'https://trino.example/v1/statement',
        requestHeaders: [['authorization', 'Bearer secret'], ['accept', 'application/json']],
        requestBody: null,
        sentAt: SENT_AT,
        respondedAt: null,
        bodyReceivedAt: null,
        failedAt: null,
        status: null,
        statusText: null,
        responseHeaders: null,
        responseBody: null,
        error: null,
        ...fields,
    };
}

describe('getRequestStatusLabel', () => {
    it('labels the status, a failure or a pending request', () => {
        expect(getRequestStatusLabel({ ...request({ status: 404 }), requestId: 1 })).toBe('404');
        expect(getRequestStatusLabel({ ...request({ error: 'offline' }), requestId: 1 })).toBe('failed');
        expect(getRequestStatusLabel({ ...request(), requestId: 1 })).toBe('pending');
    });
});

describe('HttpRequestViewer', () => {
    let container: HTMLDivElement;
    let root: Root;
    let log: HttpRequestLog;
    let onClose: ReturnType<typeof vi.fn<() => void>>;
    let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '800px';
        container.style.height = '600px';
        container.style.display = 'flex';
        document.body.appendChild(container);
        root = createRoot(container);
        log = new HttpRequestLog();
        onClose = vi.fn<() => void>();
        writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    });

    afterEach(() => {
        vi.useRealTimers();
        act(() => root.unmount());
        container.remove();
    });

    /// Wait for a rendered state under the fake clock. React renders the state of a promise callback in a task of its
    /// scheduler, which runs on messages and not on the clock, so this counts messages. vi.waitFor needs real timers.
    async function untilRendered(rendered: () => void): Promise<void> {
        for (let turn = 1; ; ++turn) {
            await flushContinuousUpdates();
            try {
                rendered();
                return;
            } catch (error) {
                if (turn >= 1000) throw error;
            }
        }
    }

    function render(requestLog: HttpRequestLog | null = log) {
        act(() => root.render(<HttpRequestViewer onClose={onClose} log={requestLog} />));
    }

    const rows = () => [...container.querySelectorAll<HTMLElement>('[data-testid="http-request-row"]')];
    const cells = (row: HTMLElement) => [...row.firstElementChild!.children].slice(0, 5).map(cell => cell.textContent);
    const selected = () => rows().findIndex(row => row.classList.contains(styles.request_row_selected));
    const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    const key = (k: string) => act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });

    it('shows nothing without requests or a log', () => {
        render(null);
        expect(container.textContent).toContain('Nothing to see here');
        expect(button('Clear requests')!.disabled).toBe(true);
        act(() => button('close-overlay')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('lists the requests with their status and duration', () => {
        log.add(request({ status: 200, respondedAt: new Date(SENT_AT.getTime() + 42) }));
        log.add(request({ method: 'POST', status: 500, respondedAt: new Date(SENT_AT.getTime() + 7) }));
        log.add(request({ method: 'DELETE', error: 'offline', failedAt: new Date(SENT_AT.getTime() + 3) }));
        log.add(request());
        render();
        const time = SENT_AT.toLocaleTimeString('en-GB', { hour12: false });
        const url = 'https://trino.example/v1/statement';
        expect(rows().map(cells)).toEqual([
            [time, 'GET', '200', '42 ms', url],
            [time, 'POST', '500', '7 ms', url],
            [time, 'DELETE', 'failed', '3 ms', url],
            [time, 'GET', 'pending', '—', url],
        ]);
        const failed = rows().map(row => row.firstElementChild!.children[2].classList.contains(styles.cell_status_failed));
        expect(failed).toEqual([false, true, true, false]);

        // The list follows new requests
        act(() => { log.add(request({ method: 'PUT' })); });
        expect(rows().length).toBe(5);
    });

    it('shows the details of a request and steps through the requests', () => {
        log.add(request({ requestBody: { kind: 'text', text: '{"query":"select 1"}', byteLength: 20, truncated: false } }));
        const second = log.add(request({ method: 'POST', requestBody: { kind: 'text', text: 'select 2', byteLength: 8, truncated: false } }));
        log.add(request({ requestBody: { kind: 'binary', byteLength: 3 } }));
        render();

        act(() => rows()[1].click());
        expect(selected()).toBe(1);
        expect(document.body.textContent).toContain('select 2');
        // Masked credentials
        expect(document.body.textContent).not.toContain('Bearer secret');

        // A progressing request stays selected
        act(() => log.update(second, { status: 200, respondedAt: new Date(SENT_AT.getTime() + 5) }));
        expect(selected()).toBe(1);
        expect(cells(rows()[1])[2]).toBe('200');

        key('ArrowDown');
        expect(selected()).toBe(2);
        expect(button('Next entry')!.disabled).toBe(true);
        key('ArrowDown');
        expect(selected()).toBe(2);
        act(() => button('Previous entry')!.click());
        expect(selected()).toBe(1);
        key('ArrowUp');
        expect(selected()).toBe(0);
        expect(button('Previous entry')!.disabled).toBe(true);
        key('ArrowUp');
        expect(selected()).toBe(0);
        act(() => button('Next entry')!.click());
        expect(selected()).toBe(1);

        act(() => button('Close')!.click());
        expect(selected()).toBe(-1);
        expect(button('Next entry')).toBeNull();
        key('ArrowDown');
        expect(selected()).toBe(-1);
    });

    it('closes the details when the requests are cleared', () => {
        log.add(request());
        render();
        act(() => rows()[0].click());
        expect(button('Next entry')).not.toBeNull();
        act(() => button('Clear requests')!.click());
        expect(rows()).toEqual([]);
        expect(button('Next entry')).toBeNull();
        expect(container.textContent).toContain('Nothing to see here');
    });

    it('copies a request as curl command with its credentials', async () => {
        log.add(request({ method: 'POST', requestBody: { kind: 'text', text: 'select 1', byteLength: 8, truncated: false } }));
        render();
        const copy = () => container.querySelector<HTMLButtonElement>('[data-testid="http-request-copy-curl"]')!;
        const icon = () => copy().querySelector('use')?.getAttribute('xlink:href') ?? '';
        expect(icon()).toMatch(/#copy_16$/);
        vi.useFakeTimers();
        await act(async () => copy().click());
        expect(writeText).toHaveBeenCalledOnce();
        expect(writeText.mock.calls[0][0]).toContain("curl 'https://trino.example/v1/statement'");
        expect(writeText.mock.calls[0][0]).toContain('Bearer secret');
        // Copying does not open the details
        expect(selected()).toBe(-1);
        await untilRendered(() => expect(icon()).toMatch(/#check_16$/));
        // The check mark stays before the two seconds have passed
        act(() => { vi.advanceTimersByTime(1999); });
        await flushContinuousUpdates();
        expect(icon()).toMatch(/#check_16$/);
        // It goes back to the copy icon after two seconds. An effect starts the timer after the render, it may start
        // only now.
        await untilRendered(() => {
            act(() => { vi.advanceTimersByTime(2000); });
            expect(icon()).toMatch(/#copy_16$/);
        });
        vi.useRealTimers();

        // A clipboard that refuses keeps the icon
        writeText.mockRejectedValueOnce(new Error('denied'));
        await act(async () => copy().click());
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
        expect(writeText).toHaveBeenCalledTimes(2);
        expect(icon()).toMatch(/#copy_16$/);
    });
});

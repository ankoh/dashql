import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { LogLevel } from '../platform/logger/log_buffer.js';
import type { Logger } from '../platform/logger/logger.js';
import { LoggerProvider, useLogger } from '../platform/logger/logger_provider.js';
import { testLogRecord } from '../platform/logger/test_logger.js';
import { ROW_HEIGHT } from '../ui/logs/log_viewer.js';
import * as styles from '../ui/logs/log_viewer.module.css';
import { TraceLogViewer } from './trace_log_viewer.js';

describe('TraceLogViewer', () => {
    let container: HTMLDivElement;
    let root: Root;
    let logger: Logger;

    beforeEach(() => {
        container = document.createElement('div');
        container.style.width = '600px';
        container.style.height = '400px';
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function CaptureLogger() {
        logger = useLogger();
        return null;
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

    function log(message: string, traceId?: number) {
        logger.push(testLogRecord({
            message,
            level: LogLevel.Info,
            timestamp: Date.UTC(2026, 10, 5, 9, 15, 30),
            tracing: traceId === undefined ? null : { traceId, spanId: 1, parentSpanId: null },
        }));
    }

    function render(props: React.ComponentProps<typeof TraceLogViewer>, before: () => void = () => { }) {
        act(() => root.render(
            <LoggerProvider>
                <CaptureLogger />
                <Setup before={before} />
                <TraceLogViewer {...props} />
            </LoggerProvider>,
        ));
    }

    const rowMessages = () => [...container.querySelectorAll('[title]')].map(element => element.getAttribute('title'));
    const rows = () => [...container.querySelectorAll<HTMLElement>('[title]')].map(element => element.parentElement!.parentElement!);
    const selected = () => rows().findIndex(row => row.classList.contains(styles.log_row_selected));
    const overlayButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)]
        .find(element => !container.contains(element)) ?? null;
    const key = (k: string) => act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    });

    it('shows the records of one trace and appends the records that arrive later', async () => {
        render({ traceId: 7 }, () => {
            log('other trace', 8);
            log('first', 7);
            log('untraced');
            log('second', 7);
        });
        expect(rowMessages()).toEqual(['first', 'second']);
        // The fixed default height of 200 pixels
        expect((container.firstElementChild as HTMLElement).style.height).toBe('200px');

        await act(async () => {
            log('third', 7);
            log('not mine', 9);
        });
        expect(rowMessages()).toEqual(['first', 'second', 'third']);
    });

    it('grows with the rows up to the maximum rows', async () => {
        render({ traceId: 3, maxRows: 2 }, () => log('first', 3));
        const viewport = () => container.firstElementChild as HTMLElement;
        expect(viewport().style.height).toBe(`${ROW_HEIGHT}px`);
        await act(async () => {
            log('second', 3);
            log('third', 3);
        });
        expect(viewport().style.height).toBe(`${2 * ROW_HEIGHT}px`);
    });

    it('shows all records without a trace and fills its parent', async () => {
        render({ fill: true }, () => {
            log('first', 1);
            log('second');
        });
        expect((container.firstElementChild as HTMLElement).style.height).toBe('100%');
        expect(rowMessages()).toEqual(['first', 'second']);

        // Without a trace the viewer polls the version of the log
        log('third');
        await act(async () => {
            await vi.waitFor(() => expect(rowMessages()).toEqual(['first', 'second', 'third']));
        });
    });

    it('inspects a record of the trace and steps through the trace with the keys and buttons', () => {
        render({ traceId: 5, height: 300 }, () => {
            log('first', 5);
            log('skipped', 6);
            log('second', 5);
            log('third', 5);
        });
        act(() => rows()[1].click());
        expect(selected()).toBe(1);
        expect(overlayButton('Previous log')!.disabled).toBe(false);

        key('ArrowDown');
        expect(selected()).toBe(2);
        expect(overlayButton('Next log')!.disabled).toBe(true);
        // The last record of the trace has no next one
        key('ArrowDown');
        expect(selected()).toBe(2);
        act(() => overlayButton('Next log')!.click());
        expect(selected()).toBe(2);

        key('ArrowUp');
        key('ArrowUp');
        expect(selected()).toBe(0);
        key('ArrowUp');
        expect(selected()).toBe(0);
        act(() => overlayButton('Next log')!.click());
        expect(selected()).toBe(1);

        act(() => overlayButton('Close')!.click());
        expect(selected()).toBe(-1);
        expect(overlayButton('Next log')).toBeNull();
    });

    it('inspects and steps through all records without a trace', () => {
        render({}, () => {
            log('first', 1);
            log('second');
        });
        act(() => rows()[0].click());
        expect(selected()).toBe(0);
        key('ArrowDown');
        expect(selected()).toBe(1);
        key('ArrowDown');
        expect(selected()).toBe(1);
        key('ArrowUp');
        expect(selected()).toBe(0);
    });

    it('unsubscribes from the trace when it changes', async () => {
        render({ traceId: 1 }, () => {
            log('one', 1);
            log('two', 2);
        });
        expect(rowMessages()).toEqual(['one']);
        render({ traceId: 2 });
        // The switch renders the rows of the new trace after its subscription
        await act(async () => {
            await vi.waitFor(() => expect(rowMessages()).toEqual(['two']));
        });
        await act(async () => {
            log('one more', 1);
        });
        expect(rowMessages()).toEqual(['two']);
    });
});

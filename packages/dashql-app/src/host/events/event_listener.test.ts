import { describe, expect, it, vi } from 'vitest';

import { SETUP_WORKBOOK, SETUP_WORKBOOK_URL, type SetupEventVariant } from './event.js';
import { parseClipboardSetup, PlatformEventListener, readWorkbookUrlParameter } from './event_listener.js';
import { TestLogger } from '@akohn/dashql/platform/testing/test_logger';
import { encodeWorkbookAppEvent } from '../../tests/mocks/app_events.js';

class TestPlatformEventListener extends PlatformEventListener {
    public starts = 0;
    public stops = 0;

    protected async listenForAppEvents(): Promise<void> { this.starts += 1; }
    protected stopListeningForAppEvents(): void { this.stops += 1; }
}

describe('PlatformEventListener clipboard events', () => {
    function paste(text: string) {
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
        Object.defineProperties(event, {
            clipboardData: { value: { getData: () => text } },
            preventDefault: { value: preventDefault },
            stopPropagation: { value: stopPropagation },
        });
        document.dispatchEvent(event);
        return { preventDefault, stopPropagation };
    }

    it.each([
        'dashql://localhost?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'https://dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'https://stable.dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'https://dev.dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'http://localhost:9002/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'https://dashql.app/?notebook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
    ])('accepts a workbook link from %s', link => {
        expect(parseClipboardSetup(link)).toEqual({
            type: 'workbook',
            value: 'https://example.com/dashql-workbook.json',
        });
    });

    it.each([
        'https://example.com/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'http://dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'http://stable.dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'http://dev.dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'https://other.dashql.app/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
        'http://localhost:9003/?workbook=https%3A%2F%2Fexample.com%2Fdashql-workbook.json',
    ])('rejects an app link from an untrusted origin: %s', link => {
        expect(parseClipboardSetup(link)).toBeNull();
    });

    it('dispatches a workbook setup event from a pasted app URL', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const setupEvents: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => setupEvents.push(event));
        await listener.setup();

        const { preventDefault, stopPropagation } = paste(
            'http://localhost:9002/?workbook=http://localhost:9002/static/examples/workbooks/explain/dashql-workbook.json',
        );

        expect(setupEvents).toEqual([{
            type: SETUP_WORKBOOK_URL,
            value: 'http://localhost:9002/static/examples/workbooks/explain/dashql-workbook.json',
        }]);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
        listener.dispose();
    });

    it('dispatches the workbook ZIP of a pasted link that carries it in the zip parameter', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const setupEvents: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => setupEvents.push(event));
        await listener.setup();

        expect(parseClipboardSetup('dashql://localhost?zip=UEsDBA')).toEqual({ type: 'zip', value: 'UEsDBA' });
        const { preventDefault } = paste('https://dashql.app/?zip=UEsDBA');

        expect(setupEvents).toEqual([{ type: SETUP_WORKBOOK, value: new Uint8Array([80, 75, 3, 4]) }]);
        expect(preventDefault).toHaveBeenCalledOnce();
        listener.dispose();
    });

    it('dispatches unhandled pasted text to fallback subscribers without trimming it', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const fallbackPastes: string[] = [];
        const handler = (text: string) => fallbackPastes.push(text);
        listener.subscribeFallbackPasteEvents(handler);
        await listener.setup();

        const { preventDefault, stopPropagation } = paste('  query plan\n');

        expect(fallbackPastes).toEqual(['  query plan\n']);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();

        listener.unsubscribeFallbackPasteEvents(handler);
        paste('ignored');
        expect(fallbackPastes).toHaveLength(1);
        listener.dispose();
    });

    it('sets up global listeners once and removes them on dispose', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        await listener.setup();
        await listener.setup();
        expect(listener.starts).toBe(1);

        listener.dispose();
        listener.dispose();
        expect(listener.stops).toBe(1);
    });
});

describe('PlatformEventListener links of older versions', () => {
    it('reads the workbook URL under the current and the legacy parameter', () => {
        expect(readWorkbookUrlParameter(new URLSearchParams('workbook=a'))).toBe('a');
        expect(readWorkbookUrlParameter(new URLSearchParams('notebook=b'))).toBe('b');
        expect(readWorkbookUrlParameter(new URLSearchParams('workbook=a&notebook=b'))).toBe('a');
        expect(readWorkbookUrlParameter(new URLSearchParams('data=c'))).toBeNull();
    });

    it('dispatches the workbook ZIP of an app event that embeds it as notebook', () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const setupEvents: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => setupEvents.push(event));

        const zip = new Uint8Array([80, 75, 3, 4]);
        const event = listener.readAppEvent(encodeWorkbookAppEvent(zip), 'test');
        expect(event).not.toBeNull();
        listener.dispatchAppEvent(event!);

        expect(setupEvents).toEqual([{ type: SETUP_WORKBOOK, value: zip }]);
    });
});

describe('PlatformEventListener OAuth redirects', () => {
    const redirect = (code: string) => ({ oauthRedirect: { code, state: {} } }) as unknown as Parameters<PlatformEventListener['dispatchAppEvent']>[0];

    it('resolves the accepted redirect of an app event', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const waiting = listener.waitForOAuthRedirect(new AbortController().signal, data => data.code === 'mine');
        listener.dispatchAppEvent(redirect('other'));
        listener.dispatchAppEvent(redirect('mine'));
        await expect(waiting).resolves.toMatchObject({ code: 'mine' });
    });

    it('rejects a second listener', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        void listener.waitForOAuthRedirect(new AbortController().signal);
        await expect(listener.waitForOAuthRedirect(new AbortController().signal)).rejects.toThrow('duplicate oauth listener');
    });

    it('rejects an aborted wait and accepts a new listener afterwards', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const abort = new AbortController();
        const waiting = listener.waitForOAuthRedirect(abort.signal);
        abort.abort();
        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

        const next = listener.waitForOAuthRedirect(new AbortController().signal);
        listener.dispatchAppEvent(redirect('code'));
        await expect(next).resolves.toMatchObject({ code: 'code' });
    });

    it('rejects a wait on an aborted signal without registering it', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const abort = new AbortController();
        abort.abort();
        await expect(listener.waitForOAuthRedirect(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });

        const next = listener.waitForOAuthRedirect(new AbortController().signal);
        listener.dispatchAppEvent(redirect('code'));
        await expect(next).resolves.toMatchObject({ code: 'code' });
    });
});


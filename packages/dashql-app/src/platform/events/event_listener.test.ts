import { describe, expect, it, vi } from 'vitest';

import { SETUP_NOTEBOOK_URL, type SetupEventVariant } from './event.js';
import { parseClipboardSetup, PlatformEventListener } from './event_listener.js';
import { TestLogger } from '../logger/test_logger.js';

class TestPlatformEventListener extends PlatformEventListener {
    protected async listenForAppEvents(): Promise<void> {}
}

describe('PlatformEventListener clipboard events', () => {
    it.each([
        'dashql://localhost?notebook=https%3A%2F%2Fexample.com%2Fdashql-notebook.json',
        'https://dashql.app/?notebook=https%3A%2F%2Fexample.com%2Fdashql-notebook.json',
        'http://localhost:9002/?notebook=https%3A%2F%2Fexample.com%2Fdashql-notebook.json',
    ])('accepts a notebook link from %s', link => {
        expect(parseClipboardSetup(link)).toEqual({
            type: 'notebook',
            value: 'https://example.com/dashql-notebook.json',
        });
    });

    it.each([
        'https://example.com/?notebook=https%3A%2F%2Fexample.com%2Fdashql-notebook.json',
        'http://dashql.app/?notebook=https%3A%2F%2Fexample.com%2Fdashql-notebook.json',
        'http://localhost:9003/?notebook=https%3A%2F%2Fexample.com%2Fdashql-notebook.json',
    ])('rejects an app link from an untrusted origin: %s', link => {
        expect(parseClipboardSetup(link)).toBeNull();
    });

    it('dispatches a notebook setup event from a pasted app URL', async () => {
        const listener = new TestPlatformEventListener(new TestLogger());
        const setupEvents: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => setupEvents.push(event));
        await listener.setup();

        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
        Object.defineProperties(event, {
            clipboardData: {
                value: {
                    getData: () => 'http://localhost:9002/?notebook=http://localhost:9002/static/examples/notebooks/explain/dashql-notebook.json',
                },
            },
            preventDefault: { value: preventDefault },
            stopPropagation: { value: stopPropagation },
        });
        document.dispatchEvent(event);

        expect(setupEvents).toEqual([{
            type: SETUP_NOTEBOOK_URL,
            value: 'http://localhost:9002/static/examples/notebooks/explain/dashql-notebook.json',
        }]);
        expect(preventDefault).toHaveBeenCalledOnce();
        expect(stopPropagation).toHaveBeenCalledOnce();
    });
});

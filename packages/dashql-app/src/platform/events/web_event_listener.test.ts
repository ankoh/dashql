import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../logger/test_logger.js';
import { APP_EVENT_POST_MESSAGE_KIND, DROP_EVENT, SETUP_SESSION, type PlatformDragDropEventVariant, type SetupEventVariant } from './event.js';
import { encodeSessionAppEvent } from '../../tests/mocks/app_events.js';
import { WebPlatformEventListener } from './web_event_listener.js';

describe('WebPlatformEventListener drag and drop', () => {
    const listeners: WebPlatformEventListener[] = [];

    afterEach(() => {
        for (const listener of listeners) listener.dispose();
        listeners.length = 0;
    });

    it('dispatches only the first dropped session and blocks duplicate global handlers', async () => {
        const listener = new WebPlatformEventListener(new TestLogger());
        listeners.push(listener);
        const events: PlatformDragDropEventVariant[] = [];
        listener.subscribeDragDropEvents('test', event => events.push(event));
        await listener.setup();

        const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
        const first = new File(['first'], 'first.dashql');
        const second = new File(['second'], 'second.dashql');
        Object.defineProperty(event, 'dataTransfer', {
            value: { files: { length: 2, item: (index: number) => [first, second][index] ?? null } },
        });
        const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');
        window.dispatchEvent(event);

        const drops = events.filter(value => value.type === DROP_EVENT);
        expect(drops).toHaveLength(1);
        expect(drops[0].value.file.path).toBe('first.dashql');
        expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    });

    it('does not dispatch after disposal', async () => {
        const listener = new WebPlatformEventListener(new TestLogger());
        listeners.push(listener);
        const handler = vi.fn();
        listener.subscribeDragDropEvents('test', handler);
        await listener.setup();
        listener.dispose();

        const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
        Object.defineProperty(event, 'dataTransfer', {
            value: { files: { length: 1, item: () => new File(['data'], 'session.dashql') } },
        });
        window.dispatchEvent(event);
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('WebPlatformEventListener messages', () => {
    let listener: WebPlatformEventListener | null = null;
    afterEach(() => {
        listener?.dispose();
        listener = null;
    });

    it('dispatches the app events that the window of the app posts', async () => {
        listener = new WebPlatformEventListener(new TestLogger());
        const events: SetupEventVariant[] = [];
        listener.subscribeSetupEvents(event => events.push(event));
        await listener.setup();
        const zip = new Uint8Array([80, 75, 3, 4]);
        const message = (data: unknown, origin = window.location.origin) => window.dispatchEvent(new MessageEvent('message', { data, origin }));

        message({ kind: 'devtools', data: 'x' });
        message({ kind: APP_EVENT_POST_MESSAGE_KIND, data: encodeSessionAppEvent(zip) }, 'https://evil.example');
        expect(events).toEqual([]);
        message({ kind: APP_EVENT_POST_MESSAGE_KIND, data: encodeSessionAppEvent(zip) });
        expect(events).toEqual([{ type: SETUP_SESSION, value: zip }]);
    });
});


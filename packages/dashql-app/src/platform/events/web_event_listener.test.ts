import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../logger/test_logger.js';
import { APP_EVENT_POST_MESSAGE_KIND, DRAG_EVENT, DRAG_STOP_EVENT, DROP_EVENT, SETUP_SESSION, type PlatformDragDropEventVariant, type SetupEventVariant } from './event.js';
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

describe('WebPlatformEventListener dragging', () => {
    let listener: WebPlatformEventListener | null = null;
    afterEach(() => {
        listener?.dispose();
        listener = null;
        vi.useRealTimers();
    });

    async function listen(): Promise<PlatformDragDropEventVariant[]> {
        listener = new WebPlatformEventListener(new TestLogger());
        const events: PlatformDragDropEventVariant[] = [];
        listener.subscribeDragDropEvents('test', event => events.push(event));
        await listener.setup();
        return events;
    }

    function drag(type: string): Event {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'pageX', { value: 10 });
        Object.defineProperty(event, 'pageY', { value: 20 });
        window.dispatchEvent(event);
        return event;
    }

    it('stops a drag when no drag over event follows within 100 ms', async () => {
        const events = await listen();
        vi.useFakeTimers();
        const over = drag('dragover');
        expect(over.defaultPrevented).toBe(true);
        expect(events).toEqual([{ type: DRAG_EVENT, value: { pageX: 10, pageY: 20 } }]);

        // Another drag over event restarts the timeout
        vi.advanceTimersByTime(60);
        drag('dragover');
        vi.advanceTimersByTime(60);
        expect(events.map(event => event.type)).toEqual([DRAG_EVENT, DRAG_EVENT]);
        vi.advanceTimersByTime(40);
        expect(events.map(event => event.type)).toEqual([DRAG_EVENT, DRAG_EVENT, DRAG_STOP_EVENT]);
        vi.advanceTimersByTime(1000);
        expect(events.length).toBe(3);
    });

    it('stops a drag once at its end', async () => {
        const events = await listen();
        vi.useFakeTimers();
        drag('dragover');
        expect(drag('dragend').defaultPrevented).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(events.map(event => event.type)).toEqual([DRAG_EVENT, DRAG_STOP_EVENT]);
    });

    it('stops a drag that drops no file', async () => {
        const events = await listen();
        vi.useFakeTimers();
        drag('dragover');
        drag('drop');
        vi.advanceTimersByTime(1000);
        expect(events.map(event => event.type)).toEqual([DRAG_EVENT, DRAG_STOP_EVENT]);
    });

    it('drops the pending drag timeout when disposed', async () => {
        const events = await listen();
        vi.useFakeTimers();
        drag('dragover');
        listener!.dispose();
        listener = null;
        vi.advanceTimersByTime(1000);
        expect(events.map(event => event.type)).toEqual([DRAG_EVENT]);
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

